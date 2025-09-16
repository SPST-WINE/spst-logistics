// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

/**
 * HTML renderer for:
 *  - Proforma Invoice
 *  - Commercial Invoice
 *  - DLE (Export Free Declaration)
 *
 * Query:
 *  - sid | ship : shipment identifier (business "ID Spedizione" or Airtable recId)
 *  - type       : proforma | fattura | commercial | commerciale | invoice | dle
 *  - exp, sig   : HMAC-SHA256 over `${sid}.${type}.${exp}` — bypassable with BYPASS_SIGNATURE=1
 *
 * Env:
 *  AIRTABLE_PAT, AIRTABLE_BASE_ID, DOCS_SIGN_SECRET, BYPASS_SIGNATURE=1
 * Tables:
 *  SpedizioniWebApp (shipments), SPED_PL (lines)
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
const tableURL  = (t) => `${API_ROOT}/${encodeURIComponent(t)}`;
const recordURL = (t, id) => `${tableURL(t)}/${encodeURIComponent(id)}`;

async function airFetch(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
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

async function airFetchAll(formula, tableName) {
  const rows = [];
  let next = `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
  while (next) {
    const data = await airFetch(next);
    rows.push(...(data.records || []));
    next = data.offset
      ? `${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&offset=${data.offset}`
      : null;
  }
  return rows;
}

// ---------- Shipment loader ----------
async function getShipmentBySid(sid) {
  if (/^rec[0-9A-Za-z]{14}/.test(String(sid))) {
    return airFetch(recordURL(TB_SPEDIZIONI, sid));
  }
  // prova su campo "ID Spedizione" (alias principali)
  const candidates = [
    'ID Spedizione','Id Spedizione','ID spedizione','id spedizione',
    'ID\u00A0Spedizione','IDSpedizione','Spedizione - ID','Shipment ID','ID'
  ];
  const safe = String(sid).replace(/'/g, "\\'");
  for (const field of candidates) {
    try {
      const rows = await airFetch(`${tableURL(TB_SPEDIZIONI)}?filterByFormula=${encodeURIComponent(`{${field}}='${safe}'`)}&maxRecords=1`);
      if (rows.records?.length) return rows.records[0];
    } catch (err) {
      if (err?.status !== 422) throw err;
    }
  }
  return null;
}

// ---------- PL loader (forza i campi richiesti dall'utente) ----------
/**
 * Regole di join:
 *  1) {Spedizione} = recId (se è un linked record)
 *  2) {ID Spedizione} = business SID (se è un campo testuale)
 *  3) {Spedizione} = business SID (se è stato salvato testuale)
 */
