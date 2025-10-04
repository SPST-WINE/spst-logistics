// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

/**
 * Renderer HTML per:
 *  - Proforma Invoice
 *  - Commercial Invoice
 *  - DLE (Export Free Declaration) — **FedEx/UPS** come da PDF con placeholder riempiti da Airtable
 *
 * Query:
 *  - sid | ship : shipment identifier (business "ID Spedizione" or Airtable recId)
 *  - type       : proforma | fattura | commercial | commerciale | invoice | dle
 *  - exp, sig   : HMAC-SHA256 over `${sid}.${type}.${exp}` — bypassabile con BYPASS_SIGNATURE=1
 *  - carrier    : (opz.) 'fedex' | 'ups' — per DLE seleziona il template e forza “To:”
 *  - format     : (opz.) html | print (solo per pulsante client)
 *
 * Env: AIRTABLE_PAT, AIRTABLE_BASE_ID, DOCS_SIGN_SECRET, BYPASS_SIGNATURE=1, DEBUG_DOCS=1
 */

import crypto from 'node:crypto';

// ========== ENV / LOG ==========
const AIRTABLE_PAT      = process.env.AIRTABLE_PAT;
const AIRTABLE_BASE_ID  = process.env.AIRTABLE_BASE_ID;
const DOCS_SIGN_SECRET  = process.env.DOCS_SIGN_SECRET || '';
const BYPASS_SIGNATURE  = process.env.BYPASS_SIGNATURE === '1';
const DEBUG_DOCS        = process.env.DEBUG_DOCS === '1';
const dlog = (...a)=>{ if(DEBUG_DOCS) console.log('[docs]',...a); };
const derr = (...a)=>console.error('[docs:ERR]',...a);

// ========== AT ==========
const API_ROOT  = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}`;
const TB_SPEDIZIONI = 'SpedizioniWebApp';
const TB_PL         = 'SPED_PL';
const tableURL  = (t)=>`${API_ROOT}/${encodeURIComponent(t)}`;
const recordURL = (t,id)=>`${tableURL(t)}/${encodeURIComponent(id)}`;

async function airFetch(url, init={}) {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization:`Bearer ${AIRTABLE_PAT}`, 'Content-Type':'application/json', ...(init.headers||{}) }
  });
  const text = await res.text(); const data = text ? safeJSON(text) : null;
  if (DEBUG_DOCS) dlog('HTTP', init.method||'GET', res.status, url);
  if (!res.ok) { const e=new Error(`Airtable ${res.status}: ${text}`); e.status=res.status; throw e; }
  return data;
}
function safeJSON(t){ try{return JSON.parse(t);}catch{return null;} }
function truncate(s,n=600){ s=String(s||''); return s.length>n?s.slice(0,n)+'…':s; }

async function airFetchAll(formula, tableName) {
  const rows=[]; let next=`${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100`;
  while(next){ const data=await airFetch(next); rows.push(...(data?.records||[])); next=data?.offset?`${tableURL(tableName)}?filterByFormula=${encodeURIComponent(formula)}&pageSize=100&offset=${data.offset}`:null; }
  return rows;
}

// ========== LOAD SHIPMENT ==========
async function getShipmentBySid(sid) {
  if (/^rec[0-9A-Za-z]{14}/.test(String(sid))) {
    try { return await airFetch(recordURL(TB_SPEDIZIONI, sid)); } catch(e){ derr('air(record)',e?.status||'',e?.message||e); }
  }
  const candidates=['ID Spedizione','Id Spedizione','ID spedizione','id spedizione','ID\u00A0Spedizione','IDSpedizione','Spedizione - ID','Shipment ID','ID'];
  const safe = String(sid).replace(/'/g,"\\'");
  for (const field of candidates) {
    try {
      const data = await airFetch(`${tableURL(TB_SPEDIZIONI)}?filterByFormula=${encodeURIComponent(`{${field}}='${safe}'`)}&maxRecords=1`);
      const rec = data?.records?.[0]; if (rec) return rec;
    } catch(e){ if(e?.status!==422) throw e; }
  }
  return null;
}

// ========== LOAD PL (per fatture) ==========
const PL_LINKED_FIELD_ALIASES=['SPED_PL','PL','Packing List','Packing list','PL Righe','Packing list righe'];
const buildOrByRecordIds = (ids=[]) => ids.length ? `OR(${ids.map(id=>`RECORD_ID()='${String(id).replace(/'/g,"\\'")}'`).join(',')})` : '';

async function getPLRows({ship,sidRaw}) {
  for (const fname of PL_LINKED_FIELD_ALIASES) {
    const v = ship?.fields?.[fname];
    if (Array.isArray(v) && v.length) {
      const ids = v.map(x=>typeof x==='string'?x:x?.id).filter(Boolean);
      const rows = await airFetchAll(buildOrByRecordIds(ids), TB_PL);
      if (rows.length) return rows;
    }
  }
  const recId = ship.id;
  const businessSid = ship?.fields?.['ID Spedizione'] || ship?.fields?.['Id Spedizione'] || ship?.fields?.['ID spedizione'] || String(sidRaw||'');
  for (const f of [`{Spedizione}='${recId}'`,`{ID Spedizione}='${businessSid.replace(/'/g,"\\'")}'`,`{Spedizione}='${businessSid.replace(/'/g,"\\'")}'`]) {
    try { const rows=await airFetchAll(f, TB_PL); if (rows.length) return rows; } catch(e){ if(e?.status!==422) throw e; }
  }
  return [];
}

