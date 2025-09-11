// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const SIGN = process.env.DOCS_SIGNING_SECRET || '';

function log(note, extra = {}) {
  console.log('[docs/unified/render]', note, { ...extra, t: new Date().toISOString() });
}
function fail(res, code, msg, extra = {}) {
  log(`ERR ${code}`, { msg, ...extra });
  res.status(code).setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(msg);
}
function verifySig({ sid, type, exp, sig }) {
  if (!sid || !type || !exp || !sig) return false;
  const qs = new URLSearchParams({ sid, type, exp }).toString();
  const expected = crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
  return expected === sig && Number(exp) >= Math.floor(Date.now() / 1000);
}
function pdfHeaders(res, filename, length) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  if (Number.isFinite(length)) res.setHeader('Content-Length', String(length));
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  res.setHeader('Accept-Ranges', 'none');
}

async function buildPdfBuffer(html) {
  const exePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: exePath,
    headless: chromium.headless,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });
    return buf;
  } finally {
    try { await browser.close(); } catch {}
  }
}

export default async function handler(req, res) {
  const q = req.query || {};
  const sid  = String(q.sid || '');
  const type = String(q.type || 'proforma');
  const exp  = String(q.exp || '');
  const sig  = String(q.sig || '');

  log('IN', { method: req.method, sid: sid.slice(0,8)+'…', type, referer: req.headers.referer });

  if (!verifySig({ sid, type, exp, sig })) {
    return fail(res, 401, 'Invalid or expired signature', { sid: sid.slice(0,8)+'…', type, exp });
  }

  // HTML minimo di test (sostituisci in futuro col tuo template)
  const html = `<!doctype html>
  <html><head><meta charset="utf-8">
    <style>
      @page { size:A4; margin:24mm 16mm; }
      body { font-family: -apple-system, Segoe UI, Inter, Roboto, Arial; color:#0b1220; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      .muted { color: #555; }
      .box { margin-top: 14px; padding: 10px; border: 1px solid #ddd; border-radius: 8px; }
    </style>
  </head>
  <body>
    <h1>${type.toUpperCase()}</h1>
    <div class="muted">Record: <strong>${sid}</strong></div>
    <div class="box">PDF generato alle ${new Date().toLocaleString('it-IT')}</div>
  </body></html>`;

  try {
    // ⚠️ Generiamo il PDF anche per HEAD per poter dare Content-Length: alcuni client (Airtable) lo gradiscono.
    const buf = await buildPdfBuffer(html);
    const filename = `${sid}-${type}.pdf`;

    if (req.method === 'HEAD') {
      pdfHeaders(res, filename, buf.length);
      log('HEAD 200', { bytes: buf.length });
      return res.status(200).end();
    }
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET,HEAD');
      return fail(res, 405, 'Method Not Allowed');
    }

    pdfHeaders(res, filename, buf.length);
    log('GET 200 PDF', { bytes: buf.length });
    return res.status(200).send(buf);
  } catch (e) {
    return fail(res, 500, 'Render failed: ' + (e?.message || e));
  }
}
