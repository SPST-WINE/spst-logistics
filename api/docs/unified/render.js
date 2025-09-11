// api/docs/unified/render.js
export const config = { runtime: 'nodejs' };

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import crypto from 'crypto';

function signHmac({ sid, type, exp }, secret) {
  // Ordine *fisso*: sid, type, exp  → deve combaciare con /generate
  const qs = new URLSearchParams([
    ['sid', sid],
    ['type', type],
    ['exp', String(exp)],
  ]).toString();
  return crypto.createHmac('sha256', secret).update(qs).digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const q = req.query || {};
  const sid  = Array.isArray(q.sid)  ? q.sid[0]  : (q.sid  || '');
  const type = Array.isArray(q.type) ? q.type[0] : (q.type || 'proforma');
  const exp  = Number(Array.isArray(q.exp) ? q.exp[0] : (q.exp || ''));
  const sig  = Array.isArray(q.sig)  ? q.sig[0]  : (q.sig  || '');

  const secret = process.env.DOCS_SIGNING_SECRET || '';
  const now = Math.floor(Date.now() / 1000);

  // LOG INIZIALE
  console.log('[render] IN', {
    sid, type, exp, now,
    sigPrefix: (sig || '').slice(0, 12) + '…',
    secretLen: secret ? String(secret).length : 0,
    host: req.headers.host,
  });

  // VALIDAZIONI
  if (!secret) {
    console.error('[render] Missing DOCS_SIGNING_SECRET');
    return res.status(500).json({ ok:false, error:'Server misconfigured', details:'DOCS_SIGNING_SECRET missing' });
  }
  if (!sid || !exp || !sig) {
    console.warn('[render] Missing params', { hasSid: !!sid, hasExp: !!exp, hasSig: !!sig });
    return res.status(401).json({ ok:false, error:'Unauthorized', details:'Missing sid/exp/sig' });
  }
  if (!Number.isFinite(exp) || exp < now) {
    console.warn('[render] Link expired', { exp, now });
    return res.status(401).json({ ok:false, error:'Unauthorized', details:'Expired link', exp, now });
  }

  const expected = signHmac({ sid, type, exp }, secret);
  if (expected !== sig) {
    console.warn('[render] Bad signature', {
      expectedPrefix: expected.slice(0, 12) + '…',
      gotPrefix:      (sig || '').slice(0, 12) + '…',
      sid, type, exp
    });
    return res.status(401).json({
      ok:false, error:'Unauthorized', details:'Bad signature',
      expectedPrefix: expected.slice(0, 12) + '…',
      gotPrefix: (sig || '').slice(0, 12) + '…'
    });
  }

  try {
    // HTML *segnaposto* (sostituisci con il template reale)
    const title =
      type === 'fattura' ? 'FATTURA COMMERCIALE' :
      type === 'dle'     ? 'DICHIARAZIONE LIBERA ESPORTAZIONE' :
                           'FATTURA PROFORMA';

    const html = `
      <html><head>
        <meta charset="utf-8" />
        <style>
          body{ font-family: -apple-system, Segoe UI, Roboto, Inter, sans-serif; margin:36px; font-size:12pt; }
          h1{ font-size:20pt; margin:0 0 10px }
          .muted{ color:#666; font-size:10pt; margin-bottom:24px }
          .box{ border:1px solid #ddd; padding:12px; border-radius:8px; }
        </style>
      </head><body>
        <h1>${title}</h1>
        <div class="muted">ID Spedizione: <strong>${sid}</strong></div>
        <div class="box">
          PDF dimostrativo generato dal render endpoint.
        </div>
      </body></html>`;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    await browser.close();

    console.log('[render] OK send pdf', { bytes: pdf.length });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sid}-${type}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(pdf);
  } catch (e) {
    console.error('[render] ERROR', e);
    return res.status(500).json({ ok:false, error:'Render error', details:String(e?.message || e) });
  }
}
