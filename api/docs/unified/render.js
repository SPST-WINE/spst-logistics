// api/docs/unified/render.js — SOSTITUISCI INTERO FILE CON QUESTO CONTENUTO
// Fix: riempimento "pixel perfect" con copertura (whiteout) dei placeholder rossi + scrittura testo

export const config = { runtime: 'nodejs' };

/**
 * HTML renderer (Proforma/Commercial), DLE HTML fallback
 * + DLE PDF (FedEx / UPS) con overlay “whiteout” dei placeholder rossi
 *
 * Requisiti file:
 *  - ./assets/dle/FedEx_DLE_master.pdf
 *  - ./assets/dle/UPS_DLE_Master.pdf
 *  - ./assets/fonts/Inter-Regular.ttf
 */

import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

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

// ---------- PATHS ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, '..', '..', '..', 'assets');
const PDF_FDX    = path.join(ASSETS_DIR, 'dle', 'FedEx_DLE_master.pdf');
const PDF_UPS    = path.join(ASSETS_DIR, 'dle', 'UPS_DLE_Master.pdf'); // M maiuscola
const FONT_INTER = path.join(ASSETS_DIR, 'fonts', 'Inter-Regular.ttf');

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
  while (next) {
    const data = await airFetch(next);
    rows.push(...(data?.records || []));
    next = data?.offset
      ? `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&offset=${data.offset}`
      : null;
  }
  return rows;
}

// ---------- Shipment loader ----------
async function getShipmentBySid(sid) {
  if (/^rec[0-9A-Za-z]{14}/.test(String(sid))) {
    try { return await airFetch(recordURL(TB_SPEDIZIONI, sid)); }
    catch { return null; }
  }
  const candidates = [
    'ID Spedizione','Id Spedizione','ID spedizione','id spedizione',
    'ID\u00A0Spedizione','IDSpedizione','Spedizione - ID','Shipment ID','ID'
  ];
  const safe = String(sid).replace(/'/g, "\\'");
  for (const field of candidates) {
    const formula = `{${field}}='${safe}'`;
    try {
      const data = await airFetch(`${tableURL(TB_SPEDIZIONI)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`);
      const rec = data?.records?.[0];
      if (rec) return rec;
    } catch (err) {
      if (err?.status === 422) continue;
      throw err;
    }
  }
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

  for (const fname of PL_LINKED_FIELD_ALIASES) {
    const v = ship?.fields?.[fname];
    if (Array.isArray(v) && v.length) {
      const ids = v.map(x => (typeof x === 'string' ? x : x?.id)).filter(Boolean);
      const formula = buildOrByRecordIds(ids);
      if (formula) {
        try {
          const rows = await airFetchAll(formula, TB_PL);
          if (rows.length) return rows;
        } catch {}
      }
    }
  }
  const formulas = [
    `{Spedizione}='${recId}'`,
    `{ID Spedizione}='${String(businessSid).replace(/'/g,"\\'")}'`,
    `{Spedizione}='${String(businessSid).replace(/'/g,"\\'")}'`,
  ];
  for (const f of formulas) {
    try {
      const rows = await airFetchAll(f, TB_PL);
      if (rows.length) return rows;
    } catch (err) {
      if (err?.status === 422) continue;
      throw err;
    }
  }
  return [];
}

// ---------- Signature ----------
function verifySigFlexible({ sid, rawType, normType, exp, sig }) {
  if (BYPASS_SIGNATURE) return true;
  if (!sid || !rawType || !exp || !sig) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Number(exp) < now) return false;

  const h1 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(`${sid}.${rawType}.${exp}`).digest('hex');
  const h2 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(`${sid}.${normType}.${exp}`).digest('hex');
  const q  = `sid=${encodeURIComponent(String(sid))}&type=${encodeURIComponent(String(rawType))}&exp=${encodeURIComponent(String(exp))}`;
  const h3 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(q).digest('hex');

  return safeEqual(h1, String(sig)) || safeEqual(h2, String(sig)) || safeEqual(h3, String(sig));
}
function safeEqual(a,b){ try{ return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }catch{ return false; } }

