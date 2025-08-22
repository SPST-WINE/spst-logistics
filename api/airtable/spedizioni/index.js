// GET /api/airtable/spedizioni?search=&status=all&onlyOpen=0&pageSize=50
// Ritorna lo stesso payload Airtable (records[]) così il FE usa l'adapter esistente.

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const pat    = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table  = process.env.AIRTABLE_TABLE || 'SPEDIZIONI';
    assertEnv({ pat, baseId, table });

    const search   = String(req.query.search || '').trim();
    const status   = String(req.query.status || 'all').trim();
    const onlyOpen = String(req.query.onlyOpen || '0') === '1';
    const pageSize = clampInt(req.query.pageSize, 1, 100, 50);

    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));

    // ------ filtro combinato ------
    const filters = [];

    // onlyOpen => NOT({Stato Spedizione})
    if (onlyOpen) filters.push('NOT({Stato Spedizione})');

    // status: qui lo lasciamo per future estensioni; oggi è "all"
    // (se vuoi filtri aggiuntivi reali, si aggiungono qui con altri campi)

    // full-text search case-insensitive su più campi
    if (search) {
      filters.push(buildSearchFormula(search));
    }

    if (filters.length) {
      const formula = filters.length === 1 ? filters[0] : `AND(${filters.join(',')})`;
      params.set('filterByFormula', formula);
    }

    // Ordinamento opzionale (qui per createdTime desc)
    params.append('sort[0][field]', 'Created');
    params.append('sort[0][direction]', 'desc');

    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${pat}` }
    });

    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }

    return res.status(r.status).json(data);
  } catch (e) {
    console.error('[GET spedizioni] unexpected error', e);
    return res.status(502).json({ error: 'Upstream error', details: String(e?.message || e) });
  }
}

/* ---------------- helpers ---------------- */

function clampInt(v, min, max, def) {
  const n = parseInt(String(v ?? ''), 10);
  if (Number.isFinite(n)) return Math.max(min, Math.min(max, n));
  return def;
}

function escAirtableString(s) {
  return String(s).replace(/"/g, '\\"');
}

/**
 * Costruisce una formula Airtable case-insensitive che fa match su più campi.
 * Usa LOWER() sui campi + query in lower.
 */
function buildSearchFormula(q) {
  const qLower = escAirtableString(String(q).toLowerCase());
  // Campi principali da cercare (puoi aggiungere/rimuovere liberamente)
  const FIELDS = [
    'ID Spedizione',
    'Destinatario',
    'Mittente',
    'Mail Cliente',
    'Paese Destinatario',
    'Città Destinatario',
    'Indirizzo Destinatario',
    'Paese Mittente',
    'Città Mittente',
    'Indirizzo Mittente',
    'Tracking Number',
    'Incoterm'
  ];

  const terms = FIELDS.map(f =>
    // SEARCH(substring, text) → true se >0; concat &"" per evitare BLANK()
    `SEARCH("${qLower}", LOWER({${f}} & ""))`
  );

  // match esatto veloce per ID e Tracking, se serve
  const exacts = [
    `LOWER({ID Spedizione} & "") = "${qLower}"`,
    `LOWER({Tracking Number} & "") = "${qLower}"`
  ];

  return `OR(${[...exacts, ...terms].join(',')})`;
}

function sendCORS(req, res) {
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  const allowed =
    list.includes('*') ||
    (!origin) ||
    list.some(p => safeWildcardMatch(origin, p));

  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
}

function safeWildcardMatch(input, pattern) {
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input);
}
function escapeRegex(str) { return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

function assertEnv({ pat, baseId, table }) {
  if (!pat) throw new Error('AIRTABLE_PAT missing');
  if (!baseId) throw new Error('AIRTABLE_BASE_ID missing');
  if (!table) throw new Error('AIRTABLE_TABLE missing');
}
