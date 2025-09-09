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
    const table  = process.env.USE_NEW_SHIPMENTS_TABLE
      ? (process.env.TB_SPEDIZIONI_WEBAPP || 'SpedizioniWebApp')
      : (process.env.AIRTABLE_TABLE || 'SPEDIZIONI');
    const view   = process.env.AIRTABLE_VIEW || '';
    assertEnv({ pat, baseId, table });

    const baseUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    const headers = { Authorization: `Bearer ${pat}`, Accept: 'application/json' };

    // costruiamo i parametri con formula
    const params = new URLSearchParams();
    params.set('pageSize', String(pageSize));
    if (view)  params.set('view', view);
    if (offset) params.set('offset', offset);

    const formula = buildFilterFormula({ search, status, onlyOpen });
    if (formula) params.set('filterByFormula', formula);

    // 1) tentativo con filterByFormula (risposta “grezza” per capire lo status)
    const urlWithFormula = `${baseUrl}?${params.toString()}`;
    const r1 = await fetch(urlWithFormula, { headers });

    if (r1.status === 422) {
      // 2) FALLBACK: niente formula → filtro lato server per ricerca “sensibile”
      const p2 = new URLSearchParams();
      p2.set('pageSize', String(pageSize));
      if (view)  p2.set('view', view);
      if (offset) p2.set('offset', offset);

      const urlNoFormula = `${baseUrl}?${p2.toString()}`;
      const r2 = await fetch(urlNoFormula, { headers });
      if (!r2.ok) {
        const t = await r2.text().catch(()=> '');
        return res.status(502).json({ error: 'Upstream error', details: `Airtable ${r2.status}: ${t.slice(0,280)}` });
      }
      const data = await r2.json();
      const all  = Array.isArray(data?.records) ? data.records : [];

      // filtro lato server
      let records = all;
      if (search)  records = records.filter(rec => recordMatches(rec, search));
      if (status !== 'all') records = records.filter(rec => matchStatus(rec, status));
      if (onlyOpen) records = records.filter(rec => isOpen(rec));

      return res.status(200).json({ records, offset: data?.offset });
    }

    // 3) happy path con formula
    if (!r1.ok) {
      const t = await r1.text().catch(()=> '');
      return res.status(502).json({ error: 'Upstream error', details: `Airtable ${r1.status}: ${t.slice(0,280)}` });
    }
    const out = await r1.json();
    return res.status(200).json(out);

  } catch (e) {
    console.error('[GET spedizioni] error', e);
    return res.status(502).json({ error: 'Upstream error', details: String(e?.message || e) });
  }
}

/* ───────── SEARCH formula ───────── */

const NEW_FIELDS = [
  'ID Spedizione',
  'Creato da',
  'Mittente - Ragione sociale',
  'Mittente - Paese',
  'Mittente - Città',
  'Mittente - CAP',
  'Mittente - Indirizzo',
  'Destinatario - Ragione sociale',
  'Destinatario - Paese',
  'Destinatario - Città',
  'Destinatario - CAP',
  'Destinatario - Indirizzo',
  'Tracking Number',
  'Incoterm',
];

const LEGACY_FIELDS = [
  'Destinatario',
  'Mittente',
  'Mail Cliente',
  'Paese Destinatario',
  'Città Destinatario',
  'Indirizzo Destinatario',
  'Paese Mittente',
  'Città Mittente',
  'Indirizzo Mittente',
];

const SEARCH_FIELDS = [...NEW_FIELDS, ...LEGACY_FIELDS];

function buildFilterFormula({ search, status, onlyOpen }) {
  const parts = [];

  if (search) {
    const s = esc(search.toLowerCase());
    const NEW_FIELDS = [
      'ID Spedizione','Creato da',
      'Mittente - Ragione sociale','Mittente - Paese','Mittente - Città','Mittente - Indirizzo',
      'Destinatario - Ragione sociale','Destinatario - Paese','Destinatario - Città','Destinatario - Indirizzo',
      'Tracking Number','Incoterm',
    ];
    const LEGACY_FIELDS = [
      'Destinatario','Mittente','Mail Cliente',
      'Paese Destinatario','Città Destinatario','Indirizzo Destinatario',
      'Paese Mittente','Città Mittente','Indirizzo Mittente',
    ];
    const FIELDS = [...NEW_FIELDS, ...LEGACY_FIELDS];

    const ors = [];
    // match esatto su ID/Tracking
    ors.push(`LOWER({ID Spedizione} & "") = "${s}"`);
    ors.push(`LOWER({Tracking Number} & "") = "${s}"`);
    // match "contiene" su tutto il resto
    for (const f of FIELDS) ors.push(`FIND("${s}", LOWER({${f}} & ""))`);
    parts.push(`OR(${ors.join(',')})`);
  }

  const IS_EVASA       = `{Stato}="Evasa"`;
  const IS_NUOVA       = `{Stato}="Nuova"`;
  const IS_CONSEGNATA  = `{Stato}="Consegnata"`;
  const IS_ANNULLATA   = `{Stato}="Annullata"`;

  // filtro esplicito per tab/filtri se mai usati
  if (status === 'evase') parts.push(IS_EVASA);
  else if (status === 'nuova') parts.push(IS_NUOVA);
  else if (status === 'in_elab') {
    // “in elaborazione” = tutto tranne stati finali (non usato nel tuo flusso, ma lasciato)
    parts.push(`AND(NOT(${IS_EVASA}), NOT(${IS_CONSEGNATA}), NOT(${IS_ANNULLATA}))`);
  }

  // 🔴 Cambiato: "solo non evase" = SOLO Nuova
  if (onlyOpen) parts.push(IS_NUOVA);

  if (!parts.length) return '';
  return `AND(${parts.join(',')})`;
}


/* ───────── helpers ───────── */

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

// Fallback: match lato server (case-insensitive) su tanti campi
function recordMatches(rec, q) {
  if (!q) return true;
  const needle = String(q).toLowerCase();
  const f = rec?.fields || {};

  // prima controlli “exact” su ID & Tracking
  if (String(f['ID Spedizione'] || '').toLowerCase() === needle) return true;
  if (String(f['Tracking Number'] || '').toLowerCase() === needle) return true;

  for (const k of SEARCH_FIELDS) {
    const v = f[k];
    if (v == null) continue;
    const s = Array.isArray(v) ? JSON.stringify(v) : String(v);
    if (s.toLowerCase().includes(needle)) return true;
  }
  return false;
}

function matchStatus(rec, status){
  const stato = String(rec?.fields?.['Stato'] || '').toLowerCase();
  if (status === 'nuova')  return stato === 'nuova';
  if (status === 'evase')  return stato === 'evasa';
  if (status === 'in_elab') return !['evasa','consegnata','annullata'].includes(stato);
  return true;
}

function isOpen(rec){
  const stato = String(rec?.fields?.['Stato'] || '').toLowerCase();
  return !['in transito','consegnata','annullata'].includes(stato);
}
