// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

function jsonError(res, status, error, details) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).send(JSON.stringify({ ok: false, error, details }));
}

function hmac(params, secret) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}

export default async function handler(req, res) {
  try {
    // ── Validazione query + firma ─────────────────────────────
    const { sid, type = 'proforma', exp, sig } = req.query || {};
    if (!sid || !exp || !sig) {
      return jsonError(res, 400, 'Bad request', 'sid, exp e sig sono obbligatori');
    }
    const now = Math.floor(Date.now() / 1000);
    if (+exp < now) {
      return jsonError(res, 401, 'Expired', 'Il link è scaduto');
    }
    const SECRET = (process.env.DOCS_SIGNING_SECRET || '').trim();
    if (!SECRET) {
      return jsonError(res, 500, 'Server misconfigured', 'DOCS_SIGNING_SECRET mancante');
    }
    const expected = hmac({ sid, type, exp }, SECRET);
    if (sig !== expected) {
      return jsonError(res, 401, 'Unauthorized', 'Firma non valida');
    }

    // ── Avvio Chromium headless (ATTENZIONE: NIENTE variabile "executablePath" duplicata) ──
    const execPath = await chromium.executablePath();
    console.log('[render] launching chromium', { execPath, headless: chromium.headless });

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: execPath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // TODO: qui inserirai il template reale della proforma/fattura/DLE.
    // Per sbloccare subito l’errore e verificare che Chromium funzioni,
    // generiamo un PDF di prova.
    const html = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <style>
    body{ font-family: system-ui, Inter, Arial; padding: 32px; }
    h1{ font-size: 22px; margin: 0 0 6px; }
    .muted{ color:#555 }
  </style>
</head>
<body>
  <h1>${type.toUpperCase()} — ${sid}</h1>
  <p class="muted">PDF di test generato dal renderer. Se vedi questo file, Puppeteer + Chromium sono ok.</p>
</body></html>`;

    await page.setContent(html, { waitUntil: ['domcontentloaded', 'networkidle0'] });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
    });

    await browser.close();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdf);
  } catch (e) {
    console.error('[render] error', e);
    return jsonError(res, 500, 'Render error', String(e?.message || e));
  }
}
