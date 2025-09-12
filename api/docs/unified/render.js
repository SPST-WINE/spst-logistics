// api/docs/unified/render.js
import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

// ENV
const TB   = process.env.TB_SPEDIZIONI || 'SpedizioniWebApp';
const BASE = process.env.AIRTABLE_BASE_ID;
const PAT  = process.env.AIRTABLE_PAT;
const SIGN = process.env.DOCS_SIGNING_SECRET;

const LABEL_BY_TYPE = {
  proforma: 'Fattura proforma',
  fattura:  'Fattura commerciale',
  invoice:  'Fattura commerciale',
  dle:      'Dichiarazione libera esportazione',
  pl:       'Packing list'
};

function hmac(params){
  const qs = new URLSearchParams(params).toString();
  return crypto.createHmac('sha256', SIGN).update(qs).digest('hex');
}

function okJson(res, code, obj){
  res.setHeader('Content-Type','application/json; charset=utf-8');
  return res.status(code).send(JSON.stringify(obj));
}

function fmtDate(){
  try {
    return new Date().toLocaleString('it-IT', { timeZone: 'Europe/Rome', hour12:false });
  } catch {
    return new Date().toISOString().replace('T',' ').replace('Z','');
  }
}

async function fetchRecord(recId){
  try{
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TB)}/${recId}`, {
      headers:{ Authorization:`Bearer ${PAT}` }
    });
    if (!r.ok) return null;
    return await r.json();
  }catch{ return null; }
}

export default async function handler(req, res){
  const q = req.query || {};
  const { sid, type='proforma', exp, sig, dl } = q;

  // log safe
  console.log('[render] IN', {
    sid: sid?.slice(0,4)+'…',
    type,
    dl,
    exp,
    time: new Date().toISOString()
  });

  if (!sid || !exp || !sig) {
    return okJson(res, 400, { ok:false, error:'Bad request', details:'sid/exp/sig required' });
  }
  const now = Math.floor(Date.now()/1000);
  if (Number(exp) <= now) {
    return okJson(res, 401, { ok:false, error:'Expired link' });
  }
  const sigCalc = hmac({ sid, type, exp });
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(sigCalc))) {
    return okJson(res, 401, { ok:false, error:'Unauthorized' });
  }

  try{
    // dati record (per stampare "ID Spedizione" e magari "Corriere")
    const rec = await fetchRecord(sid);
    const fields = rec?.fields || {};
    const idSped = fields['ID Spedizione'] || sid;
    const corriere = fields['Corriere'] || '';

    // PDF ── layout A4
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([595.28, 841.89]); // A4 pt
    const { width, height } = page.getSize();
    const margin = 56;

    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);

    // Header
    page.drawText('SPST Logistics', { x: margin, y: height - margin - 8, size: 18, font: fontB, color: rgb(0.07,0.12,0.20) });
    page.drawText(`Documento: ${LABEL_BY_TYPE[type] || type}`, { x: margin, y: height - margin - 32, size: 12, font, color: rgb(0.12,0.17,0.30) });
    page.drawText(`ID Spedizione: ${idSped}`, { x: margin, y: height - margin - 48, size: 11, font, color: rgb(0.12,0.17,0.30) });
    if (corriere) page.drawText(`Corriere: ${corriere}`, { x: margin, y: height - margin - 64, size: 11, font, color: rgb(0.12,0.17,0.30) });
    page.drawText(`Generato: ${fmtDate()}`, { x: margin, y: height - margin - 80, size: 10, font, color: rgb(0.35,0.40,0.55) });

    // Box contenuti (placeholder finché non inseriamo il layout definitivo)
    const boxTop = height - margin - 120;
    const boxH   = 300;
    const boxW   = width - margin*2;

    // bordo
    page.drawRectangle({
      x: margin, y: boxTop - boxH, width: boxW, height: boxH,
      borderWidth: 1, color: rgb(0.93,0.95,0.98), borderColor: rgb(0.78,0.82,0.90)
    });

    page.drawText('Contenuti documento (placeholder)', {
      x: margin + 12, y: boxTop - 18, size: 11, font: fontB, color: rgb(0.20,0.26,0.40)
    });
    const body = [
      'Questa versione genera un PDF “pulito” senza Chromium.',
      'La pipeline di allegato su Airtable ora può funzionare senza dipendenze di sistema.',
      'Quando vuoi, sostituiremo questo placeholder con il layout definitivo.'
    ];
    body.forEach((line, i) => {
      page.drawText(line, { x: margin + 12, y: boxTop - 42 - i*14, size: 10.5, font, color: rgb(0.20,0.26,0.40) });
    });

    const bytes = await pdf.save();

    // download diretto se dl=1|true, altrimenti inline (per “Apri PDF generato”)
    const forceDownload = /^(1|true)$/i.test(String(dl || ''));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${forceDownload ? 'attachment' : 'inline'}; filename="${idSped}-${type}.pdf"`
    );
    res.setHeader('Cache-Control','no-store');
    res.setHeader('X-Render-How','pdf-lib');

    return res.status(200).send(Buffer.from(bytes));
  }catch(e){
    console.error('[render] error', e);
    return okJson(res, 500, { ok:false, error:'Render error', details: String(e?.message || e) });
  }
}
