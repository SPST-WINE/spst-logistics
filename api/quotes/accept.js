// api/quotes/accept.js

// ===== CORS (stessa logica di create.js) =====
const DEFAULT_ALLOW = [
  "https://spst.it",
  "https://www.spst.it",
  "https://spst-logistics.vercel.app",
  "http://localhost:3000",
  "http://localhost:8888",
];
const allowlist = (process.env.ORIGIN_ALLOWLIST || DEFAULT_ALLOW.join(","))
  .split(",").map(s => s.trim()).filter(Boolean);

function isAllowed(origin) {
  if (!origin) return false;
  for (const item of allowlist) {
    if (item.includes("*")) {
      const esc = item.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("\\*", ".*");
      if (new RegExp("^" + esc + "$").test(origin)) return true;
    } else if (item === origin) return true;
  }
  return false;
}
function setCors(res, origin) {
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (isAllowed(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
}

// ===== Airtable =====
// api/quotes/accept.js

/* ---------- ENV ---------- */
const AT_BASE  = process.env.AIRTABLE_BASE_ID;
const AT_PAT   = process.env.AIRTABLE_PAT;
const TB_QUOTE = process.env.TB_PREVENTIVI;   // "Preventivi"

/* ---------- Helpers ---------- */
async function atList(table, { filterByFormula, maxRecords = 1 } = {}) {
  const url = new URL(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}`);
  if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula);
  if (maxRecords) url.searchParams.set('maxRecords', String(maxRecords));
  const r = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AT_PAT}` } });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(j?.error?.message || `Airtable ${r.status}`);
    err.status = r.status; err.payload = j; throw err;
  }
  return j;
}

async function atPatch(table, id, fields) {
  const url = `https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(table)}/${id}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${AT_PAT}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields })
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(j?.error?.message || `Airtable ${r.status}`);
    err.status = r.status; err.payload = j; throw err;
  }
  return j;
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: { type: 'METHOD_NOT_ALLOWED' } });
    }
    if (!AT_BASE || !AT_PAT || !TB_QUOTE) {
      return res.status(500).json({ ok: false, error: { type: 'CONFIG', message: 'Missing Airtable env vars' } });
    }

    const { slug, optionIndex } = req.body || {};
    const idxNum = Number(optionIndex);
    if (!slug || !Number.isFinite(idxNum)) {
      return res.status(400).json({ ok: false, error: { type: 'INVALID_PARAM', message: 'Missing slug or optionIndex' } });
    }

    // Trova il preventivo per slug pubblico
    const q = await atList(TB_QUOTE, { filterByFormula: `{Slug_Pubblico} = "${slug}"`, maxRecords: 1 });
    const rec = q.records?.[0];
    if (!rec) return res.status(404).json({ ok: false, error: { type: 'NOT_FOUND', message: 'Preventivo non trovato' } });

    const fields = rec.fields || {};
    const stato  = String(fields.Stato || '').toLowerCase();

    // Se già accettato, rispondi idempotente
    if (stato === 'accettato' && Number(fields.Opzione_Accettata) === idxNum) {
      return res.status(200).json({ ok: true, already: true, id: rec.id, slug });
    }

    // IP & UA dal proxy
    const fwd = req.headers['x-forwarded-for'];
    const ip  = Array.isArray(fwd) ? fwd[0] : (fwd || req.headers['x-real-ip'] || '').split(',')[0].trim();
    const ua  = req.headers['user-agent'] || '';

    // Aggiorna i campi richiesti (nessun requisito sui "termini")
    await atPatch(TB_QUOTE, rec.id, {
      Opzione_Accettata: idxNum,          // number
      Accettato_Il     : new Date().toISOString(), // date
      Accettato_IP     : ip || '',        // text
      Accettato_UA     : ua || '',        // text
      Stato            : 'Accettato'      // single select by name
    });

    return res.status(200).json({ ok: true, id: rec.id, slug, acceptedIndex: idxNum });
  } catch (err) {
    console.error('[quotes/accept]', { status: err.status, msg: err.message, payload: err.payload });
    return res.status(err.status || 500).json({ ok: false, error: { message: err.message || 'Server error' } });
  }
}
