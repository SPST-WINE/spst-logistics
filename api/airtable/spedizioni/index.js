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

    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    if (view) params.set('view', view);
    if (offset) params.set('offset', offset);

    const formula = buildFilterFormula({ search, status, onlyOpen });
    if (formula) params.set('filterByFormula', formula);

    // NIENTE sort qui (alcuni campi non esistono in tutte le basi → 422/500).
    const url = `${baseUrl}?${params.toString()}`;
    const out = await airtableFetch(url, { headers });
    return res.status(200).json(out);

  } catch (e) {
    console.error('[GET spedizioni] error', e);
    // Propaghiamo 502 con testo errore Airtable per diagnosi lato FE
    return res.status(502).json({ error: 'Upstream error', details: String(e?.message || e) });
  }
}

/* ───────── SEARCH formula ───────── */

function buildFilterFormula({ search, status, onlyOpen }) {
  const parts = [];

  if (search) {
    const s = esc(search.toLowerCase());

    // Campi indicizzati (estendibili)
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
    // match esatto su ID / Tracking
    ors.push(`LOWER({ID Spedizione} & "") = "${s}"`);
    ors.push(`LOWER({Tracking Number} & "") = "${s}"`);
    // match "contiene" su tutti i campi
    for (const f of FIELDS) {
      ors.push(`FIND("${s}", LOWER({${f}} & ""))`);
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
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*').split(',').map(s=>s.trim()).filter(Boolean);
  const allowed = list.includes('*') || (!origin) || list.some(p => safeWildcardMatch(origin, p));
  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
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
    const body = await r.text().catch(()=> '');
    if ([429,500,502,503,504].includes(r.status) && i<tries-1){
      await new Promise(rs=>setTimeout(rs, backoff*Math.pow(2,i)));
      continue;
    }
    throw new Error(`Airtable ${r.status}: ${body}`);
  }
}
