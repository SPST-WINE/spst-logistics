// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

/**
 * HTML renderer for:
 *  - Proforma Invoice
 *  - Commercial Invoice
 *  - DLE (Export Free Declaration)
 * + PDF renderer (carrier templates) for DLE:
 *    /api/docs/unified/render?type=dle&format=pdf&carrier=fedex|ups
 *
 * Query:
 *  - sid | ship  : shipment identifier (business "ID Spedizione" or Airtable recId)
 *  - type        : proforma | fattura | commercial | commerciale | invoice | dle
 *  - exp, sig    : HMAC-SHA256 over `${sid}.${type}.${exp}` — bypassable with BYPASS_SIGNATURE=1
 *  - carrier     : (OPZ) "fedex" | "ups" (per DLE su template PDF)
 *  - format      : (OPZ) "pdf" per DLE su template; altrimenti HTML
 *
 * Env:
 *  AIRTABLE_PAT, AIRTABLE_BASE_ID, DOCS_SIGN_SECRET, BYPASS_SIGNATURE=1, DEBUG_DOCS=1
 * Tables:
 *  SpedizioniWebApp (shipments), SPED_PL (lines)
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import dayjs from 'dayjs';

// PDF libs per DLE carrier template
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
// pdfjs-dist per leggere le posizioni dei placeholder nel PDF
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

// ---------- ENV ----------
const AIRTABLE_PAT      = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID;
const DOCS_SIGN_SECRET  = process.env.DOCS_SIGN_SECRET || '';
const BYPASS_SIGNATURE  = process.env.BYPASS_SIGNATURE === '1';
const DEBUG_DOCS        = process.env.DEBUG_DOCS === '1';

// ---------- LOG HELPERS ----------
const dlog = (...args) => { if (DEBUG_DOCS) console.log('[docs]', ...args); };
const derr = (...args) => { console.error('[docs:ERR]', ...args); };

const TB_SPEDIZIONI = 'SpedizioniWebApp';
const TB_PL         = 'SPED_PL';

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.warn('[render] Missing Airtable envs');
}

// ---------- Airtable helpers ----------
const API_ROOT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const tableURL  = (t) => `${API_ROOT}/${encodeURIComponent(t)}`;
const recordURL = (t, id) => `${tableURL(t)}/${encodeURIComponent(id)}`;

async function airFetch(url, init = {}) {
  const start = Date.now();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const ms = Date.now() - start;
  const text = await res.text();
  const data = text ? safeJSON(text) : null;

  if (DEBUG_DOCS) {
    dlog('HTTP', init.method || 'GET', res.status, `${ms}ms`, url);
    if (!res.ok) dlog('HTTP body (error)', truncate(text, 1200));
  }
  if (!res.ok) {
    const err = new Error(`Airtable ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function safeJSON(t) { try { return JSON.parse(t); } catch { return null; } }
function truncate(s, n=600){ s = String(s||''); return s.length>n ? s.slice(0,n)+'…' : s; }

async function airFetchAll(formula, tableName) {
  const rows = [];
  let next = `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
  let pages = 0;
  while (next) {
    const data = await airFetch(next);
    pages++;
    rows.push(...(data?.records || []));
    next = data?.offset
      ? `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&offset=${data.offset}`
      : null;
  }
  dlog('airFetchAll', tableName, 'formula:', formula, 'pages:', pages, 'rows:', rows.length);
  return rows;
}

// ---------- Shipment loader ----------
async function getShipmentBySid(sid) {
  dlog('getShipmentBySid() sid=', sid);
  if (/^rec[0-9A-Za-z]{14}/.test(String(sid))) {
    dlog(' → treat as recId');
    try {
      const rec = await airFetch(recordURL(TB_SPEDIZIONI, sid));
      dlog(' → found by recId:', !!rec, 'id:', rec?.id);
      return rec;
    } catch (e) {
      derr('airFetch(record) failed', e?.status || '', e?.message || e);
      return null;
    }
  }

  const candidates = [
    'ID Spedizione','Id Spedizione','ID spedizione','id spedizione',
    'ID\u00A0Spedizione','IDSpedizione','Spedizione - ID','Shipment ID','ID'
  ];
  const safe = String(sid).replace(/'/g, "\\'");
  for (const field of candidates) {
    const formula = `{${field}}='${safe}'`;
    dlog('find shipment by field:', field, 'formula:', formula);
    try {
      const data = await airFetch(`${tableURL(TB_SPEDIZIONI)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
      const rec = data?.records?.[0];
      if (rec) { dlog(' → match on', field, 'rec:', rec.id); return rec; }
    } catch (err) {
      if (err?.status === 422) { dlog(' → field not found (422), skip:', field); continue; }
      derr('find shipment failed', field, err?.status || '', err?.message || err);
      throw err;
    }
  }
  dlog(' → NO shipment match for', sid);
  return null;
}

// ---------- PL loader ----------
const PL_LINKED_FIELD_ALIASES = ['SPED_PL', 'PL', 'Packing List', 'Packing list', 'PL Righe', 'Packing list righe'];

function buildOrByRecordIds(ids = []) {
  const parts = ids.map(id => `RECORD_ID()='${String(id).replace(/'/g,"\\'")}'`);
  return parts.length ? `OR(${parts.join(',')})` : '';
}

async function getPLRows({ ship, sidRaw }) {
  const recId = ship.id;
  const businessSid = ship?.fields?.['ID Spedizione']
    || ship?.fields?.['Id Spedizione']
    || ship?.fields?.['ID spedizione']
    || String(sidRaw || '');

  // A) via linked field on shipment
  for (const fname of PL_LINKED_FIELD_ALIASES) {
    const v = ship?.fields?.[fname];
    if (Array.isArray(v) && v.length) {
      dlog('PL via linked field on shipment:', fname, 'count:', v.length);
      const ids = v.map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean);
      const formula = buildOrByRecordIds(ids);
      if (formula) {
        try {
          const rows = await airFetchAll(formula, TB_PL);
          dlog('PL via linked field → rows:', rows.length);
          if (rows.length) return rows;
        } catch (err) {
          derr('PL via linked field error', fname, err?.status || '', err?.message || err);
        }
      }
    }
  }

  // B, C, D) fallback by formulas
  const formulas = [
    `{Spedizione}='${recId}'`,
    `{ID Spedizione}='${String(businessSid).replace(/'/g,"\\'")}'`,
    `{Spedizione}='${String(businessSid).replace(/'/g,"\\'")}'`,
  ];

  for (const f of formulas) {
    try {
      dlog('PL query formula:', f);
      const rows = await airFetchAll(f, TB_PL);
      if (rows.length) {
        dlog('PL rows found:', rows.length, 'using formula:', f);
        return rows;
      } else {
        dlog('PL zero rows with formula:', f);
      }
    } catch (err) {
      if (err?.status === 422) { dlog('PL formula skipped (422 unknown field):', f); continue; }
      derr('PL fetch error', err?.status || '', err?.message || err);
      throw err;
    }
  }
  dlog('PL: no rows matched for', { recId, businessSid, sidRaw });
  return [];
}

// ---------- Signature ----------
function verifySigFlexible({ sid, rawType, normType, exp, sig }) {
  if (BYPASS_SIGNATURE) { dlog('SIGNATURE BYPASSED'); return true; }
  if (!sid || !rawType || !exp || !sig) { dlog('SIG missing pieces', { sid:!!sid, rawType, exp, sig:!!sig }); return false; }
  const now = Math.floor(Date.now() / 1000);
  if (Number(exp) < now) { dlog('SIG expired', { exp, now }); return false; }

  const h1 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(`${sid}.${rawType}.${exp}`).digest('hex');
  const h2 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(`${sid}.${normType}.${exp}`).digest('hex');
  const q  = `sid=${encodeURIComponent(String(sid))}&type=${encodeURIComponent(String(rawType))}&exp=${encodeURIComponent(String(exp))}`;
  const h3 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(q).digest('hex');

  const ok = safeEqual(h1, String(sig)) || safeEqual(h2, String(sig)) || safeEqual(h3, String(sig));
  dlog('SIG verify', { rawType, normType: normType, match: ok ? 'OK' : 'FAIL' });
  return ok;
}
function safeEqual(a,b){ try{ return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }catch{ return false; } }

function bad(res, code, msg, details) {
  dlog('RESP', code, msg, details || '');
  res.status(code).json({ ok: false, error: msg, details });
}

// ---------- Utils ----------
const get = (obj, keys, def = '') => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return def;
};
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('it-IT'); } catch { return ''; } };
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };
const money = (x, sym = '€') =>
  `${sym} ${num(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escapeHTML = (x = '') => String(x)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const kgFmt = (x) => `${(Math.round(num(x)*10)/10).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;

// ---------- Type normalization ----------
function normalizeType(t) {
  const raw = String(t || 'proforma').toLowerCase().trim();
  const commercialAliases = new Set(['commercial', 'commerciale', 'invoice', 'fattura', 'fattura commerciale']);
  const dleAliases = new Set(['dle', 'dichiarazione', 'libera', 'esportazione', 'export', 'export declaration']);
  if (dleAliases.has(raw)) return 'dle';
  if (commercialAliases.has(raw)) return 'commercial';
  return 'proforma';
}

/* =======================================================================================
 *                               RENDER HTML (invariato)
 * ======================================================================================= */