async function getPLRows({ ship, sidRaw }) {
  const recId = ship.id;
  const businessSid = ship?.fields?.['ID Spedizione']
    || ship?.fields?.['Id Spedizione']
    || ship?.fields?.['ID spedizione']
    || String(sidRaw || '');

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
      // 422 = campo inesistente → prova formula successiva
      if (err?.status !== 422) throw err;
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

  const make = (t) => {
    const h = crypto.createHmac('sha256', DOCS_SIGN_SECRET);
    h.update(`${sid}.${t}.${exp}`);
    return h.digest('hex');
  };
  const makeCanonical = () => {
    const q = `sid=${encodeURIComponent(String(sid))}&type=${encodeURIComponent(String(rawType))}&exp=${encodeURIComponent(String(exp))}`;
    const h = crypto.createHmac('sha256', DOCS_SIGN_SECRET);
    h.update(q);
    return h.digest('hex');
  };

  try { if (crypto.timingSafeEqual(Buffer.from(make(rawType)), Buffer.from(String(sig)))) return true; } catch {}
  try { if (crypto.timingSafeEqual(Buffer.from(make(normType)), Buffer.from(String(sig)))) return true; } catch {}
  try { if (crypto.timingSafeEqual(Buffer.from(makeCanonical()), Buffer.from(String(sig)))) return true; } catch {}
  return false;
}

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
const money = (x, ccy = '€') =>
  `${ccy} ${num(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escapeHTML = (x = '') => String(x)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

// ---------- Type normalization ----------
function normalizeType(t) {
  const raw = String(t || 'proforma').toLowerCase().trim();
  const commercialAliases = new Set(['commercial', 'commerciale', 'invoice', 'fattura', 'fattura commerciale']);
  const dleAliases = new Set(['dle', 'dichiarazione', 'libera', 'esportazione', 'export', 'export declaration']);
  if (dleAliases.has(raw)) return 'dle';
  if (commercialAliases.has(raw)) return 'commercial';
  return 'proforma';
}

// ---------- INVOICE HTML ----------
function renderInvoiceHTML({ type, ship, lines, total }) {
  const watermark = type === 'proforma';
  const docTitle  = type === 'proforma' ? 'Proforma Invoice' : 'Commercial Invoice';
  const ccy = get(ship.fields, ['Valuta', 'Currency'], 'EUR');
  const ccySym = ccy === 'EUR' ? '€' : (ccy || '€');

  // Sender (Mittente)
  const senderName    = get(ship.fields, ['Mittente - Ragione Sociale'], '—');
  const senderCountry = get(ship.fields, ['Mittente - Paese'], '');
  const senderCity    = get(ship.fields, ['Mittente - Città'], '');
  const senderZip     = get(ship.fields, ['Mittente - CAP'], '');
  const senderAddr    = get(ship.fields, ['Mittente - Indirizzo'], '');
  const senderPhone   = get(ship.fields, ['Mittente - Telefono'], '');
  const senderVat     = get(ship.fields, ['Mittente - P.IVA/CF'], '');

  // Receiver (Destinatario)
  const rcName    = get(ship.fields, ['Destinatario - Ragione Sociale'], '—');
  const rcAddr    = get(ship.fields, ['Destinatario - Indirizzo'], '');
  const rcCity    = get(ship.fields, ['Destinatario - Città'], '');
  const rcZip     = get(ship.fields, ['Destinatario - CAP'], '');
  const rcCountry = get(ship.fields, ['Destinatario - Paese'], '');
  const rcPhone   = get(ship.fields, ['Destinatario - Telefono'], '');
  const rcVat     = get(ship.fields, ['Destinatario - P.IVA/CF'], '');

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
}
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative}
.watermark{position:absolute; inset:0; display:${watermark?'flex':'none'}; align-items:center; justify-content:center; pointer-events:none}
.watermark span{opacity:0.06; font-size:180px; letter-spacing:0.22em; transform:rotate(-24deg); font-weight:800; color:#0f172a}
header{display:grid; grid-template-columns:1fr auto; align-items:start; gap:16px}
.brand{max-width:70%}
.tag{display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#374151; background:var(--chip); border:1px solid var(--border); padding:2px 6px; border-radius:6px; margin-bottom:6px}
.logo .word{font-size:26px; font-weight:800; letter-spacing:.01em; color:#111827}
.brand .meta{margin-top:6px; font-size:12px; color:var(--muted)}
.doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:260px}
.doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:${watermark?'var(--accent)':'var(--ok)'}; font-weight:800}
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
        <div class="small"><strong>${escapeHTML(rcName)}</strong></div>
        <div class="small">${escapeHTML(rcAddr)}</div>
        <div class="small">${escapeHTML(rcZip)} ${escapeHTML(rcCity)} (${escapeHTML(rcCountry)})</div>
        ${rcPhone ? `<div class="small">Tel: ${escapeHTML(rcPhone)}</div>` : ``}
        ${rcVat   ? `<div class="small">VAT/CF: ${escapeHTML(rcVat)}</div>` : ``}
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
      ${type==='proforma' ? `<div class="small"><strong>Note:</strong> Goods are not for resale. Declared values are for customs purposes only.</div>` : ''}
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

// ---------- DLE HTML ----------
function renderDLEHTML({ ship }) {
  const carrier   = get(ship.fields, ['Corriere', 'Carrier'], '—');
  const senderRS  = get(ship.fields, ['Mittente - Ragione Sociale'], '—');
  const senderCity= get(ship.fields, ['Mittente - Città'], '');
  const pickup    = get(ship.fields, ['Ritiro - Data'], '') || ship.fields?.['Ritiro Data'];
  const dateStr   = fmtDate(pickup) || fmtDate(Date.now());
  const sid       = get(ship.fields, ['ID Spedizione', 'Id Spedizione'], ship.id);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Export Free Declaration — ${escapeHTML(sid)}</title>
<style>
:root{ --brand:#111827; --accent:#0ea5e9; --text:#0b0f13; --muted:#6b7280; --border:#e5e7eb; --border-strong:#d1d5db; --bg:#ffffff; --chip:#f3f4f6; }
*{box-sizing:border-box}
html,body{margin:0;background:#fff;color:#0b0f13;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative}
header{display:flex; align-items:flex-start; justify-content:space-between; gap:16px}
.brand{max-width:70%}
.logo .word{font-size:24px; font-weight:800; letter-spacing:.01em; color:#111827}
.meta{margin-top:4px; font-size:12px; color:var(--muted)}
.doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:260px}
.doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:#111827; font-weight:800}
.doc-meta .kv{margin-top:6px}
.kv div{margin:2px 0}
hr.sep{border:none;border-top:1px solid var(--border); margin:18px 0 16px}
.to{font-size:12px; color:#374151; margin-bottom:12px}
.section{font-size:13px; line-height:1.55}
.section p{margin:8px 0}
.list{margin:8px 0 8px 16px; padding:0}
.list li{margin:6px 0}
.footer{margin-top:22px; font-size:12px; color:#374151}
.sign{margin-top:22px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px}
.box{height:64px; border:1px dashed var(--border-strong); border-radius:10px; width:260px}
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

    <header>
      <div class="brand">
        <div class="logo"><div class="word">${escapeHTML(senderRS)}</div></div>
        <div class="meta">Shipment ID: ${escapeHTML(sid)}</div>
      </div>
      <div class="doc-meta">
        <div class="title">Export Free Declaration</div>
        <div class="kv">
          <div><strong>Date:</strong> ${escapeHTML(dateStr)}</div>
          <div><strong>Place:</strong> ${escapeHTML(senderCity || '')}</div>
        </div>
      </div>
    </header>

    <hr class="sep" />

    <div class="to"><strong>To:</strong> ${escapeHTML(carrier)}</div>

    <div class="section">
      <p>I, the undersigned <strong>${escapeHTML(senderRS)}</strong>, as Shipper, hereby declare under my sole responsibility that all goods entrusted to <strong>${escapeHTML(carrier)}</strong>:</p>
      <ul class="list">
        <li>Are not included in the list of products protected by the Washington Convention (CITES) – Council Regulation (EC) No. 338/97 and subsequent amendments.</li>
        <li>Are not included in the list of goods covered by Council Regulation (EC) No. 116/2009 on the export of cultural goods.</li>
        <li>Are not subject to Regulation (EU) No. 821/2021 on dual-use items and subsequent amendments.</li>
        <li>Are not included in Regulation (EU) No. 125/2019 concerning trade in certain goods that could be used for capital punishment, torture, or other cruel, inhuman, or degrading treatment.</li>
        <li>Do not contain cat or dog fur, in accordance with Council Regulation (EC) No. 1523/2007.</li>
        <li>Are not subject to Regulation (EU) No. 649/2012 on the export and import of hazardous chemicals.</li>
        <li>Are not included in Regulation (EU) No. 590/2024 on substances that deplete the ozone layer.</li>
        <li>Are not subject to Regulation (EC) No. 1013/2006 concerning shipments of waste.</li>
        <li>Are not included in the restrictive measures provided for by the following EU Regulations and Decisions:</li>
      </ul>
      <ul class="list">
        <li>Regulation (EC) No. 1210/2003 (Iraq)</li>
        <li>Regulation (EU) No. 2016/44 (Libya)</li>
        <li>Regulation (EU) No. 36/2012 (Syria)</li>
        <li>Regulation (EC) No. 765/2006 (Belarus)</li>
        <li>Regulation (EU) No. 833/2014 and Council Decision 2014/512/CFSP (Russia/Ukraine)</li>
        <li>Regulation (EU) No. 692/2014 (Crimea/Sevastopol)</li>
        <li>Regulation (EU) No. 2022/263 (Ukrainian territories occupied by the Russian Federation)</li>
      </ul>
      <p>Furthermore, the goods:</p>
      <ul class="list">
        <li>Are not included in any other restrictive list under current EU legislation.</li>
        <li>Are intended exclusively for civilian use and have no dual-use or military purpose.</li>
      </ul>
    </div>

    <div class="footer">
      <div><strong>Place:</strong> ${escapeHTML(senderCity || '')}</div>
      <div><strong>Date:</strong> ${escapeHTML(dateStr)}</div>
      <div class="sign" style="margin-top:10px">
        <div><strong>Signature of Shipper:</strong></div>
        <div class="box"></div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ---------- Handler ----------
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const rawType = String(q.type || 'proforma').toLowerCase();
    const type    = normalizeType(rawType); // 'proforma' | 'commercial' | 'dle'
    const sidRaw  = q.sid || q.ship;
    const sig     = q.sig;
    const exp     = q.exp;

    if (!sidRaw) return bad(res, 400, 'Bad request', 'Missing sid/ship');

    if (!verifySigFlexible({ sid: sidRaw, rawType, normType: type, exp, sig })) {
      return bad(res, 401, 'Unauthorized', 'Invalid signature');
    }

    // Load shipment
    const ship = await getShipmentBySid(sidRaw);
    if (!ship) return bad(res, 404, 'Not found', `No shipment found for ${sidRaw}`);

    let html;

    if (type === 'dle') {
      // DLE does not need PL rows
      html = renderDLEHTML({ ship });
    } else {
      // Invoices: load PL (join robusto su recId o business SID)
      const pl = await getPLRows({ ship, sidRaw });

      // COSTRUZIONE RIGHE come richiesto dall'utente:
      //  Description  <- Etichetta (single line text)
      //  Qty          <- Bottiglie (number)
      //  Price        <- Prezzo (number)
      //  Total        <- somma di tutti i "Prezzo" riga
      const items = pl.length ? pl.map(r => {
        const f = r.fields || {};
        const title = String(f['Etichetta'] ?? '').trim();
        const qty   = Number(f['Bottiglie'] ?? 0) || 0;
        const price = Number(f['Prezzo'] ?? 0) || 0;
        return { title: title || '—', qty, price, meta: '' };
      }) : [{ title:'—', qty:0, price:0, meta:'' }];

      const total = items.reduce((s, r) => s + (Number.isFinite(r.price) ? r.price : 0), 0);
      html = renderInvoiceHTML({ type, ship, lines: items, total });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(html);
  } catch (err) {
    console.error('[render] error', err);
    return bad(res, 500, 'Render error', String(err?.message || err));
  }
}
