// api/docs/unified/render.js
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import crypto from 'crypto';

export const config = { runtime: 'nodejs' }; // Node 20 è impostato a livello di progetto

function bad(res, code, msg, extra) {
  console.error('[render] ERR', code, msg, extra || '');
  return res.status(code).json({ ok:false, error:msg, details: extra || undefined });
}

function hmac(params, secret) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return bad(res, 405, 'Method Not Allowed');
  }

  const SID   = String(req.query.sid || '').trim();
  const TYPE  = String(req.query.type || 'proforma').trim();
  const EXP   = Number(req.query.exp || 0);
  const SIG   = String(req.query.sig || '').trim();
  const SEC   = (process.env.DOCS_SIGNING_SECRET || '').trim();

  // Log d’ingresso
  console.log('[render] IN', {
    sid: SID, type: TYPE, exp: EXP,
    hasSig: !!SIG, hasSecret: !!SEC,
    ua: req.headers['user-agent']
  });

  if (!SID || !SEC) return bad(res, 400, 'Missing sid or server secret');
  if (!EXP || Date.now()/1000 > EXP) return bad(res, 401, 'Link expired');

  // Verifica firma
  const expect = hmac({ sid: SID, type: TYPE, exp: String(EXP) }, SEC);
  if (expect !== SIG) return bad(res, 401, 'Unauthorized');

  // Chromium flags consigliati in serverless
  chromium.setHeadlessMode = true;
  chromium.setGraphicsMode = false;

  let browser;
  try {
    const exe = await chromium.executablePath();
    console.log('[render] chromium info', {
      headless: chromium.headless,
      exePath: exe,
      argsLen: chromium.args?.length,
      defaultViewport: chromium.defaultViewport
    });

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: exe,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    await page.setContent(
      `<!doctype html><html><head>
         <meta charset="utf-8">
         <style>
           body{font-family:Inter,system-ui,Segoe UI,Roboto,Arial,sans-serif;margin:32px}
           h1{margin:0 0 8px}
           .muted{color:#666}
           .box{margin-top:18px;padding:12px 14px;border:1px solid #ddd;border-radius:8px}
         </style>
       </head><body>
         <h1>Documento: ${TYPE.toUpperCase()}</h1>
         <div class="muted">Spedizione: ${SID}</div>
         <div class="box">Questo è un PDF di prova generato in serverless per verificare Chromium su Vercel.</div>
       </body></html>`,
      { waitUntil: 'networkidle0' }
    );
    await page.emulateMediaType('screen');

    const pdf = await page.pdf({ format: 'A4', printBackground: true });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${SID}-${TYPE}.pdf"`);
    return res.status(200).send(Buffer.from(pdf));
  } catch (e) {
    return bad(res, 500, 'Render error', String(e && e.message || e));
  } finally {
    try { await browser?.close(); } catch {}
  }
}
