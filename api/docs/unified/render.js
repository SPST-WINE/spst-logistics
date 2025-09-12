// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

/**
 * Unified HTML renderer for Proforma / Commercial Invoice (no-headless browser).
 * - ?sid=... (or ?ship=...)
 * - ?type=proforma|commercial  (default: proforma)
 * - ?exp=unixSeconds  & ?sig=hex(hmacSha256(`${sid}.${type}.${exp}`, DOCS_SIGN_SECRET))  (optional if BYPASS_SIGNATURE=1)
 *
 * Tables:
 *   - Shipments: "SpedizioniWebApp"
 *   - Lines:     "SPED_PL"
 */

import crypto from 'node:crypto';

// ---------- ENV ----------
const AIRTABLE_PAT      = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID;
const DOCS_SIGN_SECRET  = process.env.DOCS_SIGN_SECRET || '';
const BYPASS_SIGNATURE  = process.env.BYPASS_SIGNATURE === '1';

const TB_SPEDIZIONI = 'SpedizioniWebApp';
const TB_PL         = 'SPED_PL';

if (!AIRTABLE_PAT || !AIRTABLE_BASE_ID) {
  console.warn('[render] Missing Airtable envs');
}

// ---------- Airtable helpers ----------
const API_ROOT = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;

function tableURL(tableName) {
  return `${API_ROOT}/${encodeURIComponent(tableName)}`;
}
function recordURL(tableName, recId) {
  return `${tableURL(tableName)}/${encodeURIComponent(recId)}`;
}

async function airFetch(url, init={}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`Airtable ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Field alias fallback for "ID Spedizione" ----------
const SID_FIELD_CANDIDATES = [
  'ID Spedizione',
  'Id Spedizione',
  'ID spedizione',
  'id spedizione',
  'ID\u00A0Spedizione',        // NBSP
  'IDSpedizione',
  'Spedizione ID',
  'Spedizione - ID',
  'ID'
];

async function findOneByFieldAliases(tableName, value) {
  const safe = String(value).replace(/'/g, "\\'");
  for (const field of SID_FIELD_CANDIDATES) {
    const formula = `{${field}}='${safe}'`;
    const url = `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
    try {
      const data = await airFetch(url);
      if (data.records && data.records.length) {
        return { record: data.records[0], fieldUsed: field };
      }
    } catch (err) {
      if (err?.status === 422) continue; // invalid field -> try next alias
      throw err;
    }
  }
  return { record: null, fieldUsed: null };
}

async function findManyByFieldAliases(tableName, value) {
  const safe = String(value).replace(/'/g, "\\'");
  for (const field of SID_FIELD_CANDIDATES) {
    let next = `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(`{${field}}='${safe}'`)}&pageSize=100`;
    const rows = [];
    try {
      while (next) {
        const data = await airFetch(next);
        rows.push(...(data.records || []));
        next = data.offset
          ? `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(`{${field}}='${safe}'`)}&pageSize=100&offset=${data.offset}`
          : null;
      }
      if (rows.length) return { rows, fieldUsed: field };
    } catch (err) {
      if (err?.status === 422) { next = null; continue; }
      throw err;
    }
  }
  return { rows: [], fieldUsed: null };
}

// ---------- Shipment + PL loaders ----------
async function getShipmentBySid(sid) {
  // direct record id?
  if (/^rec[0-9A-Za-z]{14}/.test(String(sid))) {
    return airFetch(recordURL(TB_SPEDIZIONI, sid));
  }
  const { record } = await findOneByFieldAliases(TB_SPEDIZIONI, sid);
  return record;
}
async function getPLRowsBySid(sidOrRecId) {
  const { rows } = await findManyByFieldAliases(TB_PL, sidOrRecId);
  return rows;
}

// ---------- Signature ----------
function bad(res, code, msg, details) {
  res.status(code).json({ ok:false, error: msg, details });
}
function verifySig({ sid, type, exp, sig }) {
  if (BYPASS_SIGNATURE) return true;
  if (!sid || !type || !exp || !sig) return false;
  const now = Math.floor(Date.now()/1000);
  if (Number(exp) < now) return false;
  const h = crypto.createHmac('sha256', DOCS_SIGN_SECRET);
  h.update(`${sid}.${type}.${exp}`);
  const expected = h.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(sig)));
}

