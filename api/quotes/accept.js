// api/quotes/accept.js

// ===== CORS (riusa stessa allowlist di create.js) =====
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

async function fetchOptionsForQuote(quoteId) {
  const base = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(TB_OPT)}`;
  const sort = `&sort[0][field]=Indice&sort[0][direction]=asc`;

  // tentativo col campo servizio "Preventivo_Id" (testo)
  let url = `${base}?filterByFormula=${encodeURIComponent(`{Preventivo_Id}='${quoteId}'`)}${sort}`;
  try {
    const j = await atFetch(url);
    if (Array.isArray(j.records) && j.records.length) return j.records;
  } catch {}

  // fallback: cerca sul linked record
  url = `${base}?filterByFormula=${encodeURIComponent(`FIND('${quoteId}', ARRAYJOIN({Preventivo}))`)}${sort}`;
  const j = await atFetch(url);
  return j.records || [];
}

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

    const already = rec.fields?.Opzione_Accettata;
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

    // 3) best-effort: marca anche l’opzione come accettata (se il campo esiste)
    try {
      const options = await fetchOptionsForQuote(rec.id);
      const match = options.find(r => Number(r.fields?.Indice) === option);
      if (match) {
        await atUpdate(TB_OPT, [{ id: match.id, fields: { Accettata: true } }]);
      }
    } catch (e) {
      // ignora errori tipo UNKNOWN_FIELD_NAME ecc.
      console.warn('[accept] could not mark option as accepted:', e?.payload?.error || e.message);
    }

    return res.status(200).json({ ok:true });
  } catch (err) {
    const status  = err.status || 500;
    const details = err.payload || { name: err.name, message: err.message, stack: err.stack };
    console.error('[api/quotes/accept] error:', details);
    return res.status(status).json({ ok:false, error: details });
  }
}