function renderInvoiceHTML({ type, ship, lines, total, totalsWeights }) {
  const watermark = type === 'proforma';
  const docTitle  = type === 'proforma' ? 'Proforma Invoice' : 'Commercial Invoice';
  const ccy = get(ship.fields, ['Valuta', 'Currency'], 'EUR');
  let ccySym = ccy === 'EUR' ? '€' : (ccy || '€');
  if (type === 'proforma') ccySym = '€';

  // Sender (Mittente)
  const senderName    = get(ship.fields, ['Mittente - Ragione Sociale'], '—');
  const senderCountry = get(ship.fields, ['Mittente - Paese'], '');
  const senderCity    = get(ship.fields, ['Mittente - Città'], '');
  const senderZip     = get(ship.fields, ['Mittente - CAP'], '');
  const senderAddr    = get(ship.fields, ['Mittente - Indirizzo'], '');
  const senderPhone   = get(ship.fields, ['Mittente - Telefono'], '');
  const senderVat     = get(ship.fields, ['Mittente - P.IVA/CF'], '');

  // Receiver (SPEDIZIONE)
  const shName    = get(ship.fields, ['Destinatario - Ragione Sociale'], '—');
  const shAddr    = get(ship.fields, ['Destinatario - Indirizzo'], '');
  const shCity    = get(ship.fields, ['Destinatario - Città'], '');
  const shZip     = get(ship.fields, ['Destinatario - CAP'], '');
  const shCountry = get(ship.fields, ['Destinatario - Paese'], '');
  const shPhone   = get(ship.fields, ['Destinatario - Telefono'], '');
  const shVat     = get(ship.fields, ['Destinatario - P.IVA/CF'], '');

  // Invoice Receiver (FATTURAZIONE)
  const btName    = get(ship.fields, ['FATT Ragione Sociale'], '');
  const btAddr    = get(ship.fields, ['FATT Indirizzo'], '');
  const btCity    = get(ship.fields, ['FATT Città'], '');
  const btZip     = get(ship.fields, ['FATT CAP'], '');
  const btCountry = get(ship.fields, ['FATT Paese'], '');
  const btPhone   = get(ship.fields, ['FATT Telefono'], '');
  const btVat     = get(ship.fields, ['FATT PIVA/CF'], '');

  // Shipment meta
  const sid       = get(ship.fields, ['ID Spedizione', 'Id Spedizione'], ship.id);
  const carrier   = get(ship.fields, ['Corriere', 'Carrier'], '—');
  const incoterm  = get(ship.fields, ['Incoterm'], '');
  const pickupDate= get(ship.fields, ['Ritiro - Data'], '') || ship.fields?.['Ritiro Data'];
  const docNo = type === 'proforma'
    ? (get(ship.fields, ['Proforma - Numero'], '') || `PF-${sid}`)
    : (get(ship.fields, ['Fattura - Numero', 'Commercial Invoice - Numero'], '') || `CI-${sid}`);

  const place  = senderCity || '';
  const dateStr= fmtDate(pickupDate) || fmtDate(Date.now());

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${docTitle} — ${escapeHTML(sid)}</title>
<style>
/* ... (STILI identici a prima, omessi qui per brevità) ... */
</style>
</head>
<body> ... </body></html>`;
}

// DLE HTML (come prima, invariato nei testi)
function renderDLEHTML({ ship }) {
  const carrier   = get(ship.fields, ['Corriere', 'Carrier'], '—');
  const senderRS  = get(ship.fields, ['Mittente - Ragione Sociale'], '—');
  const senderCity= get(ship.fields, ['Mittente - Città'], '');
  const pickup    = get(ship.fields, ['Ritiro - Data'], '') || ship.fields?.['Ritiro Data'];
  const dateStr   = fmtDate(pickup) || fmtDate(Date.now());
  const sid       = get(ship.fields, ['ID Spedizione', 'Id Spedizione'], ship.id);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Export Free Declaration — ${escapeHTML(sid)}</title></head>
<body> ... (HTML DLE identico alla tua versione attuale) ... </body></html>`;
}

