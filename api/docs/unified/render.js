// api/docs/unified/render.js  — Serverless Function (Node.js 20)

import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// Config Vercel: node runtime, memoria e timeout
export const config = {
  runtime: 'nodejs',
  memory: 1024,
  maxDuration: 60,
};

// ─────────────────────────────────────────────
// Utils: firma HMAC e validazione query
// ─────────────────────────────────────────────
const SIGN = process.env.DOCS_SIGNING_SECRET || '';

function hmac(params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}
function bad(res, code, payload) {
  res.status(code).json({ ok: false, ...payload });
}

// ─────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return bad(res, 405, { error: 'Method Not Allowed' });
    }

    const { sid, type = 'proforma', exp, sig } = req.query || {};
    // Log versione pacchetti e ambiente — utilissimo per debug in Vercel
    console.log('[render] env', {
      node: process.version,
      chromiumVer: (await import('@sparticuz/chromium/package.json')).default.version,
      puppeteerVer: (await import('puppeteer-core/package.json')).default.version,
      region: process.env.VERCEL_REGION,
    });

    // Validazioni base
    if (!SIGN) return bad(res, 500, { error: 'Render misconfigured', details: 'DOCS_SIGNING_SECRET missing' });
    if (!sid || !exp || !sig) return bad(res, 400, { error: 'Bad Request', details: 'Missing sid/exp/sig' });

    // Check exp + signature
    const now = Math.floor(Date.now() / 1000);
    if (Number(exp) < now) return bad(res, 401, { error: 'Link expired' });

    const expected = hmac({ sid, type, exp });
    if (sig !== expected) return bad(res, 401, { error: 'Unauthorized', details: 'Bad signature' });

    // HTML minimal per test (puoi sostituire con il tuo template reale)
    const html = /*html*/`
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font: 14px/1.4 -apple-system, Segoe UI, Roboto, sans-serif; padding: 32px; }
          h1 { margin: 0 0 10px; }
          .muted { color: #666; }
          .box { margin-top:16px; padding:12px; border:1px solid #ddd; border-radius:8px; }
        </style>
      </head>
      <body>
        <h1>Documento: ${type.toUpperCase()}</h1>
        <div class="muted">Spedizione: ${sid}</div>
        <div class="box">
          <div>Generato il: ${new Date().toLocaleString('it-IT')}</div>
          <div>Environment: Node ${process.version}</div>
        </div>
      </body>
      </html>
    `;

    // Parametri Puppeteer/Chromium (IMPORTANTISSIMI)
    const executablePath = await chromium.executablePath(); // usa binario bundle
    const launchOpts = {
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,     // true in serverless
      ignoreHTTPSErrors: true,
    };

    console.log('[render] launch opts', {
      headless: launchOpts.headless,
      exe: launchOpts.executablePath,
      args0: launchOpts.args?.slice(0, 5), // primi 5 args per non inondare i log
    });

    let browser;
    try {
      browser = await puppeteer.launch(launchOpts);
    } catch (e) {
      console.error('[render] launch error', e);
      return bad(res, 500, { error: 'Render error', details: String(e?.message || e) });
    }

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '16mm', right: '14mm', bottom: '16mm', left: '14mm' },
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${sid}-${type}.pdf"`);
      res.status(200).send(Buffer.from(pdf));
      console.log('[render] OK', { ms: Date.now() - t0 });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    console.error('[render] fatal', err);
    return bad(res, 500, { error: 'Render error', details: String(err?.message || err) });
  }
}
