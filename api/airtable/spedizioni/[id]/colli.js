// /api/airtable/spedizioni/[id]/colli.js
// GET /api/airtable/spedizioni/:id/colli  → { ok:true, rows:[{L,W,H,kg,qty}], total:number }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const id = (req.query.id || '').toString();
    if (!id) return res.status(400).json({ ok:false, error: 'Missing shipment record id' });

    const pat    = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const tbColli = process.env.TB_SPED_COLLI || 'SPED_COLLI';
    assertEnv({ pat, baseId, tbColli });

    const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tbColli)}`;
    const headers = { Authorization: `Bearer ${pat}` };

    // 1) prendiamo i colli (tutti, con paginazione) e filtriAMO in Node sugli ID linkati
    let offset = '';
    const all = [];
    do {
      const params = new URLSearchParams();
      params.set('pageSize', '100');
      if (offset) params.set('offset', offset);
      // Niente filterByFormula su ARRAYJOIN: filtriamo in Node per robustezza
      const url = `${baseUrl}?${params.toString()}`;
      const page = await airtableFetch(url, { headers });
      (page.records || []).forEach(r => all.push(r));
      offset = page.offset || '';
    } while (offset);

    // 2) Filtra colli per Spedizione linkata = id
    const mine = all.filter(r => {
      const links = r?.fields?.Spedizione || r?.fields?.['Spedizione'] || [];
      return Array.isArray(links) && links.includes(id);
    });

    // 3) Normalizza
    const rows = mine.map(r => normalizeCollo(r.fields || {}));

    res.status(200).json({ ok: true, rows, total: rows.length });
  } catch (e) {
    console.error('[GET colli] error', e);
    res.status(502).json({ ok:false, error: 'Upstream error', details: String(e?.message || e) });
  }
}

/* ───────── helpers ───────── */

function normalizeCollo(f) {
  // Alias robusti: lunghezza/larghezza/altezza cm, peso (kg), quantita
  const L = num(pick(f, 'Lunghezza (cm)', 'Lunghezza', 'L_cm', 'L', 'Lunghezza_cm'));
  const W = num(pick(f, 'Larghezza (cm)', 'Larghezza', 'W_cm', 'W', 'Larghezza_cm'));
  const H = num(pick(f, 'Altezza (cm)', 'Altezza', 'H_cm', 'H', 'Altezza_cm'));
  const kg = num(pick(f, 'Peso (kg)', 'Peso', 'Kg', 'Peso_Kg', 'Peso_kg'));
  const qty = int(pick(f, 'Quantità', 'Quantita', 'Qty', 'Qta', 'Qtà')) || 1;

  return {
    L: isFinite(L) ? L : '-',
    W: isFinite(W) ? W : '-',
    H: isFinite(H) ? H : '-',
    kg: isFinite(kg) ? kg : 0,
    qty
  };
}

function pick(obj, ...keys){ for (const k of keys){ if (k in obj && obj[k] != null && obj[k] !== '') return obj[k]; } }
function num(v){ const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; }
function int(v){ const n = parseInt(String(v), 10); return Number.isFinite(n) ? n : NaN; }

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

function assertEnv({ pat, baseId, tbColli }){
  if(!pat) throw new Error('AIRTABLE_PAT missing');
  if(!baseId) throw new Error('AIRTABLE_BASE_ID missing');
  if(!tbColli) throw new Error('TB_SPED_COLLI missing');
}

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
