// api/docs/unified/dle_html.js
// HTML renderer "da zero" per DLE (UPS/FedEx) — nessun PDF di riferimento.
// Stampa perfetta via browser (Print / Save as PDF).
// Parametri: ?sid|ship & type=(dle|dle:ups|dle:fedex) & exp & sig
// Firma HMAC compatibile con gli altri endpoint.

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

// ---------- HTML templates ----------
function baseCSS() {
  return `
  *{box-sizing:border-box}
  html,body{margin:0;background:#fff;color:#0b0f13;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  @page{size:A4;margin:18mm 16mm}
  .page{width:210mm;min-height:297mm;margin:0 auto;position:relative}
  .printbar{position:sticky;top:0;background:#fff;padding:8px 0 12px;display:flex;gap:8px;justify-content:flex-end}
  .btn{font-size:12px;border:1px solid #e5e7eb;background:#fff;padding:6px 10px;border-radius:8px;cursor:pointer}
  .btn:hover{background:#f9fafb}
  @media print {.printbar{display:none}}
  .header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  .brand{max-width:60%}
  .rs{font-size:22px;font-weight:800;color:#111827}
  .meta{margin-top:6px;font-size:12px;color:#6b7280}
  .box{border:1px solid #e5e7eb;border-radius:10px;padding:10px}
  .title{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#111827;font-weight:800}
  .kv{margin-top:6px;font-size:12px}
  .kv div{margin:2px 0}
  hr.sep{border:none;border-top:1px solid #e5e7eb;margin:16px 0}
  h3{margin:0 0 8px;font-size:12px;color:#374151;text-transform:uppercase;letter-spacing:.08em}
  .small{font-size:12px;color:#374151}
  .muted{color:#6b7280}
  ul.list{margin:8px 0 8px 18px;padding:0}
  ul.list li{margin:6px 0;font-size:12px}
  .footer{margin-top:18px;font-size:12px;color:#374151}
  .signrow{margin-top:10px;display:flex;gap:18px;align-items:flex-end}
  .sigbox{height:64px;border:1px dashed #d1d5db;border-radius:10px;width:260px}
  `;
}

// UPS-like
function renderUPSHTML({ data }) {
  const place = data.mitt.city || '';
  return `<!doctype html><html lang="it"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>DLE UPS — ${escapeHTML(data.sid)}</title>
  <style>${baseCSS()}</style></head><body>
  <div class="page">
    <div class="printbar"><button class="btn" onclick="window.print()">Print / Save PDF</button></div>

    <div class="header">
      <div class="brand">
        <div class="rs">${escapeHTML(data.mitt.rs)}</div>
        <div class="meta">Shipment ID: ${escapeHTML(data.sid)}${data.mitt.email ? ' · '+escapeHTML(data.mitt.email):''}${data.mitt.tel ? ' · '+escapeHTML(data.mitt.tel):''}</div>
      </div>
      <div class="box" style="min-width:280px">
        <div class="title">Dichiarazione di Libera Esportazione</div>
        <div class="kv">
          <div><strong>Data:</strong> ${escapeHTML(data.dateStr)}</div>
          <div><strong>Luogo:</strong> ${escapeHTML(place)}</div>
        </div>
      </div>
    </div>

    <hr class="sep"/>

    <div class="small"><strong>A:</strong> ${escapeHTML(data.carrier || 'UPS')}</div>

    <div class="box" style="margin-top:12px">
      <h3>Il sottoscritto</h3>
      <div class="small"><strong>${escapeHTML(data.mitt.ref || data.mitt.rs)}</strong></div>
      <div class="small">della società <strong>${escapeHTML(data.mitt.rs)}</strong></div>
    </div>

    <div class="box" style="margin-top:12px">
      <h3>Dichiara che</h3>
      <ul class="list">
        <li>I beni non rientrano nell’elenco CITES (Reg. (CE) n. 338/97).</li>
        <li>I beni non sono beni culturali ai sensi del Reg. (CE) n. 116/2009.</li>
        <li>I beni non sono soggetti al Reg. (UE) n. 821/2021 (prodotti a duplice uso).</li>
        <li>I beni non rientrano nel Reg. (UE) n. 125/2019 (merci utilizzabili per pene capitali o tortura).</li>
        <li>I beni non contengono pellicce di cane o gatto (Reg. (CE) n. 1523/2007).</li>
        <li>I beni non sono soggetti al Reg. (UE) n. 649/2012 (sostanze chimiche pericolose).</li>
        <li>I beni non rientrano nel Reg. (UE) n. 590/2024 (sostanze che riducono lo strato di ozono).</li>
        <li>I beni non sono soggetti al Reg. (CE) n. 1013/2006 (spedizioni di rifiuti).</li>
        <li>I beni non sono soggetti alle misure restrittive UE (1210/2003 Iraq; 2016/44 Libia; 36/2012 Siria; 765/2006 Bielorussia; 833/2014 & 2014/512/PESC Russia/Ucraina; 692/2014 Crimea/Sevastopoli; 2022/263 Territori ucraini occupati).</li>
        <li>I beni sono destinati esclusivamente a uso civile e non hanno finalità dual-use o militari.</li>
      </ul>
    </div>

    <div class="footer">
      <div><strong>Luogo:</strong> ${escapeHTML(place)}</div>
      <div><strong>Data:</strong> ${escapeHTML(data.dateStr)}</div>
      <div class="signrow">
        <div><strong>Firma:</strong></div>
        <div class="sigbox"></div>
      </div>
    </div>
  </div>
  </body></html>`;
}