// ---------- Utils ----------
const get = (obj, keys, def='') => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return def;
};
const fmtDate = (d) => {
  try { return new Date(d).toLocaleDateString('it-IT'); }
  catch { return ''; }
};
const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};
const money = (x, ccy='€') =>
  `${ccy} ${num(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ---------- HTML template ----------
function renderHTML({ type, ship, lines, total }) {
  const watermark = type === 'proforma';
  const docTitle  = type === 'proforma' ? 'Proforma Invoice' : 'Commercial Invoice';
  const ccy = get(ship.fields, ['Valuta', 'Currency'], 'EUR');
  const ccySym = ccy === 'EUR' ? '€' : (ccy || '€');

  // Sender (Mittente)
  const senderName = get(ship.fields, ['Mittente - Ragione Sociale'], '—');
  const senderCountry = get(ship.fields, ['Mittente - Paese'], '');
  const senderCity = get(ship.fields, ['Mittente - Città'], '');
  const senderZip = get(ship.fields, ['Mittente - CAP'], '');
  const senderAddr = get(ship.fields, ['Mittente - Indirizzo'], '');
  const senderPhone = get(ship.fields, ['Mittente - Telefono'], '');
  const senderVat = get(ship.fields, ['Mittente - P.IVA/CF'], '');

  // Receiver (Destinatario)
  const rcName = get(ship.fields, ['Destinatario - Ragione Sociale'], '—');
  const rcAddr = get(ship.fields, ['Destinatario - Indirizzo'], '');
  const rcCity = get(ship.fields, ['Destinatario - Città'], '');
  const rcZip  = get(ship.fields, ['Destinatario - CAP'], '');
  const rcCountry = get(ship.fields, ['Destinatario - Paese'], '');
  const rcPhone = get(ship.fields, ['Destinatario - Telefono'], '');

  // Shipment meta
  const sid = get(ship.fields, ['ID Spedizione', 'Id Spedizione'], ship.id);
  const carrier = get(ship.fields, ['Corriere', 'Carrier'], '—');
  const incoterm = get(ship.fields, ['Incoterm'], '');
  const pickupDate = get(ship.fields, ['Ritiro - Data'], '') || ship.fields?.['Ritiro Data'];
  const docNo = type === 'proforma'
    ? (get(ship.fields, ['Proforma - Numero'], '') || `PF-${sid}`)
    : (get(ship.fields, ['Fattura - Numero', 'Commercial Invoice - Numero'], '') || `CI-${sid}`);

  const place = senderCity || '';
  const dateStr = fmtDate(pickupDate) || fmtDate(Date.now());

  const proformaNote = `Goods are not for resale. Declared values are for customs purposes only.`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${docTitle} — ${sid}</title>
<style>
:root{
  --brand:#111827; --accent:#0ea5e9; --text:#0b0f13; --muted:#6b7280;
  --border:#e5e7eb; --border-strong:#d1d5db; --bg:#ffffff; --zebra:#fafafa; --chip:#f3f4f6;
}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative}
.watermark{position:absolute; inset:0; display:${watermark?'flex':'none'}; align-items:center; justify-content:center; pointer-events:none}
.watermark span{opacity:0.06; font-size:180px; letter-spacing:0.22em; transform:rotate(-24deg); font-weight:800; color:#0f172a}

header{display:grid; grid-template-columns:1fr auto; align-items:start; gap:16px}
.brand{max-width:70%}
.tag{display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#374151; background:var(--chip); border:1px solid var(--border); padding:2px 6px; border-radius:6px; margin-bottom:6px}
.logo .word{font-size:26px; font-weight:800; letter-spacing:.01em; color:var(--brand)}
.brand .meta{margin-top:6px; font-size:12px; color:var(--muted)}
.doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:260px}
.doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:${type==='proforma'?'#0ea5e9':'#16a34a'}; font-weight:800}
.doc-meta .kv{margin-top:6px}
.kv div{margin:2px 0}

hr.sep{border:none;border-top:1px solid var(--border); margin:16px 0 18px}

.grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
.card{border:1px solid var(--border); border-radius:12px; padding:12px}
.card h3{margin:0 0 8px; font-size:11px; color:#374151; text-transform:uppercase; letter-spacing:.08em}
.small{font-size:12px; color:#374151}
.mono{font-feature-settings:"tnum" 1; font-variant-numeric: tabular-nums}
.muted{color:var(--muted)}

table.items{width:100%; border-collapse:collapse; font-size:12px; margin-top:16px}
table.items th, table.items td{border-bottom:1px solid var(--border); padding:9px 8px; vertical-align:top}
table.items thead th{font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#374151; text-align:left; background:var(--chip)}
table.items td.num, table.items th.num{text-align:right}
table.items tbody tr:nth-child(odd){background:var(--zebra)}
table.items tbody tr:last-child td{border-bottom:1px solid var(--border-strong)}

.totals{margin-top:10px; display:flex; justify-content:flex-end}
.totals table{font-size:12px; border-collapse:collapse; min-width:260px}
.totals td{padding:8px 10px; border-bottom:1px solid var(--border)}
.totals tr:last-child td{border-top:1px solid var(--border-strong); border-bottom:none; font-weight:700}

footer{margin-top:22px; font-size:11px; color:#374151}
.sign{margin-top:20px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px}
.sign .box{height:64px; border:1px dashed var(--border-strong); border-radius:10px; width:260px}
.sign .label{font-size:11px; color:#374151; margin-bottom:6px}

.printbar{position:sticky; top:0; background:#fff; padding:8px 0 12px; display:flex; gap:8px; justify-content:flex-end}
.btn{font-size:12px; border:1px solid var(--border); background:#fff; padding:6px 10px; border-radius:8px; cursor:pointer}
.btn:hover{background:#f9fafb}
@media print {.printbar{display:none}}
</style>
</head>
<body>
  <div class="page">
    <div class="printbar">
      <button class="btn" onclick="window.print()">Print / Save PDF</button>
    </div>
    <div class="watermark"><span>PROFORMA</span></div>

    <header>
      <div class="brand">
        <div class="tag">Sender</div>
        <div class="logo">
          <div class="word">${escapeHTML(senderName)}</div>
        </div>
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
        <div class="small"><strong>${escapeHTML(rcName)}</strong></div>
        <div class="small">${escapeHTML(rcAddr)}</div>
        <div class="small">${escapeHTML(rcZip)} ${escapeHTML(rcCity)} (${escapeHTML(rcCountry)})</div>
        <div class="small">${rcPhone ? ('Tel: ' + escapeHTML(rcPhone)) : ''}</div>
      </div>
      <div class="card">
        <h3>Shipment Details</h3>
        <div class="small">Carrier: ${escapeHTML(carrier || '—')}</div>
        <div class="small">Incoterm: ${escapeHTML(incoterm || '—')} · Currency: ${escapeHTML(ccy)}</div>
      </div>
    </section>

    <table class="items" aria-label="Goods details">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Description</th>
          <th style="width:90px" class="num">Qty</th>
          <th style="width:120px" class="num">Price</th>
        </tr>
      </thead>
      <tbody>
        ${lines.map((r,i)=>`
          <tr>
            <td>${i+1}</td>
            <td>
              <strong>${escapeHTML(r.title || '—')}</strong>${r.meta?`<br/><span class="muted">${escapeHTML(r.meta)}</span>`:''}
            </td>
            <td class="num mono">${num(r.qty)}</td>
            <td class="num mono">${money(r.price, ccySym)}</td>
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

    <footer>
      ${type==='proforma' ? `<div class="small"><strong>Note:</strong> ${escapeHTML(proformaNote)}</div>` : ''}
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

