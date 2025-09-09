// /api/notify/transit.js
import { Resend } from 'resend';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCORS(req, res);
    return res.status(204).end();
  }
  setCORS(req, res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const {
      to,                 // indirizzo digitato a mano dall’operatore
      idSpedizione,       // es. "SP-2025-09-04-2000"
      dataRitiro,         // es. "2025-09-04"
      carrier,            // es. "DHL"
      tracking,           // es. "324238592034"
    } = (await readJson(req)) || {};

    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return res.status(400).json({ error: 'Email non valida' });
    }
    if (!idSpedizione) {
      return res.status(400).json({ error: 'ID spedizione mancante' });
    }

    const FROM   = process.env.EMAIL_FROM || 'notification@spst.it';
    const LOGO   = process.env.EMAIL_LOGO_URL || 'https://www.spst.it/logo-email.png';
    const AREA   = process.env.AREA_RISERVATA_URL || 'https://www.spst.it/area-riservata';
    const WA     = process.env.WHATSAPP_URL || 'https://wa.me/393331234567';
    const resend = new Resend(process.env.RESEND_API_KEY);

    const subject = `SPST • Spedizione in transito — ${idSpedizione}`;
    const html    = renderHTML({ LOGO, AREA, WA, idSpedizione, dataRitiro, carrier, tracking });

    const { data, error } = await resend.emails.send({
      from: FROM,
      to,
      subject,
      html,
      headers: {
        // evitiamo trigger quote/trim di Gmail
        'X-Entity-Ref-ID': idSpedizione
      }
    });

    if (error) {
      return res.status(502).json({ error: String(error?.message || error) });
    }
    return res.status(200).json({ ok: true, id: data?.id || null });
  } catch (e) {
    console.error('[notify/transit] error', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}

/* ───────── email markup ───────── */

function renderHTML({ LOGO, AREA, WA, idSpedizione, dataRitiro, carrier, tracking }) {
  const textColor = '#111111';
  const subColor  = '#555555';
  const border    = '#eceff3';

  // Anchor style for black links everywhere
  const a = 'color:#111111 !important;text-decoration:underline;';
  const btn = (bg, label, href) => `
    <a href="${escapeHtml(href)}"
       style="display:inline-block;padding:10px 16px;border-radius:8px;background:${bg};
              color:#111111 !important;text-decoration:none;font-weight:600;border:1px solid ${border}">
      ${label}
    </a>`;

  return `
<!doctype html>
<html>
  <head>
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
  </head>
  <body style="margin:0;padding:0;background:#ffffff;color:${textColor};-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
      <tr>
        <td align="center" style="padding:28px 16px;">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:640px;max-width:100%;background:#ffffff;border:1px solid ${border};border-radius:12px;">
            <tr>
              <td style="padding:28px 28px 8px 28px;">
                <img src="${escapeHtml(LOGO)}" width="28" height="28" alt="SPST" style="display:block;">
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 6px 28px;">
                <div style="font-size:18px;line-height:1.4;font-weight:700;color:${textColor};">Spedizione in transito</div>
                <div style="font-size:12px;line-height:1.6;color:${subColor};margin-top:2px;">
                  ID: <span style="color:${textColor};font-weight:600;">${escapeHtml(idSpedizione)}</span>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:10px 28px 0 28px;">
                <div style="font-size:14px;line-height:1.8;color:${textColor}">
                  Gentile Cliente, la tua spedizione è stata evasa. Trovi i documenti da stampare all'interno della tua
                  <a href="${escapeHtml(AREA)}" style="${a}">Area Riservata SPST</a>.
                </div>
                <div style="font-size:14px;line-height:1.8;color:${textColor};margin-top:6px;">
                  Ritiro previsto: <span style="font-weight:700">${escapeHtml(dataRitiro || '-')}</span>
                </div>
                <div style="font-size:14px;line-height:1.8;color:${textColor};margin-top:6px;">
                  Se ci dovessero essere problemi con il ritiro puoi riferirti al nostro
                  <a href="${escapeHtml(WA)}" style="${a}">Supporto WhatsApp</a>.
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px 0 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                       style="border:1px solid ${border};border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font:700 12px/1.6 system-ui;color:${subColor};text-transform:uppercase;letter-spacing:.3px;">Corriere:</div>
                      <div style="font:600 14px/1.7 system-ui;color:${textColor};">${escapeHtml(carrier || '-')}</div>

                      <div style="height:8px;line-height:8px;">&nbsp;</div>

                      <div style="font:700 12px/1.6 system-ui;color:${subColor};text-transform:uppercase;letter-spacing:.3px;">Tracking:</div>
                      <div style="font:600 14px/1.7 system-ui;color:${textColor};word-break:break-all;">${escapeHtml(tracking || '-')}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px 0 28px;">
                ${btn('#f7911e', 'Area Riservata', AREA)}
                <span style="display:inline-block;width:10px;"></span>
                ${btn('#d1f6e5', 'Supporto WhatsApp', WA)}
              </td>
            </tr>

            <tr>
              <td style="padding:18px 28px 2px 28px;">
                <div style="font-size:13px;line-height:1.8;color:${textColor}">
                  Grazie,<br>Team SPST
                </div>
                <!-- extra spazio per evitare che Gmail nasconda il footer -->
                <div style="height:18px;line-height:18px;">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td style="padding:0 28px 24px 28px;">
                <div style="font-size:11px;line-height:1.6;color:${subColor}">
                  Ricevi questa mail perché hai effettuato una spedizione con SPST.
                </div>
              </td>
            </tr>
          </table>

          <div style="height:24px;line-height:24px;">&nbsp;</div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/* ───────── utils ───────── */
function setCORS(req, res) {
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || 'https://www.spst.it').split(',').map(s=>s.trim());
  const allowed = list.includes('*') || (origin && list.some(p=>wild(origin,p)));
  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age','600');
}

function wild(input, pattern){
  const rx = '^' + pattern.split('*').map(s=>s.replace(/[|\\{}()[\]^$+?.]/g,'\\$&')).join('.*') + '$';
  return new RegExp(rx).test(input);
}

async function readJson(req){
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c)? c : Buffer.from(c));
  const s = Buffer.concat(chunks).toString('utf8') || '{}';
  try { return JSON.parse(s); } catch { return {}; }
}

function escapeHtml(s=''){
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