/* =======================================================================================
 *                        DLE su TEMPLATE PDF (UPS / FEDEX)
 * ======================================================================================= */

// Percorsi template PDF
const TEMPLATE_PATHS = {
  fedex: path.resolve(process.cwd(), 'public/templates/DLE_FEDEX_CON_PLACEHOLDER.pdf'),
  ups:   path.resolve(process.cwd(), 'public/templates/UPS_DLE_CON_PLACEHOLDER.pdf'),
};

// Estrattore posizioni testo dal PDF (usa pdfjs-dist)
async function extractTextPositions(pdfBuffer /* Uint8Array */) {
  // @ts-ignore
  pdfjs.GlobalWorkerOptions.workerSrc = require('pdfjs-dist/legacy/build/pdf.worker.js');

  const loadingTask = pdfjs.getDocument({ data: pdfBuffer });
  const pdf = await loadingTask.promise;
  const items = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    for (const t of content.items) {
      const str = t.str;
      const [a,b,c,d,e,f] = t.transform;
      const fontHeight = Math.hypot(b,d);
      const x = e;
      const y = f - fontHeight;
      const w = t.width;
      const h = fontHeight;
      items.push({ pageIndex: p-1, text: str, x, y, w, h });
    }
  }
  return items;
}

// Overlay: copre i placeholder e scrive il valore
async function overlayReplacements(pdfBuffer, replacements) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const items = await extractTextPositions(pdfBuffer);

  for (const [needle, value] of Object.entries(replacements)) {
    if (!value) continue;
    const matches = items.filter(it => it.text.trim() === needle.trim());

    for (const m of matches) {
      const page = pdfDoc.getPage(m.pageIndex);
      const pad = 1.5;

      // rettangolo bianco sopra il placeholder
      page.drawRectangle({
        x: m.x - pad, y: m.y - pad,
        width: m.w + pad*2, height: m.h + pad*2,
        color: rgb(1,1,1),
      });

      // shrink-to-fit semplice
      let fontSize = m.h * 0.9;
      const maxWidth = m.w;
      let textToDraw = String(value);

      while (helv.widthOfTextAtSize(textToDraw, fontSize) > maxWidth && fontSize > 6) {
        fontSize -= 0.5;
      }
      page.drawText(textToDraw, {
        x: m.x,
        y: m.y + (m.h - fontSize) * 0.2,
        size: fontSize,
        font: helv,
        color: rgb(0,0,0),
      });
    }
  }

  return pdfDoc.save();
}

