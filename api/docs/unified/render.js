// api/docs/unified/render.js
// Runtime esplicitato a livello vercel.json (nodejs18.x)
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

function log(...a){ console.log('[render]', ...a); }
function bad(res, status, error, details){
  log('ERR', status, error, details || '');
  return res.status(status).json({ ok:false, error, details });
}

export default async function handler(req, res){
  const t0 = Date.now();
  const q = req.query || {};
  const { sid, type = 'proforma', exp, sig, debug } = q;

  // --- Logs ambiente utili per debug
  log('IN', {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    headers: {
      host: req.headers.host,
      'x-vercel-id': req.headers['x-vercel-id'],
      'user-agent': req.headers['user-agent'],
    }
  });

  // TODO: valida la firma se usi HMAC (sid,type,exp,sig).
  if (!sid) return bad(res, 400, 'Missing sid');

  // Impostazioni consigliate per Vercel/Lambda
  chromium.setHeadlessMode = true;
  chromium.setGraphicsMode = false;

  let browser;
  try{
    const exePath = await chromium.executablePath();
    log('chromium path', exePath ? 'OK' : 'NULL');
    log('chromium headless?', chromium.headless, 'argsN', chromium.args?.length);

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: exePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();

    // Qui puoi usare il TEO HTML reale. Per debugging generiamo una pagina minimale.
    const html = `
      <!doctype html><html><head>
        <meta charset="utf-8" />
        <style>body{font:14px system-ui; padding:24px}</style>
      </head><body>
        <h1>Documento di test</h1>
        <p>sid: <code>${sid}</code></p>
        <p>type: <code>${type}</code></p>
        <p>Generated: ${new Date().toISOString()}</p>
      </body></html>
    `;

    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `inline; filename="${sid}-${type}.pdf"`);
    res.status(200).send(Buffer.from(pdf));

    log('OK', { ms: Date.now() - t0, size: pdf.length });
  }catch(e){
    return bad(res, 500, 'Render error', String(e && e.message || e));
  }finally{
    try{ await browser?.close(); }catch{}
  }
}
