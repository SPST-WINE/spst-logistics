// api/docs/unified/dle_html.js
// HTML renderer “da zero” per DLE (UPS / FedEx) con routing affidabile al layout selezionato.
// Accetta anche override via query: ?carrier=UPS|FEDEX oppure ?tpl=ups|fedex
// Parametri HMAC: ?sid|ship & type=(dle|dle:ups|dle:fedex) & exp & sig

export const config = { runtime: 'nodejs' };

import crypto from 'node:crypto';

// ---------- ENV ----------
const AIRTABLE_PAT      = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID;
const DOCS_SIGN_SECRET  = process.env.DOCS_SIGN_SECRET || '';
const BYPASS_SIGNATURE  = process.env.BYPASS_SIGNATURE === '1';
const DEBUG_DOCS        = process.env.DEBUG_DOCS === '1';

// ---------- LOG ----------
const dlog = (...a)=>{ if (DEBUG_DOCS) console.log('[dle-html]', ...a); };
const derr = (...a)=>{ console.error('[dle-html:ERR]', ...a); };

// ---------- Airtable ----------
const API_ROOT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const TB_SPEDIZIONI = 'SpedizioniWebApp';

async function airFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json', ...(init.headers||{}) },
    cache: 'no-store'
  });
  const t = await res.text();
  if (!res.ok) throw new Error(`Airtable ${res.status}: ${t || ''}`);
  return t ? JSON.parse(t) : null;
}
async function getShipmentBySid(sid) {
  if (/^rec[0-9A-Za-z]{14}/.test(String(sid))) {
    try { return await airFetch(`${API_ROOT}/${encodeURIComponent(TB_SPEDIZIONI)}/${encodeURIComponent(sid)}`); }
    catch { /* noop */ }
  }
  const candidates = [
    'ID Spedizione','Id Spedizione','ID spedizione','id spedizione',
    'ID\u00A0Spedizione','IDSpedizione','Spedizione - ID','Shipment ID','ID'
  ];
  const safe = String(sid).replace(/'/g, "\\'");
  for (const field of candidates) {
    const url = `${API_ROOT}/${encodeURIComponent(TB_SPEDIZIONI)}?filterByFormula=${encodeURIComponent(`{${field}}='${safe}'`)}&maxRecords=1`;
    try {
      const data = await airFetch(url);
      const rec = data?.records?.[0];
      if (rec) return rec;
    } catch {/* try next */}
  }
  return null;
}

// ---------- Signature ----------
function safeEqual(a,b){ try{ return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }catch{ return false; } }
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

// ---------- Utils ----------
const get = (obj, keys, def = '') => { for (const k of keys) { const v = obj?.[k]; if (v!==undefined && v!==null && v!=='') return v; } return def; };
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString('it-IT'); } catch { return ''; } };
function normalizeType(t) {
  const raw = String(t || 'dle').toLowerCase().trim();
  if (raw.includes('ups')) return 'dle_ups';
  if (raw.includes('fedex')) return 'dle_fedex';
  return 'dle_auto';
}
function escapeHTML(x=''){ return String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }

// ---------- Data extraction ----------
function extractDLE(ship){
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
  const destCountry = get(f, ['Destinatario - Paese'], '');
  const sid   = get(f, ['ID Spedizione','Id Spedizione'], ship.id);
  const invNo = get(f, ['Fattura - Numero','Commercial Invoice - Numero','Proforma - Numero'], '') || `CI-${sid}`;
  const pickup= get(f, ['Ritiro - Data'], '') || f['Ritiro Data'];
  const dateStr = fmtDate(pickup) || fmtDate(Date.now());
  const carrier = get(f, ['Corriere','Carrier'], '');
  const addr   = [mitt.ind, `${mitt.cap} ${mitt.city}`, mitt.country].filter(Boolean).join(' · ');
  const vatTel = [mitt.piva && `VAT/CF: ${mitt.piva}`, mitt.tel && `TEL: ${mitt.tel}`].filter(Boolean).join(' · ');
  return { mitt, destCountry, sid, invNo, dateStr, carrier, addr, vatTel };
}