// ========== SIG ==========
function verifySigFlexible({ sid, rawType, normType, exp, sig }) {
  if (BYPASS_SIGNATURE) return true;
  if (!sid || !rawType || !exp || !sig) return false;
  const now = Math.floor(Date.now()/1000); if (Number(exp) < now) return false;
  const h1 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(`${sid}.${rawType}.${exp}`).digest('hex');
  const h2 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(`${sid}.${normType}.${exp}`).digest('hex');
  const q  = `sid=${encodeURIComponent(String(sid))}&type=${encodeURIComponent(String(rawType))}&exp=${encodeURIComponent(String(exp))}`;
  const h3 = crypto.createHmac('sha256', DOCS_SIGN_SECRET).update(q).digest('hex');
  return safeEqual(h1,String(sig)) || safeEqual(h2,String(sig)) || safeEqual(h3,String(sig));
}
function safeEqual(a,b){ try{ return crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b)); }catch{ return false; } }
function bad(res, code, msg, details){ res.status(code).json({ ok:false, error:msg, details }); }

// ========== UTILS ==========
const get = (obj, keys, def='') => { for (const k of keys){ const v=obj?.[k]; if(v!==undefined&&v!==null&&v!=='') return v; } return def; };
const fmtDate = (d)=>{ try{ return new Date(d).toLocaleDateString('it-IT'); }catch{ return ''; } };
const num = (x)=>{ const n=Number(x); return Number.isFinite(n)?n:0; };
const money = (x, sym='€')=>`${sym} ${num(x).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const escapeHTML = (x='')=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const kgFmt = (x)=>`${(Math.round(num(x)*10)/10).toLocaleString('it-IT',{minimumFractionDigits:1,maximumFractionDigits:1})} kg`;

function normalizeType(t){
  const raw=String(t||'proforma').toLowerCase().trim();
  const commercial = new Set(['commercial','commerciale','invoice','fattura','fattura commerciale']);
  const dle = new Set(['dle','dichiarazione','libera','esportazione','export','export declaration']);
  if (dle.has(raw)) return 'dle';
  if (commercial.has(raw)) return 'commercial';
  return 'proforma';
}

// ========== CARRIER HELPERS ==========
function resolveCarrierKeyAndDisplay({ carrierOverride, ship }) {
  const norm = (s='')=>String(s||'').toLowerCase().trim();
  const over = norm(carrierOverride);
  if (over==='fedex') return { key:'fedex', display:'FedEx' };
  if (over==='ups')   return { key:'ups', display:'UPS Italia Srl' };

  const raw = String(ship?.fields?.['Corriere'] || ship?.fields?.['Carrier'] || '').trim();
  const low = norm(raw);
  if (low.includes('fedex')) return { key:'fedex', display:'FedEx' };
  if (low.includes('ups'))   return { key:'ups', display:'UPS Italia Srl' };
  return { key:null, display: raw || '—' };
}

// =======================================================================================
// INVOICE HTML (identico al tuo, ridotto qui per brevità funzionale)
// =======================================================================================
function renderInvoiceHTML({ type, ship, lines, total, totalsWeights }) {
  const watermark = type === 'proforma';
  const docTitle  = type === 'proforma' ? 'Proforma Invoice' : 'Commercial Invoice';
  const ccy = get(ship.fields, ['Valuta','Currency'],'EUR');
  let ccySym = ccy === 'EUR' ? '€' : (ccy || '€');
  if (type==='proforma') ccySym='€';

  const senderName    = get(ship.fields,['Mittente - Ragione Sociale'],'—');
  const senderCountry = get(ship.fields,['Mittente - Paese'],'');
  const senderCity    = get(ship.fields,['Mittente - Città'],'');
  const senderZip     = get(ship.fields,['Mittente - CAP'],'');
  const senderAddr    = get(ship.fields,['Mittente - Indirizzo'],'');
  const senderPhone   = get(ship.fields,['Mittente - Telefono'],'');
  const senderVat     = get(ship.fields,['Mittente - P.IVA/CF'],'');

  const shName    = get(ship.fields,['Destinatario - Ragione Sociale'],'—');
  const shAddr    = get(ship.fields,['Destinatario - Indirizzo'],'');
  const shCity    = get(ship.fields,['Destinatario - Città'],'');
  const shZip     = get(ship.fields,['Destinatario - CAP'],'');
  const shCountry = get(ship.fields,['Destinatario - Paese'],'');
  const shPhone   = get(ship.fields,['Destinatario - Telefono'],'');
  const shVat     = get(ship.fields,['Destinatario - P.IVA/CF'],'');

  const sid       = get(ship.fields,['ID Spedizione','Id Spedizione'], ship.id);
  const carrier   = get(ship.fields,['Corriere','Carrier'],'—');
  const incoterm  = get(ship.fields,['Incoterm'],'');
  const pickupDate= get(ship.fields,['Ritiro - Data'],'') || ship.fields?.['Ritiro Data'];
  const docNo = type==='proforma'
    ? (get(ship.fields,['Proforma - Numero'],'') || `PF-${sid}`)
    : (get(ship.fields,['Fattura - Numero','Commercial Invoice - Numero'],'') || `CI-${sid}`);

  const place  = senderCity || '';
  const dateStr= fmtDate(pickupDate) || fmtDate(Date.now());

  const rows = (lines||[]).map((r,i)=>`
    <tr>
      <td>${i+1}</td>
      <td><strong>${escapeHTML(r.title || '—')}</strong>${r.meta?`<br/><span class="muted">${escapeHTML(r.meta)}</span>`:''}</td>
      <td>${escapeHTML(r.hs || '')}</td>
      <td class="num mono">${num(r.qty)}</td>
      <td class="num mono">${money(r.price, ccySym)}</td>
      <td class="num mono">${money(r.amount, ccySym)}</td>
    </tr>`).join('');

  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${docTitle} — ${escapeHTML(sid)}</title>
  <style>
    :root{--border:#e5e7eb;--chip:#f3f4f6;--muted:#6b7280}
    *{box-sizing:border-box} html,body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    .page{width:210mm;min-height:297mm;margin:0 auto;padding:18mm 16mm}
    .printbar{position:sticky;top:0;padding:8px 0 12px;display:flex;justify-content:flex-end}
    .btn{border:1px solid var(--border);padding:6px 10px;border-radius:8px;background:#fff;cursor:pointer}
    header{display:grid;grid-template-columns:1fr auto;gap:16px}
    .meta{margin-top:6px;font-size:12px;color:var(--muted)}
    .doc-meta{font-size:12px;border:1px solid var(--border);border-radius:12px;padding:10px;min-width:300px}
    hr{border:none;border-top:1px solid var(--border);margin:16px 0 18px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .card{border:1px solid var(--border);border-radius:12px;padding:12px}
    table{width:100%;border-collapse:collapse;font-size:12px;margin-top:16px}
    th,td{border-bottom:1px solid var(--border);padding:9px 8px;vertical-align:top}
    th.num,td.num{text-align:right}
    .totals{margin-top:10px;display:flex;justify-content:flex-end}
  </style></head><body>
  <div class="page">
    <div class="printbar"><button class="btn" onclick="window.print()">Print / Save PDF</button></div>
    <header>
      <div>
        <div style="font-weight:800;font-size:26px">${escapeHTML(senderName)}</div>
        <div class="meta">${escapeHTML(senderAddr)}${senderAddr?', ':''}${escapeHTML(senderZip)} ${escapeHTML(senderCity)}${senderCity?', ':''}${escapeHTML(senderCountry)}${senderCountry?' · ':''}${senderVat?('VAT '+escapeHTML(senderVat)) : ''}<br/>${senderPhone?('Tel: '+escapeHTML(senderPhone)) : ''}</div>
      </div>
      <div class="doc-meta">
        <div style="text-transform:uppercase;font-weight:800">${docTitle}</div>
        <div><strong>No.:</strong> ${escapeHTML(docNo)}</div>
        <div><strong>Date:</strong> ${escapeHTML(fmtDate(pickupDate) || fmtDate(Date.now()))}</div>
        <div><strong>Shipment ID:</strong> ${escapeHTML(sid)}</div>
      </div>
    </header>
    <hr/>
    <section class="grid">
      <div class="card">
        <div style="text-transform:uppercase;font-size:11px;color:#374151;letter-spacing:.06em;margin-bottom:6px">Receiver</div>
        <div style="font-size:12px"><strong>${escapeHTML(shName)}</strong></div>
        <div style="font-size:12px">${escapeHTML(shAddr)}</div>
        <div style="font-size:12px">${escapeHTML(shZip)} ${escapeHTML(shCity)} (${escapeHTML(shCountry)})</div>
        ${shPhone?`<div style="font-size:12px">Tel: ${escapeHTML(shPhone)}</div>`:''}
        ${shVat?`<div style="font-size:12px">VAT/CF: ${escapeHTML(shVat)}</div>`:''}
      </div>
      <div class="card">
        <div style="text-transform:uppercase;font-size:11px;color:#374151;letter-spacing:.06em;margin-bottom:6px">Shipment Details</div>
        <div style="font-size:12px">Carrier: ${escapeHTML(carrier || '—')}</div>
        <div style="font-size:12px">Incoterm: ${escapeHTML(incoterm || '—')} · Currency: ${escapeHTML(ccy)}</div>
        <div style="font-size:12px">Net weight: <strong>${escapeHTML(kgFmt(totalsWeights.net))}</strong> · Gross weight: <strong>${escapeHTML(kgFmt(totalsWeights.gross))}</strong></div>
      </div>
    </section>
    <table aria-label="Goods"><thead><tr>
      <th style="width:28px">#</th><th>Description</th><th style="width:110px">HS Code</th><th class="num" style="width:70px">Qty</th><th class="num" style="width:110px">Price / unit</th><th class="num" style="width:120px">Amount</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <div class="totals"><table><tr><td style="text-align:right">Total</td><td style="text-align:right;width:140px"><strong>${money(total, ccySym)}</strong></td></tr></table></div>
    <div style="margin-top:18px;font-size:11px;color:#374151"><strong>Place & date:</strong> ${escapeHTML(place)}, ${escapeHTML(dateStr)}</div>
  </div></body></html>`;
}