// Post-processing FedEx: “X” su “No cumulation applied” (se presente)
async function postProcessFedEx(pdfBytes) {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const items = await extractTextPositions(pdfBytes);
  const target = items.find(it => it.text.toUpperCase().includes('NO CUMULATION APPLIED'));
  if (target) {
    const page = pdfDoc.getPage(target.pageIndex);
    page.drawText('X', {
      x: target.x - 12,
      y: target.y,
      size: target.h,
      font: helv,
    });
  }
  return pdfDoc.save();
}

// Mappa placeholder → valore (adatta i nomi ai tuoi template)
function buildDLEReplacements({ ship, carrier }) {
  const f = ship.fields || {};
  const senderRS   = get(f, ['Mittente - Ragione Sociale'], '');
  const senderPiva = get(f, ['Mittente - P.IVA/CF', 'Partita IVA Mittente'], '');
  const senderAddr = get(f, ['Mittente - Indirizzo'], '');
  const senderZip  = get(f, ['Mittente - CAP'], '');
  const senderCity = get(f, ['Mittente - Città'], '');
  const senderCntr = get(f, ['Mittente - Paese'], '');
  const senderTel  = get(f, ['Mittente - Telefono'], '');
  const senderRef  = get(f, ['Mittente - Referente'], '');

  const destCountry= get(f, ['Destinatario - Paese'], '');

  const pickup     = get(f, ['Ritiro - Data'], '') || f['Ritiro Data'];
  const dateStr    = dayjs(pickup || new Date()).format('DD-MM-YYYY');
  const docNo      = get(f, ['Numero Fattura', 'Proforma - Numero'], '');

  // ATTENZIONE: le chiavi a sinistra DEVONO corrispondere ai testi esatti
  // dei placeholder presenti in rosso nel PDF template che ci hai fornito.
  // Se un placeholder ha un nome diverso nel tuo file, cambia la chiave.
  const common = {
    'Mittente - Ragione Sociale'       : senderRS,
    'INTESTAZIONE DEL MITTENTE'        : senderRS,                // FedEx
    'Mittente - P.IVA/CF'              : senderPiva,
    'Mittente - Indirizzo'             : senderAddr,
    'Mittente - Città'                 : senderCity,
    'MITTENTE CITTÀ + MITTENTE CAP'    : [senderCity, senderZip].filter(Boolean).join(' '),
    'Mittente - Città, Mittente - CAP' : [senderCity, senderZip].filter(Boolean).join(' '),
    'Mittente - CAP'                   : senderZip,
    'Mittente - Paese'                 : senderCntr,
    'Mittente - Telefono'              : senderTel,
    'Mittente - Referente (se non c’è usa Mittente - Ragione Sociale)' : senderRef || senderRS,
    'Destinatario - Paese'             : destCountry,
    'NUMERO FATTURA GENERATO'          : docNo || '',
    'DATA'                             : dateStr,
    'Data'                             : dateStr,
  };

  // Se servono particolarità per carrier: aggiungi/override qui
  if (carrier === 'fedex') {
    return { ...common };
  }
  if (carrier === 'ups') {
    return { ...common };
  }
  return common;
}

