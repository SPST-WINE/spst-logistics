// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

// ——— utils ———
function hmac(params, secret) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}
function nowSec() { return Math.floor(Date.now() / 1000); }
function j(res, code, obj) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(obj));
}

export default async function handler(req, res) {
  const t0 = Date.now();
  const { sid = '', type = 'proforma', exp = '0', sig = '', html, diag } = req.query || {};

  try {
    // 1) Validazione firma
    const SECRET = process.env.DOCS_SIGNING_SECRET || process.env.DOCS_SIGNING_SECRET_UNIFIED || '';
    if (!SECRET) return j(res, 500, { ok: false, error: 'Missing signing secret' });

    const params = { sid, type, exp: String(exp) };
    const expected = hmac(params, SECRET);
    if (!sid || !sig || sig !== expected) {
      console.warn('[render] 401 bad-signature', { sid, type, exp, sigPrefix: String(sig).slice(0,10) });
      return j(res, 401, { ok: false, error: 'Unauthorized' });
    }
    if (Number(exp) <= nowSec()) {
      console.warn('[render] 410 expired', { sid, exp });
      return j(res, 410, { ok: false, error: 'Link expired' });
    }

    // 2) Diag opzionale
    if (diag) {
      return j(res, 200, {
        ok: true,
        diag: {
          node: process.version,
          vercel: !!process.env.VERCEL,
          region: process.env.VERCEL_REGION || '',
          chromiumVersion: chromium.version,
          headless: chromium.headless,
          time: new Date().toISOString(),
          query: { sid, type, exp, sig },
        },
      });
    }

    // 3) HTML di test (qui poi metteremo il template vero)
    const htmlDoc = `<!doctype html>
<html><head>
  <meta charset="utf-8" />
  <title>${type.toUpperCase()} – ${sid}</title>
  <style>
    body{ font-family: system-ui, -apple-system, Segoe UI, Inter, Roboto, sans-serif; margin:28px; }
    h1{ margin:0 0 10px; }
    .muted{ color:#666 }
    table{ width:100%; border-collapse:collapse; margin-top:18px }
    td,th{ border:1px solid #ddd; padding:8px; }
  </style>
</head>
<body>
  <h1>${type === 'fattura' ? 'Fattura commerciale' : type === 'dle' ? 'Dichiarazione libera esportazione' : 'Fattura proforma'}</h1>
  <div class="muted">ID Spedizione: <strong>${sid}</strong></div>
  <div class="muted">Generato: ${new Date().toLocaleString('it-IT')}</div>
  <table>
    <tr><th>Voce</th><th>Valore</th></tr>
    <tr><td>Tipo</td><td>${type}</td></tr>
    <tr><td>Nota</td><td>Template di prova: se lo vedi, la pipeline PDF funziona ✔︎</td></tr>
  </table>
</body></html>`;

    // Se chiami con ?html=1 vedi l'HTML invece di un PDF (debug)
    if (html === '1') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(htmlDoc);
    }

    // 4) Avvio Chromium (Sparticuz) + Puppeteer
    console.log('[render] launching chromium…');
    const executablePath = await chromium.executablePath();

    const executablePath = await chromium.executablePath();
console.log('[render] chromium path =', executablePath);

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1200, height: 1600, deviceScaleFactor: 2 },
      executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(htmlDoc, { waitUntil: ['domcontentloaded', 'networkidle0'] });
      await page.emulateMediaType('screen');

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      });

      const filename = `${sid}-${type}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

      console.log('[render] OK pdf bytes=', pdf?.length, 'ms=', Date.now() - t0);
      return res.status(200).send(Buffer.from(pdf));
    } finally {
      // chiudi il browser SEMPRE
      try { await (await (globalThis.__br || Promise.resolve(null)))?.close?.(); } catch {}
      try { await browser.close(); } catch {}
    }
  } catch (err) {
    console.error('[render] 500', err);
    return j(res, 500, {
      ok: false,
      error: 'Render error',
      details: String(err?.message || err),
    });
  }
}