// ---------- HTML base CSS ----------
function baseCSS() {
  return `
  *{box-sizing:border-box}
  html,body{margin:0;background:#fff;color:#111827;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  @page{size:A4;margin:18mm 16mm}
  .page{width:210mm;min-height:297mm;margin:0 auto;position:relative}
  .printbar{position:sticky;top:0;background:#fff;padding:8px 0 12px;display:flex;gap:8px;justify-content:flex-end}
  .btn{font-size:12px;border:1px solid #e5e7eb;background:#fff;padding:6px 10px;border-radius:8px;cursor:pointer}
  .btn:hover{background:#f9fafb}
  @media print {.printbar{display:none}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  .brand{max-width:62%}
  .rs{font-size:22px;font-weight:800;color:#111827}
  .meta{margin-top:6px;font-size:12px;color:#6b7280}
  .box{border:1px solid #e5e7eb;border-radius:10px;padding:12px}
  .title{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#0b0f13;font-weight:800}
  .kv{margin-top:6px;font-size:12px}
  .kv div{margin:2px 0}
  hr.sep{border:none;border-top:1px solid #e5e7eb;margin:16px 0}
  h3{margin:0 0 8px;font-size:12px;color:#374151;text-transform:uppercase;letter-spacing:.08em}
  .small{font-size:12px;color:#374151}
  .muted{color:#6b7280}
  ul.list{margin:8px 0 8px 18px;padding:0}
  ul.list li{margin:6px 0;font-size:12px;line-height:1.5}
  .footer{margin-top:18px;font-size:12px;color:#374151}
  .signrow{margin-top:10px;display:flex;gap:18px;align-items:flex-end}
  .sigbox{height:64px;border:1px dashed #d1d5db;border-radius:10px;width:260px}
  .letterhead{white-space:pre-line}
  .subject{margin:14px 0 8px;font-weight:700}
  .addrBlock{line-height:1.5}
  .checkbox{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace}
  `;
}

// ---------- FedEx-like ----------
// Sostituisci INTERA funzione renderFedExHTML in api/docs/unified/dle_html.js