async function renderDLECarrierPDF({ ship, carrier }) {
  const key = String(carrier || '').toLowerCase();
  if (key !== 'fedex' && key !== 'ups') {
    const err = new Error('Carrier non supportato per DLE PDF (usa fedex|ups)');
    err.status = 400;
    throw err;
  }

  // carica template
  const templatePath = TEMPLATE_PATHS[key];
  const pdfBuffer = new Uint8Array(await fs.readFile(templatePath));

  // costruisci mappa sostituzioni dai campi Airtable
  const replacements = buildDLEReplacements({ ship, carrier: key });

  // overlay + post processing
  let out = await overlayReplacements(pdfBuffer, replacements);
  if (key === 'fedex') out = await postProcessFedEx(out);

  return out; // Uint8Array
}

/* =======================================================================================
 *                                     HANDLER
 * ======================================================================================= */

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    const q = req.query || {};
    const rawType = String(q.type || 'proforma').toLowerCase();
    const type    = normalizeType(rawType); // 'proforma' | 'commercial' | 'dle'
    const sidRaw  = q.sid || q.ship;
    const sig     = q.sig;
    const exp     = q.exp;
    const format  = (q.format || '').toString().toLowerCase();  // 'pdf' per DLE template
    const carrierOverride = (q.carrier || q.courier || '').toString().trim().toLowerCase();

    dlog('REQUEST', { rawType, normType: type, sidRaw, hasSig: !!sig, exp, carrierOverride, format });

    if (!sidRaw) return bad(res, 400, 'Bad request', 'Missing sid/ship');
    if (!verifySigFlexible({ sid: sidRaw, rawType, normType: type, exp, sig })) {
      return bad(res, 401, 'Unauthorized', 'Invalid signature');
    }

    // Load shipment
    const ship = await getShipmentBySid(sidRaw);
    if (!ship) return bad(res, 404, 'Not found', `No shipment found for ${sidRaw}`);
    dlog('SHIPMENT OK', { recId: ship.id, fieldsKeys: Object.keys(ship.fields || {}).slice(0,80) });

    // ===== DLE su TEMPLATE PDF (UPS/FEDEX) =====
    if (type === 'dle' && format === 'pdf' && (carrierOverride === 'fedex' || carrierOverride === 'ups')) {
      const pdfBytes = await renderDLECarrierPDF({ ship, carrier: carrierOverride });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="DLE-${carrierOverride}-${ship.id}.pdf"`);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.status(200).send(Buffer.from(pdfBytes));
      dlog('RENDER DLE PDF OK', { ms: Date.now() - t0, carrier: carrierOverride });
      return;
    }

    // ===== DLE HTML (fallback / default) =====
    if (type === 'dle') {
      const html = renderDLEHTML({ ship });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.status(200).send(html);
      dlog('RENDER DLE HTML OK', { ms: Date.now() - t0 });
      return;
    }

    // ===== INVOICES =====
    // Carica PL, mappa righe, calcola totali (identico a prima)
    const pl = await getPLRows({ ship, sidRaw });
    const items = pl.length ? pl.map((r,i) => {
      const f = r.fields || {};
      const title   = String(f['Etichetta'] ?? '').trim();
      const qty     = Number(f['Bottiglie'] ?? 0) || 0;
      const abv     = get(f, ['Gradazione (% vol)','Gradazione','ABV','Vol %'], '');

      const tipologia = String(f['Tipologia'] ?? '').trim();
      let hsByTip = '';
      if (tipologia === 'vino fermo') hsByTip = '2204.21';
      else if (tipologia === 'vino spumante') hsByTip = '2204.10';
      else if (tipologia === 'brochure/depliant') hsByTip = '4911.10.00';
      const hsFallback = get(f, ['HS','HS code','HS Code'], '');
      const hs         = hsByTip || hsFallback;

      const netPerB = Number(get(f, ['Peso netto bott. (kg)','Peso netto bott (kg)','Peso netto (kg)','Peso netto'], 0.9)) || 0.9;
      const grsPerB = Number(get(f, ['Peso lordo bott. (kg)','Peso lordo bott (kg)','Peso lordo (kg)','Peso lordo'], 1.3)) || 1.3;

      const netLine = qty * netPerB;
      const grsLine = qty * grsPerB;

      const price   = (normalizeType(rawType) === 'proforma') ? 2 : (Number(f['Prezzo'] ?? 0) || 0);
      const amount  = qty * price;

      const metaBits = [];
      if (abv) metaBits.push(`ABV: ${abv}% vol`);
      metaBits.push(`Net: ${netLine.toFixed(1)} kg`);
      metaBits.push(`Gross: ${grsLine.toFixed(1)} kg`);
      const meta = metaBits.join(' · ');

      return { title: title || '—', qty, price, amount, meta, netLine, grsLine, hs };
    }) : [{ title:'—', qty:0, price:(normalizeType(rawType)==='proforma'?2:0), amount:0, meta:'', netLine:0, grsLine:0, hs:'' }];

    const totalMoney = items.reduce((s, r) => s + num(r.amount), 0);
    const totalNet   = items.reduce((s, r) => s + num(r.netLine), 0);
    const totalGross = items.reduce((s, r) => s + num(r.grsLine), 0);

    // Override corriere valido sia per Proforma che per Commercial
    const overrideCarrier = (q.carrier || q.courier || '').toString().trim();
    const shipForRender = (overrideCarrier && (type === 'proforma' || type === 'commercial'))
      ? { ...ship, fields: { ...(ship.fields||{}), Carrier: overrideCarrier, Corriere: overrideCarrier } }
      : ship;

    const html = renderInvoiceHTML({
      type,
      ship: shipForRender,
      lines: items,
      total: totalMoney,
      totalsWeights: { net: totalNet, gross: totalGross },
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(html);
    dlog('RENDER INVOICE OK', { ms: Date.now() - t0 });
  } catch (err) {
    derr('render error', err?.status || '', err?.message || err);
    try { return bad(res, 500, 'Render error', String(err?.message || err)); }
    catch { /* noop */ }
  }
}