function bad(res, code, msg, details) {
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
  if (raw === 'dle:fedex' || raw === 'dle-fedex') return 'dle_fedex';
  if (raw === 'dle:ups'   || raw === 'dle-ups')   return 'dle_ups';
  const commercialAliases = new Set(['commercial', 'commerciale', 'invoice', 'fattura', 'fattura commerciale']);
  const dleAliases = new Set(['dle', 'dichiarazione', 'libera', 'esportazione', 'export', 'export declaration']);
  if (dleAliases.has(raw)) return 'dle';
  if (commercialAliases.has(raw)) return 'commercial';
  return 'proforma';
}

// ---------- INVOICE HTML ----------
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
:root{
  --brand:#111827; --accent:#0ea5e9; --ok:#16a34a; --text:#0b0f13; --muted:#6b7280;
  --border:#e5e7eb; --border-strong:#d1d5db; --bg:#ffffff; --zebra:#fafafa; --chip:#f3f4f6;
  --stamp:#133a7a;
}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative}
.watermark{position:absolute; inset:0; display:${watermark?'flex':'none'}; align-items:center; justify-content:center; pointer-events:none}
.watermark span{opacity:0.06; font-size:180px; letter-spacing:0.22em; transform:rotate(-24deg); font-weight:800; color:#0f172a}
header{display:grid; grid-template-columns:1fr auto; align-items:start; gap:16px}
.brand{max-width:70%}
.tag{display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#374151; background:#f3f4f6; border:1px solid #e5e7eb; padding:2px 6px; border-radius:6px; margin-bottom:6px}
.logo .word{font-size:26px; font-weight:800; letter-spacing:.01em; color:#111827}
.brand .meta{margin-top:6px; font-size:12px; color:${watermark?'#475569':'#6b7280'}}
.doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:12px; padding:10px; min-width:300px}
.doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:${watermark?'var(--accent)':'var(--ok)'}; font-weight:800}
.doc-meta .kv{margin-top:6px}
.kv div{margin:2px 0}
hr.sep{border:none;border-top:1px solid #e5e7eb; margin:16px 0 18px}
.grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
.card{border:1px solid #e5e7eb; border-radius:12px; padding:12px}
.card h3{margin:0 0 8px; font-size:11px; color:#374151; text-transform:uppercase; letter-spacing:.08em}
.small{font-size:12px; color:#374151}
.mono{font-feature-settings:"tnum" 1; font-variant-numeric: tabular-nums}
.muted{color:#6b7280}
table.items{width:100%; border-collapse:collapse; font-size:12px; margin-top:16px}
table.items th, table.items td{border-bottom:1px solid #e5e7eb; padding:9px 8px; vertical-align:top}
table.items thead th{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#374151; text-align:left; background:#f3f4f6}
table.items td.num, table.items th.num{text-align:right}
table.items tbody tr:nth-child(odd){background:#fafafa}
table.items tbody tr:last-child td{border-bottom:1px solid #d1d5db}
.totals{margin-top:10px; display:flex; justify-content:flex-end}
.totals table{font-size:12px; border-collapse:collapse; min-width:300px}
.totals td{padding:8px 10px; border-bottom:1px solid #e5e7eb}
.totals tr:last-child td{border-top:1px solid #d1d5db; border-bottom:none; font-weight:700}
.note{margin-top:10px; font-size:11px; color:#374151}
footer{margin-top:22px; font-size:11px; color:#374151}
.sign{margin-top:20px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px}
.sign .box{height:64px; border:1px dashed #d1d5db; border-radius:10px; width:260px}
.sign .label{font-size:11px; color:#374151; margin-bottom:6px}
.printbar{position:sticky; top:0; background:#fff; padding:8px 0 12px; display:flex; gap:8px; justify-content:flex-end}
.btn{font-size:12px; border:1px solid #e5e7eb; background:#fff; padding:6px 10px; border-radius:8px; cursor:pointer}
.btn:hover{background:#f9fafb}
@media print {.printbar{display:none}}
</style>
</head>
<body>
  <div class="page">
    <div class="printbar">
      <button class="btn" onclick="window.print()">Print / Save PDF</button>
    </div>
    <div class="watermark"><span>${watermark ? 'PROFORMA' : ''}</span></div>

    <header>
      <div class="brand">
        <div class="tag">Sender</div>
        <div class="logo"><div class="word">${escapeHTML(senderName)}</div></div>
        <div class="meta">
          ${escapeHTML(senderAddr)}${senderAddr?', ':''}${escapeHTML(senderZip)} ${escapeHTML(senderCity)}${senderCity?', ':''}${escapeHTML(senderCountry)}${senderCountry? ' · ' : ''}${senderVat ? ('VAT ' + escapeHTML(senderVat)) : ''}<br/>
          ${senderPhone ? ('Tel: ' + escapeHTML(senderPhone)) : ''}
        </div>
      </div>
      <div class="doc-meta">
        <div class="title">${docTitle}</div>
        <div class="kv">
          <div><strong>No.:</strong> ${escapeHTML(docNo)}</div>
          <div><strong>Date:</strong> ${escapeHTML(fmtDate(pickupDate) || fmtDate(Date.now()))}</div>
          <div><strong>Shipment ID:</strong> ${escapeHTML(sid)}</div>
        </div>
      </div>
    </header>

    <hr class="sep" />

    <section class="grid">
      <div class="card">
        <h3>Receiver</h3>
        <div class="small"><strong>${escapeHTML(shName)}</strong></div>
        <div class="small">${escapeHTML(shAddr)}</div>
        <div class="small">${escapeHTML(shZip)} ${escapeHTML(shCity)} (${escapeHTML(shCountry)})</div>
        ${shPhone ? `<div class="small">Tel: ${escapeHTML(shPhone)}</div>` : ``}
        ${shVat   ? `<div class="small">VAT/CF: ${escapeHTML(shVat)}</div>` : ``}
      </div>
      <div class="card">
        <h3>Invoice Receiver</h3>
        <div class="small"><strong>${escapeHTML(btName || shName)}</strong></div>
        <div class="small">${escapeHTML(btAddr || shAddr)}</div>
        <div class="small">${escapeHTML(btZip || shZip)} ${escapeHTML(btCity || shCity)} (${escapeHTML(btCountry || shCountry)})</div>
        ${(btPhone || shPhone) ? `<div class="small">Tel: ${escapeHTML(btPhone || shPhone)}</div>` : ``}
        ${(btVat || '') ? `<div class="small">VAT/CF: ${escapeHTML(btVat)}</div>` : ``}
      </div>
    </section>

    <section class="grid" style="grid-template-columns:1fr">
      <div class="card ship-card">
        <h3>Shipment Details</h3>
        <div class="small">Carrier: ${escapeHTML(carrier || '—')}</div>
        <div class="small">Incoterm: ${escapeHTML(incoterm || '—')} · Currency: ${escapeHTML(ccy)}</div>
        <div class="small">Net weight: <strong>${escapeHTML(kgFmt(totalsWeights.net))}</strong> · Gross weight: <strong>${escapeHTML(kgFmt(totalsWeights.gross))}</strong></div>
      </div>
    </section>

    <table class="items" aria-label="Goods details">
      <thead>
        <tr>
          <th style="width:28px">#</th>
          <th>Description</th>
          <th style="width:110px">HS Code</th>
          <th style="width:70px" class="num">Qty</th>
          <th style="width:110px" class="num">Price / unit</th>
          <th style="width:120px" class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map((r,i)=>`
          <tr>
            <td>${i+1}</td>
            <td>
              <strong>${escapeHTML(r.title || '—')}</strong>
              ${r.meta?`<br/><span class="muted">${escapeHTML(r.meta)}</span>`:''}
            </td>
            <td>${escapeHTML(r.hs || '')}</td>
            <td class="num mono">${num(r.qty)}</td>
            <td class="num mono">${money(r.price, ccySym)}</td>
            <td class="num mono">${money(r.amount, ccySym)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr>
          <td style="text-align:right">Total</td>
          <td style="text-align:right; width:140px"><strong>${money(total, ccySym)}</strong></td>
        </tr>
      </table>
    </div>

    <div class="note">Country of origin: <strong>Italy</strong>.</div>
    ${type==='proforma' ? `<div class="note"><strong>Note:</strong> Goods are not for resale. Declared values are for customs purposes only.</div>` : ''}

    <footer>
      <div class="sign">
        <div>
          <div class="small"><strong>Place & date:</strong> ${escapeHTML(place)}, ${escapeHTML(dateStr)}</div>
          <div class="small">If you need more information about this shipping you can contact us at:<br/>info@spst.it · +39 320 144 1789 · www.spst.it</div>
        </div>
        <div>
          <div class="label">Signature</div>
          <div class="box"></div>
        </div>
      </div>
    </footer>
  </div>
</body>
</html>`;
}

// ---------- DLE HTML (fallback) ----------
function renderDLEHTML({ ship }) {
  const carrier   = get(ship.fields, ['Corriere', 'Carrier'], '—');
  const senderRS  = get(ship.fields, ['Mittente - Ragione Sociale'], '—');
  const senderCity= get(ship.fields, ['Mittente - Città'], '');
  const pickup    = get(ship.fields, ['Ritiro - Data'], '') || ship.fields?.['Ritiro Data'];
  const dateStr   = fmtDate(pickup) || fmtDate(Date.now());
  const sid       = get(ship.fields, ['ID Spedizione', 'Id Spedizione'], ship.id);

  return `<!doctype html>
<html><head><meta charset="utf-8"/></head><body>Export Free Declaration — ${escapeHTML(sid)} — ${escapeHTML(senderCity)} ${escapeHTML(dateStr)} — To: ${escapeHTML(carrier)}</body></html>`;
}

// --- SOSTITUISCI QUESTO BLOCCO NEL TUO file: api/docs/unified/render.js ---
// (Da: "// ---------- PDF helpers ----------" fino a prima dell'handler)

import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ---------- PDF helpers ----------
async function loadPdfTemplate(absolutePath) {
  const bytes = await readFile(absolutePath);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const fontBytes = await readFile(FONT_INTER);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  return { pdf, font };
}

function drawText(page, text, { x, y, size, maxW }, font, color = rgb(0,0,0)) {
  const s = String(text ?? '');
  if (!maxW) {
    page.drawText(s, { x, y, size, font, color });
    return;
  }
  // word-wrap semplice per non “uscire” dal box
  const words = s.split(/\s+/);
  let line = '';
  let yy = y;
  const lh = size + 2;
  for (const w of words) {
    const test = (line ? line + ' ' : '') + w;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      page.drawText(line, { x, y: yy, size, font, color });
      line = w;
      yy -= lh;
    } else {
      line = test;
    }
  }
  if (line) page.drawText(line, { x, y: yy, size, font, color });
}

function whiteout(page, rect) {
  page.drawRectangle({ x: rect.x, y: rect.y, width: rect.w, height: rect.h, color: rgb(1,1,1) });
}

// ---------- DATA extraction ----------
function buildDLEData(ship){
  const f = ship.fields || {};
  const mitt = {
    rs:   get(f, ['Mittente - Ragione Sociale'], ''),
    piva: get(f, ['Mittente - P.IVA/CF'], ''),
    ind:  get(f, ['Mittente - Indirizzo'], ''),
    cap:  get(f, ['Mittente - CAP'], ''),
    city: get(f, ['Mittente - Città'], ''),
    country: get(f, ['Mittente - Paese'], 'Italy'),
    tel:  get(f, ['Mittente - Telefono'], ''),
    ref:  get(f, ['Mittente - Referente','Referente Mittente'], ''),
    email:get(f, ['Mittente - Email','Email Mittente'], ''),
  };
  const dest = { country: get(f, ['Destinatario - Paese'], '') };
  const sid   = get(f, ['ID Spedizione', 'Id Spedizione'], ship.id);
  const dataRitiro = get(f, ['Ritiro - Data'], '') || f['Ritiro Data'];
  const dateStr = fmtDate(dataRitiro) || fmtDate(Date.now());
  const invNo = get(f, ['Fattura - Numero','Commercial Invoice - Numero','Proforma - Numero'], '') || `CI-${sid}`;
  return { mitt, dest, sid, dateStr, invNo };
}

// ---------- Coord/boxes ----------
// NOTE: coordinate in punti PDF (0,0 in basso a sinistra). Box ampi per “coprire” i placeholder rossi.

const FED_EX_FIELDS = {
  shipment_id:    { x: 420, y: 760, size: 10 },
  invoice_no:     { x: 420, y: 744, size: 10 },
  sender_rs:      { x: 120, y: 705, size: 10 },
  sender_addr:    { x: 120, y: 688, size: 10, maxW: 390 },
  sender_vat_tel: { x: 120, y: 672, size: 10, maxW: 390 },
  origin_country: { x: 160, y: 640, size: 10 },
  dest_country:   { x: 420, y: 640, size: 10 },
  place_date:     { x: 120, y: 175, size: 10 },
  signature_hint: { x: 420, y: 150, size: 9 },
};
// whiteout: copre intestazione mittente + shipment/invoice + paesi + place/date
const FED_EX_WHITE = [
  { x: 110, y: 668, w: 400, h: 55 },
  { x: 410, y: 738, w: 170, h: 30 },
  { x: 150, y: 635, w: 150, h: 16 },
  { x: 410, y: 635, w: 190, h: 16 },
  { x: 110, y: 168, w: 400, h: 20 },
  { x: 410, y: 145, w: 170, h: 16 },
];

const UPS_FIELDS = {
  sottoscritto:   { x: 150, y: 745, size: 11, maxW: 370 }, // “Il sottoscritto …”
  societa:        { x: 150, y: 728, size: 11, maxW: 370 }, // “società …”
  luogo:          { x: 150, y: 270, size: 11 },
  data:           { x: 350, y: 270, size: 11 },
  firma_hint:     { x: 350, y: 238, size: 9 },
};
// whiteout esteso: copre tutte le righe segnaposto rosse presenti nel PDF UPS
const UPS_WHITE = [
  { x: 140, y: 720, w: 420, h: 50 }, // blocco “Il sottoscritto … / società …”
  { x: 140, y: 264, w: 220, h: 18 }, // luogo
  { x: 338, y: 264, w: 140, h: 18 }, // data
  { x: 338, y: 232, w: 210, h: 18 }, // firma hint
];

// ---------- DLE PDF RENDERERS ----------
async function renderFedExPDF({ ship }, res){
  const { pdf, font } = await loadPdfTemplate(PDF_FDX);
  const page = pdf.getPage(0);
  const data = buildDLEData(ship);

  FED_EX_WHITE.forEach(r => whiteout(page, r));

  const addrLine = [data.mitt.ind, `${data.mitt.cap} ${data.mitt.city}`, data.mitt.country]
    .filter(Boolean).join(' · ');
  const vatTel   = [data.mitt.piva && `VAT/CF: ${data.mitt.piva}`, data.mitt.tel && `TEL: ${data.mitt.tel}`]
    .filter(Boolean).join(' · ');
  const placeDate= `${data.mitt.city}, ${data.dateStr}`;

  drawText(page, data.sid,                        FED_EX_FIELDS.shipment_id,    font);
  drawText(page, data.invNo,                      FED_EX_FIELDS.invoice_no,     font);
  drawText(page, data.mitt.rs,                    FED_EX_FIELDS.sender_rs,      font);
  drawText(page, addrLine,                        FED_EX_FIELDS.sender_addr,    font);
  drawText(page, vatTel,                          FED_EX_FIELDS.sender_vat_tel, font);
  drawText(page, 'ITALY',                         FED_EX_FIELDS.origin_country, font);
  drawText(page, (data.dest.country||'').toUpperCase(), FED_EX_FIELDS.dest_country, font);
  drawText(page, placeDate,                       FED_EX_FIELDS.place_date,     font);
  drawText(page, 'Signature',                     FED_EX_FIELDS.signature_hint, font);

  const pdfBytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="DLE_FEDEX_${data.sid}.pdf"`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).send(Buffer.from(pdfBytes));
}

async function renderUPSPDF({ ship }, res){
  const { pdf, font } = await loadPdfTemplate(PDF_UPS);
  const page = pdf.getPage(0);
  const data = buildDLEData(ship);

  UPS_WHITE.forEach(r => whiteout(page, r));

  // “Il sottoscritto …” = referente se presente, altrimenti ragione sociale
  const sottoscritto = data.mitt.ref || data.mitt.rs;

  drawText(page, sottoscritto,  UPS_FIELDS.sottoscritto, font);
  drawText(page, data.mitt.rs,  UPS_FIELDS.societa,     font);
  drawText(page, data.mitt.city,UPS_FIELDS.luogo,       font);
  drawText(page, data.dateStr,  UPS_FIELDS.data,        font);
  drawText(page, 'Firma',       UPS_FIELDS.firma_hint,  font);

  const pdfBytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="DLE_UPS_${data.sid}.pdf"`);
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.status(200).send(Buffer.from(pdfBytes));
}
// --- FINE BLOCCO DA INCOLLARE ---


// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const rawType = String(q.type || 'proforma').toLowerCase();
    const type    = normalizeType(rawType);
    const sidRaw  = q.sid || q.ship;
    const sig     = q.sig;
    const exp     = q.exp;

    const carrierOverride = (q.carrier || q.courier || '').toString().trim();

    if (!sidRaw) return bad(res, 400, 'Bad request', 'Missing sid/ship');
    if (!verifySigFlexible({ sid: sidRaw, rawType, normType: type, exp, sig })) {
      return bad(res, 401, 'Unauthorized', 'Invalid signature');
    }

    const ship = await getShipmentBySid(sidRaw);
    if (!ship) return bad(res, 404, 'Not found', `No shipment found for ${sidRaw}`);

    // DLE (PDF)
    if (type === 'dle' || type === 'dle_fedex' || type === 'dle_ups') {
      const carrierFromShip = get(ship.fields, ['Corriere','Carrier'], '');
      const carrier = (carrierOverride || carrierFromShip || '').toUpperCase();

      if (type === 'dle_fedex' || carrier.includes('FEDEX')) {
        return await renderFedExPDF({ ship }, res);
      }
      if (type === 'dle_ups' || carrier.includes('UPS')) {
        return await renderUPSPDF({ ship }, res);
      }

      // fallback HTML
      const html = renderDLEHTML({ ship });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      return res.status(200).send(html);
    }

    // Invoices
    const pl = await getPLRows({ ship, sidRaw });
    const items = pl.length ? pl.map((r, i) => {
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

      const price   = (type === 'proforma') ? 2 : (Number(f['Prezzo'] ?? 0) || 0);
      const amount  = qty * price;

      const metaBits = [];
      if (abv) metaBits.push(`ABV: ${abv}% vol`);
      metaBits.push(`Net: ${netLine.toFixed(1)} kg`);
      metaBits.push(`Gross: ${grsLine.toFixed(1)} kg`);
      const meta = metaBits.join(' · ');
      return { title: title || '—', qty, price, amount, meta, netLine, grsLine, hs };
    }) : [{ title:'—', qty:0, price:(type==='proforma'?2:0), amount:0, meta:'', netLine:0, grsLine:0, hs:'' }];

    const totalMoney = items.reduce((s, r) => s + num(r.amount), 0);
    const totalNet   = items.reduce((s, r) => s + num(r.netLine), 0);
    const totalGross = items.reduce((s, r) => s + num(r.grsLine), 0);

    const ccy = get(ship.fields, ['Valuta', 'Currency'], 'EUR');
    const ccySym = ccy === 'EUR' ? '€' : (ccy || '€');
    const incoterm  = get(ship.fields, ['Incoterm'], '');
    const carrier   = (carrierOverride || get(ship.fields, ['Corriere', 'Carrier'], '—'));

    const html = renderInvoiceHTML({
      type,
      ship: { ...ship, fields: { ...(ship.fields||{}), Carrier: carrier, Corriere: carrier, Valuta: ccy, Currency: ccy, Incoterm: incoterm } },
      lines: items,
      total: totalMoney,
      totalsWeights: { net: totalNet, gross: totalGross },
    });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(html);
  } catch (err) {
    try { return bad(res, 500, 'Render error', String(err?.message || err)); }
    catch {}
  }
}