function renderFedExHTML({ data }) {
  const place = data.mitt.city || '';
  const placeCap = `${escapeHTML(place)} ${escapeHTML(data.mitt.cap || '')}`.trim();
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Export Free Declaration — ${escapeHTML(data.sid)}</title>
  <style>${baseCSS()}</style></head><body>
  <div class="page">
    <div class="printbar"><button class="btn" onclick="window.print()">Print / Save PDF</button></div>

    <div style="font-size:11px;color:#4b5563;margin-bottom:8px"><em>(If the consignor is a company, the Declaration below must be printed on company letterhead)</em></div>
    <div class="small" style="margin-bottom:8px"><strong>To the attention of the Customs Agency</strong></div>

    <!-- Sender details compatti, senza box -->
    <div class="letterhead">
      <div class="title" style="margin-bottom:4px">Sender details</div>
      <div class="small" style="margin:2px 0"><strong>${escapeHTML(data.mitt.rs)}</strong></div>
      ${data.mitt.piva ? `<div class="small" style="margin:2px 0">VAT/CF: ${escapeHTML(data.mitt.piva)}</div>` : ``}
      <div class="small" style="margin:2px 0">${escapeHTML(data.mitt.ind)}</div>
      <div class="small" style="margin:2px 0">${escapeHTML(data.mitt.city)}${data.mitt.cap ? ', ' + escapeHTML(data.mitt.cap) : ''}</div>
      <div class="small" style="margin:2px 0">${escapeHTML(data.mitt.country)}</div>
      ${data.mitt.tel ? `<div class="small" style="margin:2px 0">Tel: ${escapeHTML(data.mitt.tel)}</div>` : ``}
    </div>

    <div class="small" style="margin:10px 0 8px 0">
      While accepting all consequent responsibilities for the shipment we hereby declare that none of the goods in export are subject to any export license and therefore:
    </div>

    <!-- Tutto testo semplice, nessun box -->
    <div>
      <div class="small checkbox">☐ GOODS OF EU PREFERENTIAL ORIGIN</div>
      <div class="muted" style="font-size:11px;margin-top:4px">(please mark the box in case of goods of EU preferential origin and fill in the following mandatory declaration)</div>

      <h3 style="margin-top:10px">Declaration</h3>
      <div class="small">
        I, the undersigned, declare that the goods listed on this document (invoice number)
        <strong>${escapeHTML(data.invNo)}</strong> originate in <strong>ITALY</strong> and satisfy the rules of origin governing preferential trade with
        <strong>${escapeHTML((data.destCountry || '').toUpperCase())}</strong>.
      </div>
      <div class="small checkbox" style="margin-top:8px">☐ Cumulation applied with ……………………….. (name of the country/countries)</div>
      <div class="small checkbox">☑ No cumulation applied (origin from a single country)</div>

      <div class="small" style="margin-top:10px">
        I undertake to make available to the customs authorities any further supporting documents they may require (for example: invoices, import documentation, statement of origin, invoice declaration, producer/manufacturer declaration, extracts of accounting documents, extracts of technical documentation, etc.):
      </div>
      <div class="muted" style="margin-top:4px;line-height:1.8">
        ..........................................................................................................................<br/>
        ..........................................................................................................................<br/>
        ..........................................................................................................................
      </div>
    </div>

    <div>
      <h3 style="margin-top:12px">Goods destined to Turkey</h3>
      <div class="small checkbox">☐ GOODS DESTINED TO TURKEY</div>
      <div class="small" style="margin-top:6px">
        I declare that the goods meet the requirements for the application of EU/Turkey Agreement (Decision n.1/95 of the Council of Association EC-Turkey, of 22/12/1995 and 2006/646/EC: Decision n.1/2006 of the Customs Cooperation Committee EC-Turkey, of 26/09/2006)
      </div>

      <h3 style="margin-top:10px">Mandate to issue EUR1/EUR-MED/ATR certificate</h3>
      <div class="small">
        We assign to <strong>FedEx</strong> the mandate to proceed with customs clearance activities, to issue, sign on our behalf and file the EUR1/EUR-MED/ATR certificate, relieving <strong>FedEx</strong> of any responsibilities directly or indirectly associated with the fulfillment of the above indicated procedure.
      </div>
    </div>

    <div>
      <h3 style="margin-top:12px">Regulatory statements</h3>
      <ul class="list">
        <li><strong>Dual use (Y901):</strong> The goods are not included in the list of products as per Council Regulation (EC) No. 428/09 and its amendments; the goods are only for civil use.</li>
        <li><strong>Washington Convention (Y900):</strong> The goods are not included in the list as per Council Regulation (EC) No. 338/97 and its amendments (CITES).</li>
        <li><strong>Cat and dog fur (Y922):</strong> The goods are not cat and dog fur and/or products which contain them, as per Council Regulation (EC) No. 1523/07 and its amendments.</li>
        <li><strong>Ozone (Y902):</strong> The goods are not included in the list of substances that cause ozone layer depletion as per Council Regulation (EC) No. 1005/09 and its modifications.</li>
        <li><strong>Cultural goods (Y903):</strong> The goods are not included in the list as per Council Regulation (EC) No. 116/09 and its amendments (export of cultural goods).</li>
        <li><strong>Dangerous chemical substances (Y916 – Y917):</strong> The goods are not included in the lists of Regulation (EU) No. 649/2012 and its amendments.</li>
        <li><strong>Goods used for death penalty, torture etc. (Y904 – Y906 – Y907 – Y908):</strong> The goods are not included in the lists of Council Regulation (EC) No. 1236/05 and its amendments.</li>
        <li><strong>Restrictive measures / specific countries:</strong> The goods are not included in the lists of the following measures:
          Zimbabwe (Reg. (EC) No. 314/04), Côte d’Ivoire (CFSP 2016/917), DPRK (Reg. (EU) No. 1509/17), Myanmar (Reg. (EU) No. 401/13), Libya (Reg. (EU) No. 44/16), Syria (Reg. (EU) No. 36/12), Iran (Reg. (EU) No. 267/12), Sudan (Reg. (EU) No. 747/14).</li>
        <li><strong>Y935:</strong> Not included in the measures of Reg. (EU) No. 1332/13 (Syria).</li>
        <li><strong>Goods sent to Russia (Y939 – Y920):</strong> Not included in the measures of Reg. (EU) No. 833/14 and Council Decision 2014/512 and amendments.</li>
        <li><strong>Waste (Y923):</strong> Not included in the measures of Regulation (EC) No. 1013/2006 and amendments (shipments of waste).</li>
      </ul>
    </div>

    <!-- Footer: Shipment ID vicino a place & date; firma a destra coi puntini -->
    <div class="footer" style="margin-top:16px">
      <div><strong>Place and date:</strong> ${placeCap} — ${escapeHTML(data.dateStr)} · <strong>Shipment ID:</strong> ${escapeHTML(data.sid)}</div>
      <div style="text-align:right;margin-top:8px">..............................</div>
      <div class="muted" style="text-align:right">Signature of Shipper</div>
    </div>
  </div>
  </body></html>`;
}


// ---------- UPS-like ----------
function renderUPSHTML({ data }) {
  const place = data.mitt.city || '';
  return `<!doctype html><html lang="it"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Dichiarazione di Libera Esportazione — ${escapeHTML(data.sid)}</title>
  <style>${baseCSS()}</style></head><body>
  <div class="page">
    <div class="printbar"><button class="btn" onclick="window.print()">Stampa / Salva PDF</button></div>

    <!-- BLOCCO DESTINATARIO ALLINEATO A DESTRA -->
    <div class="addrBlock small" style="text-align:right; margin-left:auto; max-width:280px">
      <div><strong>Spettabile</strong></div>
      <div><strong>UPS ITALIA Srl</strong></div>
      <div>Via Orio al Serio 49/51</div>
      <div>24050 Grassobbio</div>
      <div style="margin-top:6px"><strong>Attn. EXPORT DEPARTMENT</strong></div>
    </div>

    <div class="subject small">Oggetto: dichiarazione di libera esportazione</div>

    <div class="small" style="margin-top:10px">
      Il sottoscritto <strong>${escapeHTML(data.mitt.ref || data.mitt.rs)}</strong> in qualità di <strong>MITTENTE</strong> dichiara sotto la propria personale responsabilità che tutte le merci che la
    </div>
    <div class="small"><strong>società ${escapeHTML(data.mitt.rs)}</strong></div>
    <div class="small">affida ad UPS Italia SRL:</div>

    <div class="box" style="margin-top:12px">
      <ul class="list">
        <li>Non rientrano tra quelle protette dalla Convenzione di Washington (CITES), come da regolamento (CE) n. 338/97 del Consiglio del 9 dicembre 1996 e successive modifiche relativo alla protezione di specie della flora e della fauna selvatiche mediante il controllo del loro commercio.</li>
        <li>Non rientrano nell’elenco dei beni come da regolamento (CE) n. 116/2009 del Consiglio del 18 dicembre 2008 relativo all’esportazione di beni culturali.</li>
        <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 821/2021 del Parlamento europeo e del Consiglio del 20 maggio 2021 e successive modifiche che istituisce un regime dell’Unione di controllo delle esportazioni, dell’intermediazione, dell’assistenza tecnica, del transito e del trasferimento di prodotti a duplice uso.</li>
        <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 125/2019 del Parlamento europeo e del Consiglio del 16 gennaio 2019 e successive modifiche relativo al commercio di determinate merci che potrebbero essere utilizzate per la pena di morte, per la tortura o per altri trattamenti o pene crudeli, inumani o degradanti.</li>
        <li>Non contengono pelliccia di cane e di gatto in conformità al regolamento (CE) n. 1523/2007 del Parlamento europeo e del Consiglio dell’11 dicembre 2007.</li>
        <li>Non sono soggette alle disposizioni del regolamento (UE) n. 649/2012 del Parlamento europeo e del Consiglio del 4 luglio 2012 e successive modifiche sull’esportazione ed importazione di sostanze chimiche pericolose.</li>
        <li>Non rientrano nell’elenco dei beni come da regolamento (UE) 590/2024 del Parlamento europeo e del Consiglio del 7 febbraio 2024 e successive modifiche sulle sostanze che riducono lo strato di ozono.</li>
        <li>Non sono soggette alle disposizioni del regolamento (CE) n. 1013/2006 del Parlamento europeo e del Consiglio del 14 giugno 2006 e successive modifiche relativo alle spedizioni di rifiuti.</li>
        <li>Non rientrano nell’elenco dei beni come da regolamento (CE) n. 1210/2003 del Consiglio del 7 luglio 2003 e successive modifiche relativo a talune specifiche restrizioni alle relazioni economiche e finanziarie con l’Iraq.</li>
        <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 2016/44 del Consiglio del 18 gennaio 2016 e successive modifiche concernente misure restrittive in considerazione della situazione in Libia.</li>
        <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 36/2012 del Consiglio del 18 gennaio 2012 e successive modifiche concernente misure restrittive in considerazione della situazione in Siria.</li>
        <li>Non sono soggette alle disposizioni del regolamento (CE) n. 765/2006 del Consiglio del 18 maggio 2006 e successive modifiche concernente misure restrittive nei confronti della Bielorussia.</li>
        <li>Non sono soggette alle disposizioni del regolamento (UE) n. 833/2014 del Consiglio del 31 luglio 2014 e successive modifiche concernente misure restrittive in considerazione delle azioni della Russia che destabilizzano la situazione in Ucraina.</li>
        <li>Non sono soggette alle disposizioni della decisione 2014/512/PESC del Consiglio del 31 luglio 2014 e successive modifiche concernente misure restrittive in considerazione delle azioni della Russia che destabilizzano la situazione in Ucraina.</li>
        <li>Non sono soggette alle disposizioni del regolamento (UE) n. 692/2014 del Consiglio del 23 giugno 2014 e successive modifiche concernente restrizioni sulle importazioni nell'Unione di merci originarie della Crimea o Sebastopoli, in risposta all'annessione illegale della Crimea e di Sebastopoli.</li>
        <li>Non sono soggette alle disposizioni del regolamento (UE) n. 2022/263 del Consiglio del 23 febbraio 2022 e successive modifiche concernente misure restrittive in risposta al riconoscimento, all'occupazione o all'annessione illegali da parte della Federazione russa di alcune zone dell'Ucraina non controllate dal governo.</li>
      </ul>
    </div>

    <div class="footer" style="margin-top:16px">
      <div><strong>Luogo</strong> ${escapeHTML(place)}</div>
      <div><strong>Data</strong> ${escapeHTML(data.dateStr)}</div>
      <!-- Shipment ID sotto Luogo e Data -->
      <div class="muted" style="margin-top:10px">Shipment ID: ${escapeHTML(data.sid)}</div>

      <!-- LINEA + (timbro e firma) ALLINEATI A DESTRA -->
      <div style="margin-top:10px; text-align:right">
        <div>.......................................................................</div>
        <div class="muted">(timbro e firma)</div>
      </div>
    </div>
  </div>
  </body></html>`;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const rawType = String(q.type || 'dle').toLowerCase();
    const type    = normalizeType(rawType);
    const sid     = q.sid || q.ship;
    const sig     = q.sig;
    const exp     = q.exp;

    // NUOVO: override esplicito da query
    const carrierOverride = (q.carrier || q.courier || '').toString().trim();
    const tplOverride     = (q.tpl || q.template || q.dleTpl || q.dle_template || q.dleTemplate || '').toString().trim();

    if (!sid) return res.status(400).send('Missing sid/ship');
    if (!verifySigFlexible({ sid, rawType, normType: type, exp, sig })) {
      return res.status(401).send('Invalid signature');
    }

    const ship = await getShipmentBySid(sid);
    if (!ship) return res.status(404).send(`No shipment found for ${sid}`);

    const data = extractDLE(ship);

    // Routing layout con priorità: type esplicito > tplOverride > carrierOverride > carrier da Airtable > default FedEx
    let layout = type; // 'dle_ups' | 'dle_fedex' | 'dle_auto'
    if (layout === 'dle_auto') {
      const pref = (tplOverride || carrierOverride).toString().toLowerCase();
      const fromShip = (data.carrier || '').toLowerCase();
      if (pref.includes('ups') || pref === 'ups') layout = 'dle_ups';
      else if (pref.includes('fedex') || pref === 'fedex' || pref === 'fx') layout = 'dle_fedex';
      else if (fromShip.includes('ups')) layout = 'dle_ups';
      else if (fromShip.includes('fedex') || fromShip.includes('fx')) layout = 'dle_fedex';
      else layout = 'dle_fedex';
    }

    dlog('layout chosen:', layout, {
      typeRaw: rawType, tplOverride, carrierOverride, shipCarrier: data.carrier
    });

    const html = (layout === 'dle_ups')
      ? renderUPSHTML({ data })
      : renderFedExHTML({ data });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).send(html);
  } catch (err) {
    derr('error', err?.message || err);
    try { return res.status(500).send('Server error'); } catch {}
  }
}
