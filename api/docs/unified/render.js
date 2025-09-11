// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import crypto from 'crypto';

const TB   = process.env.TB_SPEDIZIONI || 'Spedizioni';
const BASE = process.env.AIRTABLE_BASE_ID;
const PAT  = process.env.AIRTABLE_PAT;
const SIGN = process.env.DOCS_SIGNING_SECRET;

function verify(params) {
  const { sid, type, exp, sig } = params;
  if (!sid || !type || !exp || !sig) return false;
  const now = Math.floor(Date.now()/1000);
  if (Number(exp) < now - 5) return false;
  const data = new URLSearchParams({ sid, type, exp }).toString();
  const expected = crypto.createHmac('sha256', SIGN).update(data).digest('hex');
  try{
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }catch{
    return false;
  }
}

async function fetchRecord(id){
  const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}/${id}`, {
    headers:{ 'Authorization':`Bearer ${PAT}` }
  });
  if (!r.ok) throw new Error(`Airtable ${r.status}`);
  return r.json();
}

function templateHTML({ rec, type }){
  const f = (k,d='') => rec.fields?.[k] ?? d;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>${type.toUpperCase()} • ${f('ID Spedizione', rec.id)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box} body{font-family:Inter,system-ui,Arial;margin:32px;color:#111}
  h1{font-size:20px;margin:0 0 16px} .kv{display:grid;grid-template-columns:160px 1fr;gap:6px;margin:6px 0}
  .tag{display:inline-block;padding:4px 8px;border:1px solid #ddd;border-radius:8px;font-size:12px}
  table{width:100%;border-collapse:collapse;margin-top:12px} th,td{border:1px solid #ddd;padding:8px;font-size:12px}
</style></head>
<body>
  <h1>${type.toUpperCase()}</h1>
  <div class="kv"><div>ID spedizione</div><div>${f('ID Spedizione', rec.id)}</div></div>
  <div class="kv"><div>Cliente</div><div>${f('Creato da email','—')}</div></div>
  <div class="kv"><div>Incoterm</div><div><span class="tag">${f('Incoterm','—')}</span></div></div>
  <div class="kv"><div>Ritiro</div><div>${f('Ritiro - Data','—')}</div></div>
  <table><thead><tr><th>Descrizione</th><th>Q.tà</th><th>Peso</th></tr></thead>
  <tbody><tr><td>Merce</td><td>1</td><td>${f('Peso reale tot', f('Peso tariffato tot','—'))}</td></tr></tbody></table>
  <p style="margin-top:24px;color:#666;font-size:12px">Documento generato automaticamente.</p>
</body></html>`;
}

export default async function handler(req, res){
  try{
    const url = new URL(req.url, `http://${req.headers.host}`);
    const p = Object.fromEntries(url.searchParams);
    if (!verify(p)) return res.status(403).send('Forbidden');

    const rec  = await fetchRecord(p.sid);
    const html = templateHTML({ rec, type: p.type });

    const browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground:true,
      margin:{ top:'12mm', bottom:'12mm', left:'12mm', right:'12mm' }
    });
    await browser.close();

    res.setHeader('Content-Type','application/pdf');
    res.setHeader('Cache-Control','public, max-age=60');
    return res.status(200).send(Buffer.from(pdf));
  }catch(e){
    console.error('[docs/render] error', e);
    return res.status(500).send('PDF error');
  }
}
