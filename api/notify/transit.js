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

    /* ───────── HTML (sfondo bianco, link neri, no link tracking) ───────── */
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <style>
      body{margin:0;padding:0;background:#ffffff;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;}
      .wrap{max-width:640px;margin:0 auto;padding:24px;}
      .card{border:1px solid #e6e6e6;border-radius:14px;padding:24px;background:#fff;}
      .row{display:block;}
      .logo{width:36px;height:36px;display:inline-block;margin-bottom:8px;}
      h1{font-size:20px;line-height:1.2;margin:4px 0 8px 0;color:#111;}
      .id{font-size:12px;color:#666;margin-bottom:16px;}
      p{font-size:14px;line-height:1.55;margin:0 0 12px 0;color:#111;}
      .box{border:1px solid #eee;border-radius:10px;padding:16px;margin:16px 0;background:#fff;}
      .k{font-weight:600;color:#555;}
      .btns{display:flex;gap:12px;margin-top:12px;flex-wrap:wrap;}
      .btn{display:inline-block;font-size:14px;padding:10px 14px;border-radius:10px;text-decoration:none;color:#111;}
      .btn-primary{background:#f7911e;border:1px solid rgba(0,0,0,.12);}
      .btn-ghost{background:#e6fff3;border:1px solid #b4f0d2;}
      .foot{font-size:12px;color:#666;margin-top:12px;}
      .foot p{margin:0 0 24px 0;} /* spazio extra sotto "Team SPST" */
      a{color:#111 !important;text-decoration:underline !important;}
      @media (prefers-color-scheme: dark){
        body{background:#ffffff;color:#111;} /* forza bianco anche in dark mode */
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <img class="logo" src="${esc(EMAIL_LOGO_URL)}" alt="SPST logo">
        <h1>Spedizione in transito</h1>
        <div class="id">ID: <strong>${esc(id)}</strong></div>

        <p>Gentile Cliente, la tua spedizione è stata evasa. Trovi i documenti da stampare all'interno della tua <a href="${esc(AREA_RISERVATA)}" target="_blank" style="color:#111;text-decoration:underline;">Area Riservata SPST</a>.</p>
        <p>Ritiro previsto: <strong>${esc(fmtDate(ritiroData))}</strong></p>
        <p>Se ci dovessero essere problemi con il ritiro puoi riferirti al nostro <a href="${esc(WHATSAPP_URL)}" target="_blank" style="color:#111;text-decoration:underline;">Supporto WhatsApp</a>.</p>

        <div class="box">
          <div class="row"><span class="k">Corriere:</span> ${esc(carrier || '—')}</div>
          <div class="row"><span class="k">Tracking:</span> ${esc(tracking || '—')}</div>
        </div>

        <div class="btns">
          <a class="btn btn-primary" href="${esc(AREA_RISERVATA)}" target="_blank" style="text-decoration:none;color:#111;">Area Riservata</a>
          <a class="btn btn-ghost"   href="${esc(WHATSAPP_URL)}" target="_blank" style="text-decoration:none;color:#111;">Supporto WhatsApp</a>
        </div>

        <div class="foot">
          <p>Grazie,<br>Team SPST</p>
          <div>Ricevi questa mail perché hai effettuato una spedizione con SPST.</div>
        </div>
      </div>
    </div>
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
