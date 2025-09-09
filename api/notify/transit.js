// api/notify/transit.js
import nodemailer from 'nodemailer';

export default async function handler(req, res){
  if (req.method === 'OPTIONS') return sendCORS(req,res);
  sendCORS(req,res);
  if (req.method !== 'POST') return res.status(405).json({ error:'Method Not Allowed' });

  try{
    const { to, id, carrier, tracking, trackingUrl, ritiroData } = req.body || {};
    if (!to || !id) return res.status(400).json({ error:'Missing "to" or "id"' });

    const {
      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE,
      EMAIL_FROM, eMAIL_FROM, MAIL_FROM,               // leggiamo più varianti
      WHATSAPP_URL, EMAIL_LOGO_URL, AREA_RISERVATA_URL
    } = process.env;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: String(SMTP_SECURE||'false') === 'true',
      auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });

    const from = EMAIL_FROM || eMAIL_FROM || MAIL_FROM || 'no-reply@spst.it';
    const subject = `SPST • Spedizione in transito — ${id}`;
    const areaUrl = AREA_RISERVATA_URL || 'https://www.spst.it/area-riservata';
    const waUrl   = WHATSAPP_URL || 'https://wa.me/393XXXXXXXXX';
    const logo    = EMAIL_LOGO_URL || 'https://www.spst.it/favicon.png';

    const html = renderHtml({ logo, subject, id, carrier, tracking, trackingUrl, areaUrl, waUrl, ritiroData });
    const text = renderText({ id, carrier, tracking, trackingUrl, areaUrl, waUrl, ritiroData });

    await transporter.sendMail({ from, to, subject, text, html });

    return res.status(200).json({ ok:true });
  }catch(e){
    console.error('[notify/transit] error', e);
    return res.status(502).json({ error:'Send failed', details: String(e?.message||e) });
  }
}

/* ───────── helpers ───────── */

function sendCORS(req,res){
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age','600');
  if (req.method === 'OPTIONS') return res.status(204).end();
}

function renderText({ id, carrier, tracking, trackingUrl, areaUrl, waUrl, ritiroData }){
  return [
    `Spedizione in transito — ${id}`,
    '',
    'Gentile Cliente, la tua spedizione è stata evasa.',
    `Trovi i documenti da stampare nella tua Area Riservata SPST: ${areaUrl}`,
    `Ritiro previsto: ${ritiroData || '-'}`,
    '',
    `Corriere: ${carrier || '-'}`,
    `Tracking: ${tracking || '-'}`,
    trackingUrl ? `Link tracking: ${trackingUrl}` : '',
    '',
    `Supporto WhatsApp: ${waUrl}`,
    '',
    'Grazie,',
    'Team SPST'
  ].filter(Boolean).join('\n');
}

function renderHtml({ logo, subject, id, carrier, tracking, trackingUrl, areaUrl, waUrl, ritiroData }){
  const btn = (href,label,bg) => `
    <a href="${href}" style="display:inline-block;padding:12px 18px;border-radius:10px;
      text-decoration:none;background:${bg};color:#0b1220;font-weight:600">${label}</a>`;

  return `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head>
  <body style="margin:0;background:#0b1220;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b1220;padding:24px 0">
      <tr><td align="center">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#121a2b;border:1px solid #1d2a47;border-radius:14px;overflow:hidden;color:#e6ebf5">
          <tr><td style="padding:22px 22px 0" align="left">
            <img src="${logo}" alt="SPST" style="height:32px;display:block">
          </td></tr>

          <tr><td style="padding:18px 22px 0">
            <h1 style="margin:0;font-size:20px;line-height:28px;color:#e6ebf5">Spedizione in transito</h1>
            <p style="margin:6px 0 0;color:#9fb0d2;font-size:14px">ID: <strong style="color:#e6ebf5">${id}</strong></p>
          </td></tr>

          <tr><td style="padding:14px 22px 0">
            <p style="margin:0 0 10px;color:#cfd7e6;font-size:14px">
              Gentile Cliente, la tua spedizione è stata evasa.
              Trovi i documenti da stampare all'interno della tua Area Riservata SPST.
            </p>
            <p style="margin:0 0 16px;color:#cfd7e6;font-size:14px">
              Ritiro previsto: <strong style="color:#e6ebf5">${ritiroData || '-'}</strong>
            </p>
            <div style="margin:10px 0 14px;padding:12px;border:1px solid #213157;border-radius:12px;background:#0f1728">
              <div style="font-size:14px;color:#cfd7e6;margin:2px 0">Corriere: <strong style="color:#e6ebf5">${carrier || '-'}</strong></div>
              <div style="font-size:14px;color:#cfd7e6;margin:2px 0">Tracking: <strong style="color:#e6ebf5">${tracking || '-'}</strong></div>
              ${trackingUrl ? `<div style="margin-top:8px"><a href="${trackingUrl}" style="color:#f7911e;text-decoration:none">Apri tracking</a></div>` : ''}
            </div>

            <div style="margin:14px 0 8px">
              ${btn(areaUrl,'Area Riservata','#f7911e')}
              <span style="display:inline-block;width:10px"></span>
              ${btn(waUrl,'Supporto WhatsApp','#8df7c2')}
            </div>

            <p style="margin:16px 0 0;color:#7f8cac;font-size:12px">Grazie,<br>Team SPST</p>
          </td></tr>
        </table>

        <div style="color:#617299;font-size:12px;margin-top:12px">
          Ricevi questa mail perché hai effettuato una spedizione con SPST.
        </div>
      </td></tr>
    </table>
  </body></html>`;
}