// =======================================================================================
// DLE HTML — **FedEx/UPS** come da PDF con placeholder
// =======================================================================================

function cssDLE() {
  return `
:root{ --text:#0b0f13; --muted:#6b7280; --border:#e5e7eb; --chip:#f3f4f6 }
*{box-sizing:border-box} html,body{margin:0;background:#fff;color:var(--text);font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
.page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm}
header{display:flex; align-items:flex-start; justify-content:space-between; gap:16px}
.brand{max-width:72%} .logo{font-size:22px; font-weight:800}
.meta{margin-top:6px; font-size:12px; color:var(--muted)}
.doc{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:270px}
.doc .title{font-size:12px; text-transform:uppercase; letter-spacing:.08em; font-weight:800}
hr{border:none;border-top:1px solid var(--border); margin:18px 0 14px}
.badge{display:inline-block; padding:6px 8px; border:1px solid var(--border); background:var(--chip); border-radius:8px; font-size:11px; letter-spacing:.06em; text-transform:uppercase}
.h2{font-weight:800; font-size:14px; text-transform:uppercase; margin:14px 0 8px}
.p{margin:8px 0; line-height:1.55; font-size:13px}
.list{margin:8px 0 10px 18px; padding:0; font-size:13px}
.list li{margin:6px 0}
.box{height:64px; border:1px dashed #d1d5db; border-radius:10px}
.printbar{position:sticky; top:0; padding:8px 0 12px; display:flex; gap:8px; justify-content:flex-end}
.btn{font-size:12px; border:1px solid var(--border); background:#fff; padding:6px 10px; border-radius:10px; cursor:pointer}
@media print {.printbar{display:none}}`;
}

