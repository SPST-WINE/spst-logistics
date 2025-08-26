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
const MAIL_FROM      = process.env.MAIL_FROM || 'SPST Logistics <no-reply@spst.it>';
const PUBLIC_QUOTE_BASE_URL = (process.env.PUBLIC_QUOTE_BASE_URL || 'https://spst-logistics.vercel.app/quote').replace(/\/$/,'');

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
  const quoteUrl = `${PUBLIC_QUOTE_BASE_URL}/${encodeURIComponent(slug)}`;

  const lines = [];
  lines.push(`Cliente: ${fields?.Email_Cliente || '—'}`);
  lines.push(`Opzione: ${optionIdx}`);
  if (optionFields) {
    lines.push(`Corriere: ${optionFields.Corriere || '—'}`);
    lines.push(`Servizio: ${optionFields.Servizio || '—'}`);
    lines.push(`Incoterm: ${optionFields.Incoterm || '—'}`);
    lines.push(`Oneri a carico: ${optionFields.Oneri_A_Carico || '—'}`);
    lines.push(`Prezzo: ${money(optionFields.Prezzo, optionFields.Valuta || fields?.Valuta)}`);
    if (Number.isFinite(Number(optionFields.Peso_Kg))) lines.push(`Peso reale: ${Number(optionFields.Peso_Kg).toFixed(2)} kg`);
  }
  lines.push('');
  lines.push(`Link preventivo: ${quoteUrl}`);

  const text = lines.join('\n');
  const html = `
  <div style="font:14px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial;color:#111">
    <h2 style="margin:0 0 8px">Preventivo accettato</h2>
    <p style="margin:0 0 8px"><strong>Opzione:</strong> ${optionIdx}</p>
    <p style="margin:0 0 8px"><strong>Cliente:</strong> ${escapeHtml(fields?.Email_Cliente || '—')}</p>
    ${optionFields ? `
      <ul style="margin:8px 0 12px;padding-left:18px">
        <li><strong>Corriere:</strong> ${escapeHtml(optionFields.Corriere || '—')}</li>
        <li><strong>Servizio:</strong> ${escapeHtml(optionFields.Servizio || '—')}</li>
        <li><strong>Incoterm:</strong> ${escapeHtml(optionFields.Incoterm || '—')}</li>
        <li><strong>Oneri a carico:</strong> ${escapeHtml(optionFields.Oneri_A_Carico || '—')}</li>
        <li><strong>Prezzo:</strong> ${money(optionFields.Prezzo, optionFields.Valuta || fields?.Valuta)}</li>
        ${Number.isFinite(Number(optionFields.Peso_Kg)) ? `<li><strong>Peso reale:</strong> ${Number(optionFields.Peso_Kg).toFixed(2)} kg</li>` : ``}
      </ul>` : ``}
    <p style="margin:0 0 8px">Link preventivo: <a href="${quoteUrl}" target="_blank" rel="noopener">${quoteUrl}</a></p>
  </div>`.trim();

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject,
      html,
      text
    })
  });
  const json = await resp.json().catch(()=>null);
  if (!resp.ok) {
    console.error('[accept] email send failed:', json || resp.statusText);
    return { sent:false, status:resp.status, payload:json };
  }
  return { sent:true, payload:json };
}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

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
