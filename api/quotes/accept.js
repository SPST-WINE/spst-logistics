// api/quotes/accept.js

// ===== CORS (stessa logica di create.js) =====
const DEFAULT_ALLOW = [
  'https://spst.it',
  'https://www.spst.it',
  'https://spst-logistics.vercel.app',
  'http://localhost:3000',
  'http://localhost:8888',
];
const allowlist = (process.env.ORIGIN_ALLOWLIST || DEFAULT_ALLOW.join(','))
  .split(',').map(s => s.trim()).filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes('*')) {
      const esc = item.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace('\\*', '.*');
      if (new RegExp('^' + esc + '$').test(origin)) return true;
    } else if (item === origin) return true;
  }
  return false;
}
function setCors(res, origin) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (isAllowed(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
}

// ===== Airtable =====
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;     // Preventivi
const TB_OPT   = process.env.TB_OPZIONI;        // OpzioniPreventivo

async function atFetch(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const j = await r.json();
  if (!r.ok) {
    const e = new Error(j?.error?.message || 'Airtable error');
    e.status = r.status;
    e.payload = j;
    throw e;
  }
  return j;
}
async function atUpdate(table, records) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${AT_PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const err = new Error(json?.error?.message || 'Airtable error');
    err.status = resp.status;
    err.payload = json;
    throw err;
  }
  return json;
}
function toNumber(x){ const n = Number(x); return Number.isFinite(n) ? n : undefined; }
function money(n, curr='EUR'){
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  try { return new Intl.NumberFormat('it-IT', { style:'currency', currency: curr }).format(num); }
  catch { return `${num.toFixed(2)} ${curr}`; }
}
function esc(s=''){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

// Opzioni del preventivo (prima campo testo Preventivo_Id, poi fallback su linked)
async function fetchOptionsForQuote(quoteId) {
  const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_OPT)}`;
  const sort = `&sort[0][field]=Indice&sort[0][direction]=asc`;

  let url = `${base}?filterByFormula=${encodeURIComponent(`{Preventivo_Id}='${quoteId}'`)}${sort}`;
  try {
    const j = await atFetch(url);
    if (Array.isArray(j.records) && j.records.length) return j.records;
  } catch {}

  url = `${base}?filterByFormula=${encodeURIComponent(`FIND('${quoteId}', ARRAYJOIN({Preventivo}))`)}${sort}`;
  const j = await atFetch(url);
  return j.records || [];
}

// ===== Email (Resend) =====
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM      = process.env.MAIL_FROM || 'SPST Logistics <notification@spst.it>';
const PUBLIC_QUOTE_BASE_URL = (process.env.PUBLIC_QUOTE_BASE_URL || 'https://spst-logistics.vercel.app/quote').replace(/\/$/,'');
const WA_LINK = 'https://wa.me/393201441789';
const LOGO_URL = 'https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png';

function buildAcceptanceEmailHTML({ slug, quoteFields, optionIdx, optionFields }) {
  const url = `${PUBLIC_QUOTE_BASE_URL}/${encodeURIComponent(slug)}`;
  const rows = [
    ['Opzione', esc(optionIdx ?? '')],
    ['Cliente', esc(quoteFields?.Email_Cliente || '')],
    ['Corriere', esc(optionFields?.Corriere || '')],
    ['Servizio', esc(optionFields?.Servizio || '')],
    ['Incoterm', esc(optionFields?.Incoterm || '')],
    ['Oneri a carico', esc(optionFields?.Oneri_A_Carico || '')],
    ['Prezzo', money(optionFields?.Prezzo, optionFields?.Valuta || quoteFields?.Valuta || 'EUR')],
    ['Peso reale', Number.isFinite(Number(optionFields?.Peso_Kg)) ? `${Number(optionFields.Peso_Kg).toFixed(2)} kg` : '—'],
    ['Link preventivo', `<a href="${url}" target="_blank" rel="noopener">${esc(url)}</a>`],
  ];

  return `<!doctype html>
