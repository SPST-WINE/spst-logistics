// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// ── Env
const SIGN = process.env.DOCS_SIGNING_SECRET || '';

function log(note, extra = {}) {
  console.log('[docs/unified/render]', note, { ...extra, t: new Date().toISOString() });
}

function bad(res, code, msg) {
  log(`ERR ${code}`, { msg });
  res.status(code).setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send(msg);
}

function okHeaders(res, filename = 'documento.pdf') {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
}

function verify({ sid, type, exp, sig }) {
  if (!sid || !type || !exp || !sig) return false;
  const qs = new URLSearchParams({ sid, type, exp }).toString();
  const expected = crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
  return expected === sig && Number(exp) >= Math.floor(Date.now() / 1000);
}

export default async function handler(req, res) {
  const { sid = '', type = 'proforma', exp = '', sig = '' } = req.query || {};
  log('IN', {
    method: req.method,
    sid: String(sid).slice(0, 8) + '…',
    type,
    referer: req.headers.referer,
    ua: req.headers['user-agent'],
  });

  // HEAD: Airtable spesso fa HEAD prima di GET. Rispondiamo 200 con gli header giusti.
  if (req.method === 'HEAD') {
    if (!verify({ sid, type, exp, sig })) return bad(res, 401, 'Invalid signature (HEAD)');
    okHeaders(res, `${sid}-${type}.pdf`);
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,HEAD');
    return bad(res, 405, 'Method Not Allowed');
  }

  if (!verify({ sid, type, exp, sig })) return bad(res, 401, 'Invalid or expired signature');

  // HTML minimal per provare l’attachment: sostituisci in futuro con il tuo template reale.
  const html = `<!doctype html>
  <html><head><meta charset="utf-8">
    <style>
      @page { size: A4; margin: 24mm 16mm; }
      body{ font-family: -apple-system, Segoe UI, Inter, Roboto, Arial; color:#0b1220; }
      h1{ font-size:24px; margin:0 0 8px; }
      .muted{ color:#555; }
      .box{ margin-top:18px; padding:12px; border:1px solid #ddd; border-radius:8px; }
    </style>
  </head>
  <body>
    <h1>Documento: ${String(type).toUpperCase()}</h1>
    <div class="muted">Shipment (record id): <strong>${sid}</strong></div>
    <div class="box">PDF generato automaticamente alle ${new Date().toLocaleString('it-IT')}</div>
  </body></html>`;

  let browser;
  try {
    const exePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: exePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16mm', right: '12mm', bottom: '16mm', left: '12mm' },
    });

    okHeaders(res, `${sid}-${type}.pdf`);
    log('OK 200 PDF', { bytes: pdf.length });
    return res.status(200).send(Buffer.from(pdf));
  } catch (e) {
    return bad(res, 500, 'Render failed: ' + (e?.message || e));
  } finally {
    try { await browser?.close(); } catch {}
  }
}
