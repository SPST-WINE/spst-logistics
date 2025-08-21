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
    const table  = process.env.AIRTABLE_TABLE;
    const view   = process.env.AIRTABLE_VIEW || ''; // opzionale
    assertEnv({ pat, baseId, table });

    const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const headers = { Authorization: `Bearer ${pat}` };

    const formula = buildFilterFormula({ search, status, onlyOpen });

    // 1° tentativo: usa eventualmente la view + sort su "Data Creazione"
    const p1 = new URLSearchParams();
    if (formula) p1.set('filterByFormula', formula);
    p1.set('pageSize', String(pageSize));
    if (view) p1.set('view', view);
    p1.set('sort[0][field]', 'Data Creazione');
    p1.set('sort[0][direction]', 'desc');
    if (offset) p1.set('offset', offset);

    try {
      const out = await airtableFetch(`${baseUrl}?${p1.toString()}`, { headers });
      return res.status(200).json(out);
    } catch (e) {
      // Se il sort causa 422 (campo non esiste), riprova senza sort (usa l'ordinamento della view)
      if (String(e).includes('422')) {
        const p2 = new URLSearchParams(p1);
        p2.delete('sort[0][field]');
        p2.delete('sort[0][direction]');
        const out2 = await airtableFetch(`${baseUrl}?${p2.toString()}`, { headers });
        return res.status(200).json(out2);
      }
      throw e;
    }
  } catch (e) {
    console.error('[GET spedizioni] error', e);
    res.status(500).json({ error: 'Fetch failed', details: String(e?.message || e) });
  }
}

function buildFilterFormula({ search, status, onlyOpen }) {
  const parts = [];
  if (search) {
    const s = esc(search.toLowerCase());
    parts.push(
      `OR(` +
        `FIND("${s}", LOWER({Destinatario})),` +
        `FIND("${s}", LOWER({Mail Cliente})),` +
        `FIND("${s}", LOWER({Mittente})),` +
        `FIND("${s}", LOWER({Tracking Number}))` +
      `)`
    );
  }
  if (status === 'evase') parts.push('{Stato Spedizione}');
  if (status === 'nuova' || status === 'in_elab' || onlyOpen) parts.push('NOT({Stato Spedizione})');
  if (!parts.length) return '';
  return `AND(${parts.join(',')})`;
}

/* ───────── helpers (CORS sicuro, fetch, utils) ───────── */

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

// Match con wildcard sicuro: divide per '*' e scappa il resto
function safeWildcardMatch(input, pattern){
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input);
}

function escapeRegex(str){
  // scappa tutti i metacaratteri regex (niente trucchi con charclass complicate)
  return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

async function airtableFetch(url, init = {}, tries = 3, backoff = 500){
  for(let i=0;i<tries;i++){
    const r = await fetch(url, init);
    if (r.ok) return r.json();
    if ([429,500,502,503,504].includes(r.status) && i<tries-1){
      await new Promise(rs=>setTimeout(rs, backoff*Math.pow(2,i)));
      continue;
    }
    throw new Error(`Airtable ${r.status}: ${await r.text()}`);
  }
}