// FedEx-like
function renderFedExHTML({ data }) {
  const addr = [data.addr, data.vatTel].filter(Boolean).join('<br/>');
  const place = data.mitt.city || '';
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Export Free Declaration — ${escapeHTML(data.sid)}</title>
  <style>${baseCSS()}</style></head><body>
  <div class="page">
    <div class="printbar"><button class="btn" onclick="window.print()">Print / Save PDF</button></div>

    <div class="header">
      <div class="brand">
        <div class="rs">${escapeHTML(data.mitt.rs)}</div>
        <div class="meta">Shipment ID: ${escapeHTML(data.sid)}${data.mitt.email ? ' · '+escapeHTML(data.mitt.email):''}${data.mitt.tel ? ' · '+escapeHTML(data.mitt.tel):''}</div>
      </div>
      <div class="box" style="min-width:300px">
        <div class="title">Export Free Declaration</div>
        <div class="kv">
          <div><strong>Date:</strong> ${escapeHTML(data.dateStr)}</div>
          <div><strong>Place:</strong> ${escapeHTML(place)}</div>
          <div><strong>Invoice No.:</strong> ${escapeHTML(data.invNo)}</div>
        </div>
      </div>
    </div>

    <hr class="sep"/>

    <div class="small"><strong>To:</strong> ${escapeHTML(data.carrier || 'FedEx')}</div>

    <div class="box" style="margin-top:12px">
      <h3>Shipper</h3>
      <div class="small"><strong>${escapeHTML(data.mitt.rs)}</strong></div>
      <div class="small">${addr}</div>
      <div class="small">Origin Country: ITALY · Destination Country: ${escapeHTML((data.destCountry||'').toUpperCase())}</div>
    </div>

    <div class="box" style="margin-top:12px">
      <h3>Declaration</h3>
      <ul class="list">
        <li>Are not included in the CITES list (Council Regulation (EC) No. 338/97).</li>
        <li>Are not cultural goods under Council Regulation (EC) No. 116/2009.</li>
        <li>Are not subject to Regulation (EU) No. 821/2021 (dual-use items).</li>
        <li>Are not covered by Regulation (EU) No. 125/2019 on certain goods used for capital punishment or torture.</li>
        <li>Do not contain cat or dog fur (Council Regulation (EC) No. 1523/2007).</li>
        <li>Are not subject to Regulation (EU) No. 649/2012 (hazardous chemicals).</li>
        <li>Are not included in Regulation (EU) No. 590/2024 (ozone-depleting substances).</li>
        <li>Are not subject to Regulation (EC) No. 1013/2006 (shipments of waste).</li>
        <li>Are not included in restrictive measures under: 1210/2003 (Iraq), 2016/44 (Libya), 36/2012 (Syria), 765/2006 (Belarus), 833/2014 & 2014/512/CFSP (Russia/Ukraine), 692/2014 (Crimea/Sevastopol), 2022/263 (Ukrainian territories occupied by the Russian Federation).</li>
        <li>Are intended exclusively for civilian use and have no dual-use or military purpose.</li>
      </ul>
    </div>

    <div class="footer">
      <div><strong>Place:</strong> ${escapeHTML(place)}</div>
      <div><strong>Date:</strong> ${escapeHTML(data.dateStr)}</div>
      <div class="signrow">
        <div><strong>Signature of Shipper:</strong></div>
        <div class="sigbox"></div>
      </div>
    </div>
  </div>
  </body></html>`;
}

function escapeHTML(x=''){ return String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const rawType = String(q.type || 'dle').toLowerCase();
    const type    = normalizeType(rawType);
    const sid     = q.sid || q.ship;
    const sig     = q.sig;
    const exp     = q.exp;

    if (!sid) return res.status(400).send('Missing sid/ship');
    if (!verifySigFlexible({ sid, rawType, normType: type, exp, sig })) {
      return res.status(401).send('Invalid signature');
    }

    const ship = await getShipmentBySid(sid);
    if (!ship) return res.status(404).send(`No shipment found for ${sid}`);

    const data = extractDLE(ship);

    // autodetect carrier if 'dle_auto'
    const carrierUp = (data.carrier || '').toUpperCase();
    let layout = type;
    if (type === 'dle_auto') {
      if (carrierUp.includes('UPS')) layout = 'dle_ups';
      else if (carrierUp.includes('FEDEX')) layout = 'dle_fedex';
      else layout = 'dle_fedex'; // default english layout
    }

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
