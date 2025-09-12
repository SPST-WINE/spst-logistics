// api/docs/unified/render.js — PDF senza Chromium (pdf-lib)

import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const config = { runtime: 'nodejs', memory: 256, maxDuration: 10 };

const SIGN = process.env.DOCS_SIGNING_SECRET || '';

function hmac(params) {
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}
function bad(res, code, payload) {
  res.status(code).json({ ok: false, ...payload });
}

export default async function handler(req, res) {
  const t0 = Date.now();
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return bad(res, 405, { error: 'Method Not Allowed' });
    }

    const { sid, type = 'proforma', exp, sig } = req.query || {};
    console.log('[render-pdf] IN', {
      time: new Date().toISOString(),
      sid,
      type,
      exp,
      hasSig: Boolean(sig),
      region: process.env.VERCEL_REGION
    });

    if (!SIGN) return bad(res, 500, { error: 'Render misconfigured', details: 'DOCS_SIGNING_SECRET missing' });
    if (!sid || !exp || !sig) return bad(res, 400, { error: 'Bad Request', details: 'Missing sid/exp/sig' });

    const now = Math.floor(Date.now() / 1000);
    if (Number(exp) < now) return bad(res, 401, { error: 'Link expired' });

    const expected = hmac({ sid, type, exp });
    if (sig !== expected) return bad(res, 401, { error: 'Unauthorized', details: 'Bad signature' });

    // ===== PDF =====
    const A4 = { w: 595.28, h: 841.89 }; // punti tipografici
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([A4.w, A4.h]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

    const title =
      type === 'fattura'
        ? 'Fattura commerciale'
        : type === 'dle'
        ? 'Dichiarazione libera esportazione'
        : 'Fattura proforma';

    // intestazione
    page.drawText('SPST Logistics', {
      x: 40, y: A4.h - 60, size: 18, font: fontB, color: rgb(0.12, 0.12, 0.12),
    });
    page.drawText(`Documento: ${title}`, {
      x: 40, y: A4.h - 90, size: 14, font, color: rgb(0.15, 0.15, 0.15),
    });
    page.drawText(`ID Spedizione: ${sid}`, {
      x: 40, y: A4.h - 110, size: 12, font, color: rgb(0.2, 0.2, 0.2),
    });
    page.drawText(`Generato: ${new Date().toLocaleString('it-IT')}`, {
      x: 40, y: A4.h - 130, size: 11, font, color: rgb(0.35, 0.35, 0.35),
    });

    // box placeholder contenuti (qui in futuro inseriremo i dati reali)
    const boxY = A4.h - 180;
    page.drawRectangle({
      x: 40, y: boxY - 280, width: A4.w - 80, height: 280,
      borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1, color: rgb(1,1,1),
    });
    page.drawText('Contenuti documento (placeholder)', {
      x: 52, y: boxY - 24, size: 12, font: fontB, color: rgb(0.25, 0.25, 0.25),
    });
    page.drawText(
      'Questa versione genera un PDF “pulito” senza Chromium.\n' +
      'La pipeline di allegato su Airtable ora può funzionare senza dipendenze di sistema.\n' +
      'Quando vuoi, sostituiremo questo placeholder con il layout definitivo.',
      { x: 52, y: boxY - 46, size: 11, font, color: rgb(0.2, 0.2, 0.2), lineHeight: 14 }
    );

    const bytes = await pdf.save();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${sid}-${type}.pdf"`);
    res.status(200).send(Buffer.from(bytes));

    console.log('[render-pdf] OK', { ms: Date.now() - t0, size: bytes.length });
  } catch (err) {
    console.error('[render-pdf] ERR', err);
    return bad(res, 500, { error: 'Render error', details: String(err?.message || err) });
  }
}
