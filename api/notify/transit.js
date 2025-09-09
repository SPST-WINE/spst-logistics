// POST /api/notify/transit
// Body JSON: { to, id, carrier, tracking, ritiroData }
// Invia una mail brandizzata "Spedizione in transito" con Resend.

import { Resend } from 'resend';

/* ───────── CORS ───────── */
function sendCORS(req, res) {
  const origin = req.headers.origin || '';
  const allow = process.env.ORIGIN_ALLOWLIST || 'https://www.spst.it,https://spst.it,*';
  const list = allow.split(',').map(s=>s.trim()).filter(Boolean);
  const ok = list.includes('*') || !origin || list.some(p => wildcard(origin, p));
  if (ok && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
function wildcard(input, pattern){
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(s=>s.replace(/[|\\{}()[\]^$+?.]/g,'\\$&')).join('.*') + '$';
  return new RegExp(rx).test(input);
}

/* ───────── helpers ───────── */
const fmtDate = (s) => (s ? String(s).slice(0,10) : '—'); // YYYY-MM-DD
const esc = (s) => String(s||'').replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

export default async function handler(req, res){
  if (sendCORS(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try{
    const {
      to,
      id,
      carrier = '',
      tracking = '',
      ritiroData = '',
    } = (req.body || {});

    const RESEND_API_KEY   = process.env.RESEND_API_KEY;
    const EMAIL_FROM       = process.env.EMAIL_FROM         || 'notification@spst.it';
    const EMAIL_LOGO_URL   = process.env.EMAIL_LOGO_URL     || 'https://www.spst.it/logo-email.png';
    const AREA_RISERVATA   = process.env.AREA_RISERVATA_URL || 'https://www.spst.it/area-riservata';
    const WHATSAPP_URL     = process.env.WHATSAPP_URL       || 'https://wa.me/391234567890';

    if (!RESEND_API_KEY)   return res.status(500).json({ error: 'RESEND_API_KEY missing' });
    if (!to)               return res.status(400).json({ error: 'Missing "to"' });
    if (!id)               return res.status(400).json({ error: 'Missing "id"' });

    const resend = new Resend(RESEND_API_KEY);

    // Branding coerente al template "conferma"
    const BRAND_PRIMARY = '#1c3e5e';
    const BRAND_ACCENT  = '#f7911e';
    const BRAND_BG      = '#f6f8fb';

    /* ───────── HTML (card bianca con header brand, link neri, bottoni come template) ───────── */
    const html = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <meta name="x-apple-disable-message-reformatting">
    <title>SPST • Spedizione in transito — ${esc(id)}</title>
  </head>
  <body style="margin:0;background:${BRAND_BG};font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;">
    <!-- Preheader -->
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Spedizione in transito — ritiro previsto ${esc(fmtDate(ritiroData))}.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_BG};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
            <!-- Header brand -->
            <tr>
              <td style="background:${BRAND_PRIMARY};padding:20px 24px;">
                ${EMAIL_LOGO_URL ? `<img src="${esc(EMAIL_LOGO_URL)}" alt="SPST" style="height:28px;display:block;border:0;filter:brightness(110%);">` : ``}
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:24px;">
                <h1 style="margin:0 0 8px 0;font-size:20px;color:#0f172a;">Spedizione in transito</h1>

                <!-- ID -->
                <table role="presentation" style="width:100%;margin:8px 0 16px;">
                  <tr><td style="font-size:12px;color:#6b7280;padding-bottom:4px;">ID spedizione</td></tr>
                  <tr>
                    <td style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:14px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;color:#111827;">
                      ${esc(id)}
                    </td>
                  </tr>
                </table>

                <p style="margin:0 0 12px 0;color:#111;font-size:14px;line-height:1.55;">
                  Gentile Cliente, la tua spedizione è stata evasa. Trovi i documenti da stampare all'interno della tua
                  <a href="${esc(AREA_RISERVATA)}" target="_blank" style="color:#111;text-decoration:underline;">Area Riservata SPST</a>.
                </p>

                <p style="margin:0 0 12px 0;color:#111;font-size:14px;line-height:1.55;">
                  Ritiro previsto: <strong>${esc(fmtDate(ritiroData))}</strong>
                </p>

                <p style="margin:0 0 16px 0;color:#111;font-size:14px;line-height:1.55;">
                  Se ci dovessero essere problemi con il ritiro puoi riferirti al nostro
                  <a href="${esc(WHATSAPP_URL)}" target="_blank" style="color:#111;text-decoration:underline;">Supporto WhatsApp</a>.
                </p>

                <!-- Box corriere -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;background:#fff;margin:16px 0;">
                  <tr>
                    <td style="padding:14px 16px;font-size:14px;color:#111;">
                      <div style="margin:0 0 6px 0;"><span style="font-weight:600;color:#555;">Corriere:</span> ${esc(carrier || '—')}</div>
                      <div><span style="font-weight:600;color:#555;">Tracking:</span> ${esc(tracking || '—')}</div>
                    </td>
                  </tr>
                </table>

                <!-- CTA: primario scuro, secondario arancione -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0;">
                  <tr>
                    <td>
                      <a href="${esc(AREA_RISERVATA)}" target="_blank"
                         style="display:inline-block;background:${BRAND_PRIMARY};color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:600;font-size:14px;">
                        Area Riservata
                      </a>
                    </td>
                    <td style="width:10px"></td>
                    <td>
                      <a href="${esc(WHATSAPP_URL)}" target="_blank"
                         style="display:inline-block;background:${BRAND_ACCENT};color:#111827;text-decoration:none;padding:12px 16px;border-radius:10px;font-weight:600;font-size:14px;">
                        Supporto WhatsApp
                      </a>
                    </td>
                  </tr>
                </table>

                <!-- Saluti -->
                <p style="margin:18px 0 24px 0;color:#111;font-size:14px;line-height:1.55;">
                  Grazie,<br>Team SPST
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:16px 24px;background:#f3f4f6;color:#6b7280;font-size:12px;">
                <p style="margin:0;">Ricevi questa mail perché hai effettuato una spedizione con SPST.</p>
              </td>
            </tr>
          </table>

          <div style="color:#94a3b8;font-size:12px;margin-top:12px"></div>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    /* ───────── Testo semplice ───────── */
    const text =
`Spedizione in transito — ${id}

Gentile Cliente, la tua spedizione è stata evasa.
Trovi i documenti da stampare nella tua Area Riservata SPST: ${AREA_RISERVATA}
Ritiro previsto: ${fmtDate(ritiroData)}

Corriere: ${carrier || '—'}
Tracking: ${tracking || '—'}

Se ci fossero problemi con il ritiro, contatta il Supporto WhatsApp: ${WHATSAPP_URL}

Grazie,
Team SPST`;

    const subject = `SPST • Spedizione in transito — ${id}`;
    const from = EMAIL_FROM;

    const sent = await resend.emails.send({ from, to, subject, html, text });
    return res.status(200).json({ ok: true, id: sent?.id || null });

  }catch(e){
    console.error('[notify/transit] error', e);
    return res.status(502).json({ error: 'Send failed', details: String(e?.message || e) });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } }
};
