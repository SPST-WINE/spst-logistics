// GET /api/airtable/spedizioni?search=&status=all|nuova|in_elab|evase&onlyOpen=0|1&pageSize=50&offset=...
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const search   = (req.query.search || '').toString().trim();
    const status   = (req.query.status || 'all').toString();
    const onlyOpen = (req.query.onlyOpen || '0').toString() === '1';
    const pageSize = clampInt(req.query.pageSize, 1, 100, 50);
    const offset   = (req.query.offset || '').toString();

    const pat    = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table  = process.env.AIRTABLE_TABLE || 'SPEDIZIONI';
    const view   = process.env.AIRTABLE_VIEW || ''; // opzionale
    assertEnv({ pat, baseId, table });

    const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const headers = { Authorization: `Bearer ${pat}` };

    const formula = buildFilterFormula({ search, status, onlyOpen });

    // Parametri comuni
    const common = new URLSearchParams();
    if (formula) common.set('filterByFormula', formula);
    common.set('pageSize', String(pageSize));
    if (view) common.set('view', view);
    if (offset) common.set('offset', offset);

    // Prova a ordinare su una lista di possibili campi "created"; fallback senza sort
    const sortCandidates = [
      'Data Creazione',      // il tuo campo
      'Created',             // a volte nominato così
      'Created time',        // nome di default Airtable EN
      'Created Time',        // variante
    ];

    // 1) tenta i sort noti uno per volta; se 422 → prova il successivo
    for (const field of sortCandidates) {
      const p = new URLSearchParams(common);
      p.set('sort[0][field]', field);
      p.set('sort[0][direction]', 'desc');
      try {
        const out = await airtableFetch(`${baseUrl}?${p.toString()}`, { headers });
        return res.status(200).json(out);
      } catch (e) {
        // se non è un 422 (unknown field), propaga subito
        if (!String(e).includes('422')) throw e;
        // se è 422, continua con il prossimo candidato
      }
    }

    // 2) ultimo tentativo: senza sort (usa ordine della view)
    const out2 = await airtableFetch(`${baseUrl}?${common.toString()}`, { headers });
    return res.status(200).json(out2);

  } catch (e) {
    console.error('[GET spedizioni] error', e);
    res.status(500).json({ error: 'Fetch failed', details: String(e?.message || e) });
  }
}

/* ───────── SEARCH formula ───────── */

function buildFilterFormula({ search, status, onlyOpen }) {
  const parts = [];

  // Ricerca full-text case-insensitive su più campi
  if (search) {
    const s = esc(search.toLowerCase());
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

    const ors = [];

    // match esatto veloce per ID e Tracking
    ors.push(`LOWER({ID Spedizione} & "") = "${s}"`);
    ors.push(`LOWER({Tracking Number} & "") = "${s}"`);

    // match "contiene" su tutti i campi
    for (const f of FIELDS) {
      ors.push(`SEARCH("${s}", LOWER({${f}} & ""))`);
    }

    parts.push(`OR(${ors.join(',')})`);
  }

  // Filtri stato
  if (status === 'evase') parts.push('{Stato Spedizione}');
  if (status === 'nuova' || status === 'in_elab' || onlyOpen) parts.push('NOT({Stato Spedizione})');

  if (!parts.length) return '';
  return `AND(${parts.join(',')})`;
}

/* ───────── helpers (CORS, fetch, utils) ───────── */

function esc(s){ return String(s).replace(/"/g,'\\"'); }
function clampInt(v,min,max,d){ const n=parseInt(v,10); return Number.isNaN(n)? d : Math.min(max,Math.max(min,n)); }
function assertEnv({ pat, baseId, table }){ if(!pat) throw new Error('AIRTABLE_PAT missing'); if(!baseId) throw new Error('AIRTABLE_BASE_ID missing'); if(!table) throw new Error('AIRTABLE_TABLE missing'); }

function sendCORS(req,res){
  const origin = req.headers.origin || ''; // quando apri la URL direttamente può essere vuoto
  const list = (process.env.ORIGIN_ALLOWLIST || '*').split(',').map(s=>s.trim()).filter(Boolean);

  const allowed =
    list.includes('*') ||
    (!origin) || // nessun header Origin: non settiamo CORS ma non è un errore
    list.some(p => safeWildcardMatch(origin, p));

  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age','600');
  if (req.method === 'OPTIONS') return res.status(204).end();
}

function safeWildcardMatch(input, pattern){
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input);
}
function escapeRegex(str){ return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

async function airtableFetch(url, init = {}, tries = 3, backoff = 500){
  for(let i=0;i<tries;i++){
    const r = await fetch(url, init);
    if (r.ok) return r.json();
