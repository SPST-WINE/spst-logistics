// /api/airtable/spedizioni/[id].js
// PATCH /api/airtable/spedizioni/:id
// Body accettati:
//   { fields:{...} }  oppure  { carrier, tracking, statoEvasa, docs:{ chiaveUI:url } }

export default async function handler(req, res){
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method Not Allowed' });

  try{
    const id = (req.query.id || req.query.slug || '').toString();
    if (!id) return res.status(400).json({ error: 'Missing record id' });

    const pat    = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table  = process.env.AIRTABLE_TABLE || 'SPEDIZIONI';
    assertEnv({ pat, baseId, table });

    const bodyRaw = await readJson(req);
    const fields  = { ...(bodyRaw.fields || {}) };

    // ---- mapping alto livello → campi Airtable ----
    // Tracking
    if (typeof bodyRaw.tracking === 'string' && bodyRaw.tracking.trim()){
      fields['Tracking Number'] = bodyRaw.tracking.trim();
    }

    // Corriere (single select): accetta stringa o oggetto {name}, normalizza sinonimi
    const rawCarrier = typeof bodyRaw.carrier !== 'undefined'
      ? bodyRaw.carrier
      : undefined;
    if (typeof rawCarrier !== 'undefined'){
      const norm = normalizeCarrier(rawCarrier); // sempre stringa
      if (norm) fields['Corriere'] = norm;
    }

    // Stato evasa (checkbox)
    if (typeof bodyRaw.statoEvasa === 'boolean'){
      fields['Stato Spedizione'] = !!bodyRaw.statoEvasa;
    }

    // Documenti (attachments + links) dalla tua mappatura
    if (bodyRaw.docs && typeof bodyRaw.docs === 'object'){
      Object.assign(fields, mapDocsToAirtable(bodyRaw.docs));
    }

    if (!Object.keys(fields).length){
      return res.status(400).json({ error: 'No fields to update' });
    }

    // ---- PATCH verso Airtable con propagazione status (niente 500 “fasulli”) ----
    const { status, ok, data } = await airtablePatch({ baseId, table, id, pat, fields });

    if (!ok){
      // log sintetico lato server per diagnosi (senza token)
      console.warn('[PATCH spedizione] Airtable error', status, data);
    }

    res.status(status).json(data);
  }catch(e){
    console.error('[PATCH spedizione] unexpected error', e);
    // errore di rete / eccezioni non-Airtable
    res.status(502).json({ error:'Upstream error', details: String(e?.message || e) });
  }
}

/* ───────── helpers (CORS sicuro, fetch, utils) ───────── */

function sendCORS(req,res){
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*')
    .split(',')
    .map(s=>s.trim())
    .filter(Boolean);

  const allowed =
    list.includes('*') ||
    (!origin) ||
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

function assertEnv({ pat, baseId, table }){
  if(!pat)   throw new Error('AIRTABLE_PAT missing');
  if(!baseId)throw new Error('AIRTABLE_BASE_ID missing');
  if(!table) throw new Error('AIRTABLE_TABLE missing');
}

async function readJson(req){
  let raw=''; for await (const c of req) raw+=c;
  try{ return JSON.parse(raw||'{}'); }catch{ return {}; }
}

// --- Normalizza "Corriere" single select ---
function normalizeCarrier(input){
  if (input == null) return '';
  let s = input;
  if (typeof s === 'object' && s.name) s = s.name;
  s = String(s).trim();
  if (!s) return '';

  const k = s.toLowerCase().replace(/[\s-]/g,'');
  const map = {
    dhl:'DHL', dhlexpress:'DHL',
    fedex:'FedEx', fedexexpress:'FedEx', fx:'FedEx', fedexground:'FedEx',
    ups:'UPS', unitedparcelservice:'UPS',
    tnt:'TNT', tntexpress:'TNT',
    gls:'GLS',
    dpd:'DPD',
    poste:'Poste', posteitaliane:'Poste',
    altro:'Altro', other:'Altro'
  };
  return map[k] || s; // se è già “giusto”, lo lascia intatto
}

// Patch “trasparente”: non lancia eccezioni su 4xx/5xx Airtable,
// ma restituisce {status, ok, data}
async function airtablePatch({ baseId, table, id, pat, fields }){
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
  const r = await fetch(url, {
    method:'PATCH',
    headers:{ 'Authorization': `Bearer ${pat}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ fields })
  });
  const text = await r.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch{ data = { error: text }; }
  return { status: r.status, ok: r.ok, data };
}

function mapDocsToAirtable(docs){
  const out = {};
  const ATT = {
    'Lettera_di_Vettura': 'Lettera di Vettura',
    'Fattura_Proforma': 'Fattura Proforma',
    'Dichiarazione_Esportazione': 'Dichiarazione Esportazione',
    'Packing_List': 'Packing List',
    'FDA_Prior_Notice': 'Prior Notice'
  };
  const LINKS = {
    'Fattura_Commerciale': 'Fattura Commerciale Caricata',
    'Fattura_Proforma_Caricata': 'Fattura Proforma Caricata'
  };
  for (const [k,url] of Object.entries(docs||{})){
    if (ATT[k] && url) out[ATT[k]] = [{ url: String(url) }];
    else if (LINKS[k] && url) out[LINKS[k]] = String(url);
  }
  return out;
}