<html lang="it"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Preventivo accettato • SPST</title>
<style>
  body{margin:0;background:#0b1224;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#e7ecf5}
  .wrap{max-width:640px;margin:0 auto;padding:24px}
  .card{background:#0e162b;border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:20px}
  .mt{margin-top:14px}.mb{margin-bottom:14px}
  .title{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;margin:0 0 6px}
  .logo{width:26px;height:26px}
  .muted{color:#9aa3b7}
  .cta a{display:inline-block;background:#f7911e;color:#1a1a1a;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:600}
  table{width:100%;border-collapse:collapse;margin-top:10px}
  th,td{padding:10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;font-size:14px}
  th{width:160px;color:#9aa3b7;font-weight:600}
  .footer{font-size:12px;color:#9aa3b7;margin-top:16px}
  @media (prefers-color-scheme: light){
    body{background:#f5f7fb;color:#0b1224}
    .card{background:#fff;border-color:#e7eaf1}
    .footer{color:#5b6478}
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1 class="title">
        <img class="logo" src="${LOGO_URL}" alt="SPST"/>
        Preventivo accettato!
      </h1>
      <p class="muted mb">Gentile Cliente,<br/>il tuo preventivo è stato accettato. Evaderemo la tua spedizione al più presto.</p>

      <div class="mt">
        <strong>Dettagli del preventivo accettato</strong>
        <table aria-label="Dettagli preventivo">
          ${rows.map(([k,v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}
        </table>
      </div>

      <p class="mt cta"><a href="${url}" target="_blank" rel="noopener">Apri il preventivo</a></p>

      <p class="mt">Per ulteriore supporto, puoi scriverci su WhatsApp:
        <a href="${WA_LINK}" target="_blank" rel="noopener">+39 320 144 1789</a>
      </p>

      <p class="footer">Grazie per aver scelto SPST!</p>
    </div>
  </div>
</body></html>`;
}

function buildAcceptanceEmailText({ slug, quoteFields, optionIdx, optionFields }){
  const url = `${PUBLIC_QUOTE_BASE_URL}/${encodeURIComponent(slug)}`;
  return [
    'Preventivo accettato!',
    '',
    'Gentile Cliente,',
    'il tuo preventivo è stato accettato. Evaderemo la tua spedizione al più presto.',
    '',
    `Opzione: ${optionIdx ?? ''}`,
    `Cliente: ${quoteFields?.Email_Cliente || ''}`,
    `Corriere: ${optionFields?.Corriere || ''}`,
    `Servizio: ${optionFields?.Servizio || ''}`,
    `Incoterm: ${optionFields?.Incoterm || ''}`,
    `Oneri a carico: ${optionFields?.Oneri_A_Carico || ''}`,
    `Prezzo: ${money(optionFields?.Prezzo, optionFields?.Valuta || quoteFields?.Valuta || 'EUR')}`,
    `Peso reale: ${Number.isFinite(Number(optionFields?.Peso_Kg)) ? Number(optionFields.Peso_Kg).toFixed(2)+' kg' : '—'}`,
    `Link preventivo: ${url}`,
    '',
    `WhatsApp: +39 320 144 1789 (${WA_LINK})`,
    '',
    'Grazie per aver scelto SPST!',
  ].join('\n');
}

async function sendAcceptanceEmail({ slug, fields, optionIdx, optionFields }) {
  if (!RESEND_API_KEY) {
    console.warn('[accept] RESEND_API_KEY mancante: salto invio email');
    return { sent:false, reason:'missing api key' };
  }
  const toSet = new Set([
    'commerciale@spst.it',
    'info@spst.it',
    (fields?.Email_Cliente || '').trim()
  ].filter(Boolean).map(e => e.toLowerCase()));
  const to = Array.from(toSet);
  if (!to.length) return { sent:false, reason:'no recipients' };

  const subject = `Conferma accettazione preventivo • Opzione ${optionIdx}`;
  const html = buildAcceptanceEmailHTML({ slug, quoteFields: fields, optionIdx, optionFields });
  const text = buildAcceptanceEmailText({ slug, quoteFields: fields, optionIdx, optionFields });

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: MAIL_FROM,              // es. "SPST Logistics <notification@spst.it>"
      to,
      subject,
      html,
      text,
      reply_to: 'commerciale@spst.it'
    })
  });
  const json = await resp.json().catch(()=>null);
  if (!resp.ok) {
    console.error('[accept] email send failed:', json || resp.statusText);
    return { sent:false, status:resp.status, payload:json };
  }
  return { sent:true, payload:json };
}

// ===== Handler =====
export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok:false, error:'Method Not Allowed' });

  try {
    if (!AT_BASE || !AT_PAT || !TB_QUOTE || !TB_OPT) {
      throw new Error('Missing env vars: AIRTABLE_BASE_ID / AIRTABLE_PAT / TB_PREVENTIVI / TB_OPZIONI');
    }

    const body = (req.body && typeof req.body === 'object') ? req.body : JSON.parse(req.body || '{}');
    const slug   = String(body.slug || '').trim();
    const option = toNumber(body.option);

    if (!slug || !option) return res.status(400).json({ ok:false, error:'Missing slug/option' });

    // 1) trova il preventivo per slug
    const qUrl = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_QUOTE)}?filterByFormula=${encodeURIComponent(`{Slug_Pubblico}='${slug}'`)}`;
    const q = await atFetch(qUrl);
    const rec = q.records?.[0];
    if (!rec) return res.status(404).json({ ok:false, error:'Quote not found' });

    const f = rec.fields;
    const already = f?.Opzione_Accettata;
    if (already && Number(already) !== option) {
      return res.status(409).json({ ok:false, error:'Quote already accepted with a different option' });
    }

    // 2) aggiorna il record preventivo
    const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const ua = String(req.headers['user-agent'] || '');
    await atUpdate(TB_QUOTE, [{
      id: rec.id,
      fields: {
        Opzione_Accettata: option,
        Accettato_Il     : new Date().toISOString(),
        Accettato_IP     : ip || undefined,
        Accettato_UA     : ua || undefined,
      }
    }]);

    // 3) trova l’opzione scelta e marca Accettata (best-effort)
    let chosenFields = null;
    try {
      const options = await fetchOptionsForQuote(rec.id);
      const match = options.find(r => Number(r.fields?.Indice) === option);
      if (match) {
        chosenFields = match.fields;
        try { await atUpdate(TB_OPT, [{ id: match.id, fields: { Accettata: true } }]); } catch {}
      }
    } catch (e) {
      console.warn('[accept] could not load options:', e?.payload?.error || e.message);
    }

    // 4) invia email (non blocca il successo se fallisce)
    let emailResult = null;
    try {
      emailResult = await sendAcceptanceEmail({
        slug,
        fields: f,
        optionIdx: option,
        optionFields: chosenFields
      });
    } catch (e) {
      console.error('[accept] email error:', e);
    }

    return res.status(200).json({ ok:true, email: emailResult?.sent ? 'sent' : 'skipped' });
  } catch (err) {
    const status  = err.status || 500;
    const details = err.payload || { name: err.name, message: err.message, stack: err.stack };
    console.error('[api/quotes/accept] error:', details);
    return res.status(status).json({ ok:false, error: details });
  }
}