// -------- FedEx (ENG) — testo del PDF con placeholder ----------
function renderDLEFedExHTML({ ship }) {
  // Mittente
  const sName = get(ship.fields,['Mittente - Ragione Sociale'],'—');
  const sVat  = get(ship.fields,['Mittente - P.IVA/CF'],'');
  const sAddr = get(ship.fields,['Mittente - Indirizzo'],'');
  const sCity = get(ship.fields,['Mittente - Città'],'');
  const sZip  = get(ship.fields,['Mittente - CAP'],'');
  const sCountry = get(ship.fields,['Mittente - Paese'],'');
  const sPhone   = get(ship.fields,['Mittente - Telefono'],'');
  // Doc/shipment
  const sid   = get(ship.fields,['ID Spedizione','Id Spedizione'], ship.id);
  const destCountry = get(ship.fields,['Destinatario - Paese'],'');
  // numero fattura “generato”: prioritizza Commerciale, fallback Proforma, fallback PF-<sid>
  const invN = get(ship.fields,['Fattura - Numero','Commercial Invoice - Numero'], '') ||
               get(ship.fields,['Proforma - Numero'],'') || `PF-${sid}`;
  const date = fmtDate(get(ship.fields,['Ritiro - Data'],'') || ship.fields?.['Ritiro Data']) || fmtDate(Date.now());

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DLE FedEx — ${escapeHTML(sid)}</title>
<style>${cssDLE()}</style></head><body>
<div class="page">
  <div class="printbar"><button class="btn" onclick="window.print()">Print / Save PDF</button></div>

  <header>
    <div class="brand">
      <div class="logo">(If the consignor is a company, the Declaration below must be printed on company letterhead)</div>
      <div class="meta">Shipment ID: ${escapeHTML(sid)}</div>
    </div>
    <div class="doc">
      <div class="title">Export Free Declaration · FEDEX</div>
      <div class="badge">Date: ${escapeHTML(date)}<br/>Place: ${escapeHTML(sCity)}</div>
    </div>
  </header>

  <hr/>
  <div class="h2">To the attention of the Customs Agency</div>

  <div class="h2">Sender details</div>
  <div class="p"><strong>${escapeHTML(sName)}</strong><br/>
  ${escapeHTML(sVat)}<br/>
  ${escapeHTML(sAddr)}<br/>
  ${escapeHTML(sCity)}, ${escapeHTML(sZip)}<br/>
  ${escapeHTML(sCountry)}<br/>
  ${escapeHTML(sPhone)}</div>

  <div class="p">While accepting all consequent responsibilities for the shipment we hereby declare that none of the goods in export are subject to any export license and therefore:</div>

  <div class="h2">GOODS OF EU PREFERENTIAL ORIGIN</div>
  <div class="p">(please mark the box in case of goods of UE preferential origin and fill in the following mandatory declaration)</div>

  <div class="h2">DECLARATION</div>
  <div class="p">
    I, the undersigned, declare that the goods listed on this document (invoice number) <strong>${escapeHTML(invN)}</strong>
    originate in (insert origin country) <strong>ITALY</strong> and satisfy the rules of origin governing preferential trade with (insert destination country) <strong>${escapeHTML(destCountry)}</strong>
  </div>
  <ul class="list">
    <li>□ Cumulation applied with ………………………..(name of the country/countries)</li>
    <li>■ No cumulation applied (origin from a single country)</li>
  </ul>

  <div class="p">I undertake to make available to the customs authorities any further supporting documents they may require (for example: invoices, import documentation, statement of origin, invoice declaration, producer/manufacturer declaration, extracts of accounting documents, extracts of technical documentation, etc.):</div>
  <div class="p">…………………………………………………<br/>…………………………………………………<br/>………………………………………………..</div>

  <div class="h2">GOODS DESTINED TO TURKEY</div>
  <div class="p">(please mark the box in case of goods destined to Turkey)</div>
  <div class="p">I declare that the goods meet the requirements for the application of UE/Turkey Agreement (Decision n.1/95 of the Council of Association CE-Turkey, of 22/12/1995 and 2006/646/CE: Decision n.1/2006 of the Customs Cooperation Committee CE-Turkey, of 26/09/2006)</div>

  <div class="h2">MANDATE TO ISSUE EUR1/EUR-MED/ATR CERTIFICATE</div>
  <div class="p">We assign to <strong>FedEx</strong> the mandate to proceed with customs clearance activities, to issue, sign on our behalf and file the EUR1/EUR-MED/ATR certificate, relieving <strong>FedEx</strong> of any responsibilities directly or indirectly associated with the fulfillment of the above indicated procedure.</div>

  <div class="h2">STATEMENTS</div>
  <ul class="list">
    <li><strong>DUAL USE (Y901)</strong><br/>The goods are not included in the list of products as per Council Regulation (EC) No. 428/09 and its following amendments…</li>
    <li><strong>WASHINGTON CONVENTION (Y900)</strong><br/>The goods are not included in the list of products as per Council Regulation (EC) No. 338/97…</li>
    <li><strong>CAT AND DOG FUR (Y922)</strong><br/>The goods are not cat and dog fur and/or products which contain them…</li>
    <li><strong>OZONE (Y902)</strong><br/>The goods are not included in the list of substances that cause ozone layer depletion…</li>
    <li><strong>CULTURAL GOODS (Y903)</strong><br/>The goods are not included in the list of products as per Council Regulation (EC) No. 116/09…</li>
    <li><strong>DANGEROUS CHEMICAL SUBSTANCES (Y916 – Y917)</strong> …</li>
    <li><strong>GOODS USED FOR DEATH PENALTY, TORTURE ETC. – Y904 – Y906 – Y907 – Y908</strong> …</li>
    <li><strong>GOODS SENT TO RESTRICTED COUNTRIES (Y920 – Y921 – Y949 – Y966 – Y967)</strong> …</li>
    <li><strong>Y935</strong> … Syria …</li>
    <li><strong>GOODS SENT TO RUSSIA (Y939 – Y920)</strong> …</li>
    <li><strong>WASTE (Y923)</strong> …</li>
  </ul>

  <div class="p" style="margin-top:18px; display:flex; justify-content:space-between; align-items:flex-end; gap:20px">
    <div><strong>Place and date</strong><br/>${escapeHTML(sCity)} ${escapeHTML(sZip)} — ${escapeHTML(date)}</div>
    <div style="text-align:center">
      <div><strong>Shipper’s signature</strong></div>
      <div class="box" style="width:260px;margin-top:6px"></div>
      <div style="font-size:12px;color:#6b7280;margin-top:4px">(auto-generated)</div>
    </div>
  </div>
</div></body></html>`;
}

// -------- UPS (ITA) — testo del PDF con placeholder ----------
function renderDLEUPSHTML({ ship }) {
  const sName = get(ship.fields,['Mittente - Ragione Sociale'],'—');
  const sRef  = get(ship.fields,['FATT Referente','Destinatario - Referente','Mittente - Referente'],'') || sName;
  const sCity = get(ship.fields,['Mittente - Città'],'');
  const date  = fmtDate(get(ship.fields,['Ritiro - Data'],'') || ship.fields?.['Ritiro Data']) || fmtDate(Date.now());
  const sid   = get(ship.fields,['ID Spedizione','Id Spedizione'], ship.id);

  return `<!doctype html><html lang="it"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>DLE UPS — ${escapeHTML(sid)}</title>
<style>${cssDLE()}</style></head><body>
<div class="page">
  <div class="printbar"><button class="btn" onclick="window.print()">Stampa / Salva PDF</button></div>

  <header>
    <div class="brand">
      <div class="logo">Spettabile</div>
      <div class="meta">Shipment ID: ${escapeHTML(sid)}</div>
    </div>
    <div class="doc">
      <div class="title">Dichiarazione di libera esportazione · UPS</div>
      <div class="badge">Data: ${escapeHTML(date)}<br/>Luogo: ${escapeHTML(sCity)}</div>
    </div>
  </header>

  <hr/>

  <div class="p"><strong>UPS ITALIA Srl</strong><br/>Via Orio al Serio 49/51<br/>24050 Grassobbio<br/><span style="float:right">Attn. EXPORT DEPARTMENT</span></div>

  <div class="h2">Oggetto: dichiarazione di libera esportazione</div>

  <div class="p">Il sottoscritto <strong>${escapeHTML(sRef)}</strong> in qualità di <strong>MITTENTE</strong> dichiara sotto la propria personale responsabilità che tutte le merci che la</div>
  <div class="p">società <strong>${escapeHTML(sName)}</strong><br/>affida ad UPS Italia SRL:</div>

  <ul class="list">
    <li>Non rientrano tra quelle protette dalla Convenzione di Washington (CITES)…</li>
    <li>Non rientrano nell’elenco dei beni come da regolamento (CE) n. 116/2009…</li>
    <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 821/2021…</li>
    <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 125/2019…</li>
    <li>Non contengono pelliccia di cane e di gatto in conformità al regolamento (CE) n. 1523/2007…</li>
    <li>Non sono soggette alle disposizioni del regolamento (UE) n. 649/2012…</li>
    <li>Non rientrano nell’elenco dei beni come da regolamento (UE) 590/2024…</li>
    <li>Non sono soggette alle disposizioni del regolamento (CE) n. 1013/2006…</li>
    <li>Non rientrano nell’elenco dei beni come da regolamento (CE) n. 1210/2003 (Iraq)…</li>
    <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 2016/44 (Libia)…</li>
    <li>Non rientrano nell’elenco dei beni come da regolamento (UE) n. 36/2012 (Siria)…</li>
    <li>Non sono soggette al regolamento (CE) n. 765/2006 (Bielorussia)…</li>
    <li>Non sono soggette al regolamento (UE) n. 833/2014 (Russia)…</li>
    <li>Non sono soggette alla decisione 2014/512/PESC del Consiglio…</li>
    <li>Non sono soggette al regolamento (UE) n. 692/2014 (Crimea/Sebastopoli)…</li>
    <li>Non sono soggette al regolamento (UE) n. 2022/263 (territori ucraini occupati)…</li>
  </ul>

  <div class="p"><strong>Luogo</strong> ${escapeHTML(sCity)}<br/><strong>Data</strong> ${escapeHTML(date)}</div>

  <div class="p" style="margin-top:12px">
    <div class="box" style="width:280px"></div>
    <div style="font-size:12px;color:#6b7280;margin-top:4px">timbro e firma autogenerati</div>
  </div>
</div></body></html>`;
}

// =======================================================================================
// HANDLER
// =======================================================================================
export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const rawType = String(q.type || 'proforma').toLowerCase();
    const type    = normalizeType(rawType); // 'proforma' | 'commercial' | 'dle'
    const sidRaw  = q.sid || q.ship;
    const sig     = q.sig;
    const exp     = q.exp;
    const carrierOverride = (q.carrier || q.courier || '').toString().trim().toLowerCase();

    if (!sidRaw) return bad(res, 400, 'Bad request', 'Missing sid/ship');
    if (!verifySigFlexible({ sid: sidRaw, rawType, normType: type, exp, sig })) {
      return bad(res, 401, 'Unauthorized', 'Invalid signature');
    }

    const ship = await getShipmentBySid(sidRaw);
    if (!ship) return bad(res, 404, 'Not found', `No shipment found for ${sidRaw}`);

    // ===== DLE (nuovi template da PDF) =====
    if (type === 'dle') {
      const { key } = resolveCarrierKeyAndDisplay({ carrierOverride, ship });
      let html;
      if (key === 'fedex') html = renderDLEFedExHTML({ ship });
      else if (key === 'ups') html = renderDLEUPSHTML({ ship });
      else {
        // default: FedEx-like generico (si può cambiare se preferisci diverso)
        html = renderDLEFedExHTML({ ship });
      }
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Cache-Control','no-store, max-age=0');
      return res.status(200).send(html);
    }

    // ===== INVOICE =====
    const pl = await getPLRows({ ship, sidRaw });
    const items = pl.length ? pl.map((r)=> {
      const f=r.fields||{};
      const title = String(f['Etichetta'] ?? '').trim();
      const qty   = Number(f['Bottiglie'] ?? 0) || 0;
      const tip   = String(f['Tipologia'] ?? '').trim();
      let hsByTip=''; if (tip==='vino fermo') hsByTip='2204.21'; else if (tip==='vino spumante') hsByTip='2204.10'; else if (tip==='brochure/depliant') hsByTip='4911.10.00';
      const hs = hsByTip || get(f,['HS','HS code','HS Code'],'');
      const netPerB = Number(get(f,['Peso netto bott. (kg)','Peso netto bott (kg)','Peso netto (kg)','Peso netto'],0.9)) || 0.9;
      const grsPerB = Number(get(f,['Peso lordo bott. (kg)','Peso lordo bott (kg)','Peso lordo (kg)','Peso lordo'],1.3)) || 1.3;
      const netLine = qty*netPerB, grsLine = qty*grsPerB;
      const price = (type==='proforma') ? 2 : (Number(f['Prezzo'] ?? 0) || 0);
      const amount = qty*price;
      const meta = [`Net: ${netLine.toFixed(1)} kg`,`Gross: ${grsLine.toFixed(1)} kg`].join(' · ');
      return { title:title||'—', qty, price, amount, meta, netLine, grsLine, hs };
    }) : [{ title:'—', qty:0, price:(type==='proforma'?2:0), amount:0, meta:'', netLine:0, grsLine:0, hs:'' }];

    const totalMoney = items.reduce((s,r)=>s+num(r.amount),0);
    const totalNet   = items.reduce((s,r)=>s+num(r.netLine),0);
    const totalGross = items.reduce((s,r)=>s+num(r.grsLine),0);

    // override corriere per fatture (come prima)
    const overrideCarrier = (q.carrier || q.courier || '').toString().trim();
    const shipForRender = (overrideCarrier && (type==='proforma' || type==='commercial'))
      ? { ...ship, fields: { ...(ship.fields||{}), Carrier: overrideCarrier, Corriere: overrideCarrier } }
      : ship;

    const html = renderInvoiceHTML({
      type,
      ship: shipForRender,
      lines: items,
      total: totalMoney,
      totalsWeights: { net: totalNet, gross: totalGross },
    });

    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Cache-Control','no-store, max-age=0');
    return res.status(200).send(html);
  } catch (err) {
    derr('render error', err?.status||'', err?.message||err);
    try { return bad(res, (err?.status && Number(err.status)) || 500, 'Render error', String(err?.message || err)); }
    catch{/*noop*/}
  }
}
