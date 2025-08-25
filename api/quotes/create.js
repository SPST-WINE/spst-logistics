// api/quotes/create.js

// --- CORS helper ------------------------------------------------------------
const allowlist = (process.env.ORIGIN_ALLOWLIST || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// supporta anche wildcard tipo https://*.webflow.io
function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes('*')) {
      const esc = item
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace('\\*', '.*');
      const re = new RegExp('^' + esc + '$');
      if (re.test(origin)) return true;
    } else if (item === origin) {
      return true;
    }
  }
  return false;
}

function setCors(res, origin) {
  if (isAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}

// --- Handler ----------------------------------------------------------------
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { quote, options = [] } = req.body || {};
    if (!quote?.Email_Cliente) {
      return res.status(400).json({ error: 'Email cliente mancante' });
    }

    const BASE = process.env.AIRTABLE_BASE_ID;       // es: appwnx59j8NJ1x5ts (solo ID!)
    const TB_PREVENTIVI = process.env.TB_PREVENTIVI; // es: Preventivi
    const TB_OPZIONI   = process.env.TB_OPZIONI;     // es: OpzioniPreventivo
    const TOKEN = process.env.AIRTABLE_PAT;

    const api = (table, init = {}) =>
      fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}`, {
        ...init,
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
          ...(init.headers || {})
        }
      });

    // 1) Crea Preventivo
    const r1 = await api(TB_PREVENTIVI, {
      method: 'POST',
      body: JSON.stringify({ records: [{ fields: quote }] })
    });
    if (!r1.ok) {
      const text = await r1.text();
      console.error('[quotes/create] create preventivo failed:', text);
      return res.status(500).json({ error: 'Airtable create failed', detail: text });
    }
    const created = await r1.json();
    const quoteId = created?.records?.[0]?.id;

    // 2) Opzioni collegate
    if (quoteId && Array.isArray(options) && options.length) {
      const payload = {
        records: options.map((opt, i) => ({
          fields: {
            ...opt,
            Preventivo: [quoteId],
            Indice: opt.Indice ?? (i + 1),
          }
        }))
      };
      const r2 = await api(TB_OPZIONI, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (!r2.ok) {
        const text = await r2.text();
        console.warn('[quotes/create] create opzioni failed:', text);
        return res.status(207).json({ ok: true, quoteId, warning: 'Opzioni non create', detail: text });
      }
    }

    return res.status(200).json({ ok: true, quoteId });
  } catch (err) {
    console.error('[quotes/create] unexpected error:', err);
    return res.status(500).json({ error: 'Server error', detail: String(err) });
  }
}
