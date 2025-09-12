// api/docs/unified/render.js
import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ENV
const TB   = process.env.TB_SPEDIZIONI || 'SpedizioniWebApp';
const BASE = process.env.AIRTABLE_BASE_ID;
const PAT  = process.env.AIRTABLE_PAT;
const SIGN = process.env.DOCS_SIGNING_SECRET;

const LABEL_BY_TYPE = {
  proforma: 'Proforma Invoice',
  fattura:  'Commercial Invoice',
  invoice:  'Commercial Invoice',
  dle:      'Dichiarazione libera esportazione',
  pl:       'Packing list',
};

const WATERMARK_BY_TYPE = {
  proforma: 'PROFORMA',
  fattura:  'INVOICE',
  invoice:  'INVOICE',
  dle:      'DLE',
  pl:       'PACKING LIST',
};

function hmac(params){
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}

function okJson(res, code, obj){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(obj));
}

function fmtDate(d=new Date()){
  try {
    return d.toLocaleDateString('it-IT', { timeZone: 'Europe/Rome' });
  } catch {
    const pad = n => String(n).padStart(2,'0');
    return `${d.getDate()}-${pad(d.getMonth()+1)}-${d.getFullYear()}`;
  }
}

async function fetchRecord(recId){
  try{
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}/${recId}`, {
      headers:{ Authorization:`Bearer ${PAT}` }
    });
    if (!r.ok) return null;
    return await r.json();
  }catch{ return null; }
}

function esc(s=''){
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;');
}

// ---------- HTML TEMPLATE (preview) ----------
function renderHtmlTemplate({ fields = {}, sid, type='proforma' }) {
  const title      = LABEL_BY_TYPE[type] || type;
  const wm         = WATERMARK_BY_TYPE[type] || '';
  const idSped     = fields['ID Spedizione'] || sid || '—';
  const whenStr    = fmtDate(new Date());

  // opzionali (se esistono in Airtable)
  const carrier    = fields['Corriere'] || '';
  const consignee  = fields['Destinatario - Ragione sociale'] || fields['Cliente'] || '—';
  const address    = fields['Destinatario - Indirizzo'] || fields['Indirizzo'] || '';
  const taxId      = fields['Destinatario - P.IVA / Tax ID'] || fields['Tax ID'] || '';
  const email      = fields['Destinatario - Email'] || fields['Email'] || '';
  const phone      = fields['Destinatario - Telefono'] || fields['Telefono'] || '';
  const incoterm   = fields['Incoterm'] || 'DAP';
  const currency   = fields['Valuta'] || 'EUR';
  const pickupDate = fields['Data ritiro'] ? fmtDate(new Date(fields['Data ritiro'])) : '—';

  return String.raw/*html*/`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — Preview</title>
  <style>
    :root{
      --brand:#111827; /* charcoal */
      --accent:#0ea5e9; /* aqua */
      --text:#0b0f13;
      --muted:#6b7280;
      --border:#e5e7eb;
      --border-strong:#d1d5db;
      --bg:#ffffff;
      --zebra:#fafafa;
      --chip:#f3f4f6;
      --success:#059669;
      --spacing:14px;
    }
    *{box-sizing:border-box}
    html,body{margin:0;background:var(--bg);color:var(--text);font-family:Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;}
    .page{width:210mm; min-height:297mm; margin:0 auto; padding:18mm 16mm; position:relative;}
    .toolbar{position:sticky; top:0; background:#fff7; backdrop-filter:saturate(180%) blur(8px); padding:8px 12px; display:flex; justify-content:flex-end}
    .btn{appearance:none; border:1px solid var(--border); background:var(--chip); padding:8px 12px; border-radius:8px; font-weight:700; cursor:pointer}
    .btn:hover{filter:brightness(1.05)}
    .watermark{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; pointer-events:none}
    .watermark span{opacity:0.05; font-size:120px; letter-spacing:0.22em; transform:rotate(-24deg); font-weight:800; color:#0f172a}
    header{display:grid; grid-template-columns:1fr auto; align-items:start; gap:16px}
    .brand{max-width:70%}
    .tag{display:inline-block; font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:#374151; background:var(--chip); border:1px solid var(--border); padding:2px 6px; border-radius:6px; margin-bottom:6px}
    .logo{display:flex; align-items:center; gap:10px}
    .logo .word{font-size:26px; font-weight:800; letter-spacing:.01em; color:var(--brand)}
    .brand .meta{margin-top:6px; font-size:12px; color:var(--muted)}
    .doc-meta{ text-align:right; font-size:12px; border:1px solid var(--border); border-radius:10px; padding:10px; min-width:260px}
    .doc-meta .title{font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); font-weight:800}
    .doc-meta .kv{margin-top:6px}
    .kv div{margin:2px 0}
    hr.sep{border:none;border-top:1px solid var(--border); margin:16px 0 18px}
    .grid{display:grid; grid-template-columns:1fr 1fr; gap:12px}
    .card{border:1px solid var(--border); border-radius:12px; padding:12px}
    .card h3{margin:0 0 8px; font-size:11px; color:#374151; text-transform:uppercase; letter-spacing:.08em}
    .small{font-size:12px; color:#374151}
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
    .legal{margin-top:10px}
    .sign{margin-top:20px; display:flex; justify-content:space-between; align-items:flex-end; gap:16px}
    .sign .box{height:64px; border:1px dashed var(--border-strong); border-radius:10px; width:260px}
    .sign .sig{display:flex; flex-direction:column; align-items:flex-start}
    .sign .label{font-size:11px; color:#374151; margin-bottom:6px}
    @media print{ body{background:#fff} .page{box-shadow:none} .watermark span{opacity:0.08} .toolbar{display:none} }
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="btn" onclick="window.print()">Stampa / Salva PDF</button>
  </div>
  <div class="page">
    <div class="watermark"><span>${esc(wm)}</span></div>

    <header>
      <div class="brand">
        <div class="tag">Sender</div>
        <div class="logo">
          <div class="word">SPST S.r.l.</div>
        </div>
        <div class="meta">
          Via Esempio 1, 20100 Milano (MI), Italy · VAT IT12345678901<br/>
          info@spst.it · +39 320 144 1789 · www.spst.it
        </div>
      </div>
      <div class="doc-meta">
        <div class="title">${esc(title)}</div>
        <div class="kv">
          <div><strong>No.:</strong> ${esc(idSped)}</div>
          <div><strong>Date:</strong> ${esc(whenStr)}</div>
          <div><strong>Shipment ID:</strong> ${esc(idSped)}</div>
        </div>
      </div>
    </header>

    <hr class="sep" />

    <section class="grid">
      <div class="card">
        <h3>Consignee</h3>
        <div class="small"><strong>${esc(consignee)}</strong></div>
        <div class="small">${esc(address || '—')}</div>
        ${taxId ? `<div class="small">Tax ID: ${esc(taxId)}</div>` : ''}
        <div class="small">${email ? 'Email: '+esc(email)+' · ' : ''}${phone ? 'Tel: '+esc(phone) : ''}</div>
      </div>
      <div class="card">
        <h3>Shipment Details</h3>
        ${carrier ? `<div class="small">Carrier: ${esc(carrier)}</div>` : ''}
        <div class="small">Pickup date: ${esc(pickupDate)}</div>
        <div class="small">Incoterm: ${esc(incoterm)} · Currency: ${esc(currency)}</div>
      </div>
    </section>

    <table class="items" aria-label="Goods details">
      <thead>
        <tr>
          <th style="width:32px">#</th>
          <th>Description</th>
          <th style="width:90px" class="num">Qty</th>
          <th style="width:120px" class="num">Unit Price</th>
          <th style="width:130px" class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td>
            <strong>${esc(fields['Merce / Descrizione'] || 'Goods description')}</strong><br/>
            <span class="muted">${esc(fields['Note merce'] || 'HS: — · Origin: — · Est. weight: —')}</span>
          </td>
          <td class="num">${esc(fields['Q.tà'] || '—')}</td>
          <td class="num">${esc(fields['Prezzo unitario'] || '—')}</td>
          <td class="num">${esc(fields['Valore dichiarato'] || fields['Totale'] || '—')}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <table>
        <tr>
          <td style="text-align:right">Subtotal</td>
          <td style="text-align:right; width:140px"><strong>${esc(fields['Valore dichiarato'] || '—')}</strong></td>
        </tr>
      </table>
    </div>

    <footer>
      <div class="legal">
        <strong>Declaration:</strong> This proforma invoice is issued for customs purposes only and does not constitute a tax invoice. The values shown are intended solely for determining customs value in accordance with applicable regulations.
      </div>
      <div class="sign">
        <div>
          <div class="small"><strong>Place & date:</strong> Milan, ${esc(whenStr)}</div>
          <div class="small">Email: info@spst.it · Tel: +39 320 144 1789</div>
        </div>
        <div class="sig">
          <div class="label">Signature</div>
          <div class="box"></div>
        </div>
      </div>
    </footer>
  </div>

  <script>
    // auto-print se query ?print=1
    try {
      const p = new URLSearchParams(location.search);
      if (p.get('print') === '1') setTimeout(()=>window.print(), 200);
    } catch {}
  </script>
</body>
</html>`;
}

// ---------- PDF “pulito” (fallback per download/Airtable) ----------
async function renderPdfLib({ fields = {}, sid, type='proforma' }, res, { forceDownload=false } = {}) {
  const title   = LABEL_BY_TYPE[type] || type;
  const idSped  = fields['ID Spedizione'] || sid || '—';
  const carrier = fields['Corriere'] || '';
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 56;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

  page.drawText('SPST Logistics', { x: margin, y: height - margin - 8, size: 18, font: fontB, color: rgb(0.07,0.12,0.20) });
  page.drawText(`Documento: ${title}`, { x: margin, y: height - margin - 32, size: 12, font, color: rgb(0.12,0.17,0.30) });
  page.drawText(`ID Spedizione: ${idSped}`, { x: margin, y: height - margin - 48, size: 11, font, color: rgb(0.12,0.17,0.30) });
  if (carrier) page.drawText(`Corriere: ${carrier}`, { x: margin, y: height - margin - 64, size: 11, font, color: rgb(0.12,0.17,0.30) });
  page.drawText(`Generato: ${fmtDate(new Date())}`, { x: margin, y: height - margin - 80, size: 10, font, color: rgb(0.35,0.40,0.55) });

  const boxTop = height - margin - 120;
  const boxH   = 300;
  const boxW   = width - margin*2;
  page.drawRectangle({
    x: margin, y: boxTop - boxH, width: boxW, height: boxH,
    borderWidth: 1, color: rgb(0.93,0.95,0.98), borderColor: rgb(0.78,0.82,0.90)
  });
  page.drawText('Contenuti documento (placeholder)', {
    x: margin + 12, y: boxTop - 18, size: 11, font: fontB, color: rgb(0.20,0.26,0.40)
  });
  [
    'Questa versione genera un PDF “pulito” senza Chromium.',
    'La pipeline di allegato su Airtable ora può funzionare senza dipendenze di sistema.',
    'Quando vuoi, sostituiremo questo placeholder con il layout definitivo.'
  ].forEach((line, i) => {
    page.drawText(line, { x: margin + 12, y: boxTop - 42 - i*14, size: 10.5, font, color: rgb(0.20,0.26,0.40) });
  });

  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `${forceDownload ? 'attachment' : 'inline'}; filename="${idSped}-${type}.pdf"`
  );
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Render-How','pdf-lib');
  return res.status(200).send(Buffer.from(bytes));
}

// ---------- HANDLER ----------
export default async function handler(req, res){
  // HEAD quick path (alcuni client fanno HEAD prima di GET)
  if (req.method === 'HEAD') {
    res.setHeader('Cache-Control','no-store');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow','GET, HEAD');
    return okJson(res, 405, { ok:false, error:'Method Not Allowed' });
  }

  const q = req.query || {};
  const { sid, type='proforma', exp, sig } = q;
  const formatHtml = ['1','true','html'].includes(String(q.preview||q.format||'').toLowerCase());

  console.log('[render] IN', {
    sid: sid ? sid.slice(0,4)+'…' : '',
    type, format: formatHtml ? 'html' : 'pdf',
    time: new Date().toISOString()
  });

  if (!sid || !exp || !sig) {
    return okJson(res, 400, { ok:false, error:'Bad request', details:'sid/exp/sig required' });
  }
  const now = Math.floor(Date.now()/1000);
  if (Number(exp) <= now) {
    return okJson(res, 401, { ok:false, error:'Expired link' });
  }
  const sigCalc = hmac({ sid, type, exp });
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sigCalc))) {
    return okJson(res, 401, { ok:false, error:'Unauthorized' });
  }

  // prendo il record
  const rec = await fetchRecord(sid);
  const fields = rec?.fields || {};

  try {
    if (formatHtml) {
      const html = renderHtmlTemplate({ fields, sid, type });
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      return res.status(200).send(html);
    }
    // default: PDF (per Allegato/Download)
    const forceDownload = /^(1|true)$/i.test(String(q.dl || ''));
    return await renderPdfLib({ fields, sid, type }, res, { forceDownload });
  } catch (e) {
    console.error('[render] error', e);
    return okJson(res, 500, { ok:false, error:'Render error', details: String(e?.message || e) });
  }
}