function escapeHTML(x='') {
  return String(x)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const type = (q.type || 'proforma').toString().toLowerCase() === 'commercial' ? 'commercial' : 'proforma';
    const sidRaw = q.sid || q.ship;
    const sig = q.sig; const exp = q.exp;

    if (!sidRaw) return bad(res, 400, 'Bad request', 'Missing sid/ship');

    if (!verifySig({ sid: sidRaw, type, exp, sig })) {
      return bad(res, 401, 'Unauthorized', 'Invalid signature');
    }

    // Load shipment
    const ship = await getShipmentBySid(sidRaw);
    if (!ship) return bad(res, 404, 'Not found', `No shipment found for ${sidRaw}`);

    // Lines from SPED_PL
    // Try both shipment recordId and business SID
    const plByRec = await getPLRowsBySid(ship.id);
    const plBySid = sidRaw ? await getPLRowsBySid(sidRaw) : [];
    const unique = new Map();
    [...plByRec, ...plBySid].forEach(r => unique.set(r.id, r));
    const pl = [...unique.values()];

    // Build line items with flexible field names
    const items = pl.length ? pl.map(r => {
      const f = r.fields || {};
      const title = get(f, ['Descrizione', 'Description', 'Prodotto', 'Articolo', 'SKU', 'Titolo'], '');
      const qty   = num(get(f, ['Quantità', 'Qta', 'Qtà', 'Qty', 'Pezzi'], 0));
      const price = num(get(f, ['Prezzo', 'Price', 'Valore Unitario', 'Unit Price'], 0));
      const hs    = get(f, ['HS', 'HS code', 'HS Code'], '');
      const origin= get(f, ['Origine', 'Country of origin', 'Origin'], '');

      const metaBits = [];
      if (hs) metaBits.push(`HS: ${hs}`);
      if (origin) metaBits.push(`Origin: ${origin}`);
      const meta = metaBits.join(' · ');

      return { title, qty, price, meta };
    }) : [{
      title: '—',
      qty: 0,
      price: 0,
      meta: ''
    }];

    const total = items.reduce((s, r) => s + num(r.qty) * num(r.price), 0);

    const html = renderHTML({ type, ship, lines: items, total });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
  } catch (err) {
    console.error('[render] error', err);
    return bad(res, 500, 'Render error', String(err?.message || err));
  }
}
