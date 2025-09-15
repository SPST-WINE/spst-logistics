// /api/airtable/spedizioni/[id].js
// PATCH /api/airtable/spedizioni/:id
// - Normalizza QUALSIASI chiave "e-DAS" (in qualunque forma) → "Allegato 3"
// - Sposta le chiavi top-level sconosciute dentro fields con alias robusti
// - Log dettagliati (attivabili con DEBUG=1)

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method Not Allowed' });

  const DEBUG = process.env.DEBUG === '1' || process.env.NODE_ENV === 'development';
  const log  = (...a)=> DEBUG && console.log('[PATCH /spedizioni/:id]', ...a);
  const warn = (...a)=> DEBUG && console.warn('[PATCH /spedizioni/:id]', ...a);
  const err  = (...a)=> console.error('[PATCH /spedizioni/:id]', ...a);

  try {
    const id = (req.query.id || req.query.slug || '').toString();
    if (!id) return res.status(400).json({ error: 'Missing record id' });

    const pat   = process.env.AIRTABLE_PAT;
    const baseId= process.env.AIRTABLE_BASE_ID;
    assertEnv({ pat, baseId });

    const bodyRaw = await readJson(req);
    if (DEBUG) log('incoming bodyRaw:', safeSlice(bodyRaw));

    // 1) Costruisci fieldsIn a partire da bodyRaw.fields
    const fieldsIn = { ...(bodyRaw.fields || {}) };

    // 2) Applica mapping per proprietà "alto livello" note
    if (typeof bodyRaw.tracking === 'string' && bodyRaw.tracking.trim()) {
      fieldsIn['Tracking Number'] = bodyRaw.tracking.trim();
    }
    if (typeof bodyRaw.carrier !== 'undefined') {
      const norm = normalizeCarrier(bodyRaw.carrier);
      if (norm) fieldsIn['Corriere'] = norm;
    }
    if (typeof bodyRaw.stato === 'string' && bodyRaw.stato.trim()) {
      fieldsIn['Stato'] = bodyRaw.stato.trim();
      delete fieldsIn['Stato Spedizione'];
    } else if (typeof bodyRaw.statoEvasa === 'boolean') {
      fieldsIn['Stato'] = bodyRaw.statoEvasa ? 'Evasa' : 'Nuova';
      delete fieldsIn['Stato Spedizione'];
    }
    if (bodyRaw.docs && typeof bodyRaw.docs === 'object') {
      Object.assign(fieldsIn, mapDocsToAirtable(bodyRaw.docs));
    }

    // 3) Sposta QUALSIASI chiave top-level non riconosciuta dentro fieldsIn con alias
    {
      const KNOWN = new Set(['carrier','tracking','stato','statoEvasa','docs','fields']);
      for (const k of Object.keys(bodyRaw || {})) {
        if (KNOWN.has(k)) continue;
        // es: se arriva "e-DAS": [...]
        if (typeof bodyRaw[k] !== 'undefined') {
          const mapped = normalizeFieldKey(k);
          fieldsIn[mapped] = bodyRaw[k];
          if (DEBUG && mapped !== k) log(`alias(top-level) ${k} → ${mapped}`);
        }
      }
    }

    // 4) Normalizza TUTTE le chiavi dentro fieldsIn (incluse varianti e-DAS)
    const fields = {};
    for (const [k, v] of Object.entries(fieldsIn)) {
      const mapped = normalizeFieldKey(k);
      fields[mapped] = v;
      if (DEBUG && mapped !== k) log(`alias(fields) ${k} → ${mapped}`);
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // 5) Tabella: preferisci SpedizioniWebApp, fallback legacy; retry automatico
    const candidates = resolveTablesInOrder();
    if (DEBUG) log('table candidates:', candidates);

    let last = { status: 500, data: { error: 'No attempt' } };
    for (const table of candidates) {
      const attemptBody = { fields };
      if (DEBUG) log('PATCH → Airtable', { table, id, fields: Object.keys(fields) });

      const attempt = await airtablePatch({ baseId, table, id, pat, fields });
      if (attempt.ok) {
        if (DEBUG) log('Airtable OK', { table, status: attempt.status });
        return res.status(attempt.status).json({ ...attempt.data, _table: table });
      }

      const errMsg = JSON.stringify(attempt.data || {});
      const retriable =
        attempt.status === 403 || attempt.status === 404 ||
        /MODEL_NOT_FOUND|NOT_FOUND|TABLE_NOT_FOUND|INVALID_PERMISSIONS/i.test(errMsg);

      warn('Airtable error', { table, status: attempt.status, err: attempt.data });
      last = attempt;
      if (!retriable) break;
    }

    return res.status(last.status).json(last.data);
  } catch (e) {
    err('unexpected error', e);
    return res.status(502).json({ error: 'Upstream error', details: String(e?.message || e) });
  }
}

/* ───────── helpers ───────── */

function safeSlice(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

function sendCORS(req, res) {
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*').split(',').map(s => s.trim()).filter(Boolean);
  const allowed = list.includes('*') || (!origin) || list.some(p => safeWildcardMatch(origin, p));
  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') return res.status(204).end();
}

function safeWildcardMatch(input, pattern) {
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input);
}
function escapeRegex(str){ return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

function assertEnv({ pat, baseId }) {
  if (!pat)   throw new Error('AIRTABLE_PAT missing');
  if (!baseId)throw new Error('AIRTABLE_BASE_ID missing');
}

async function readJson(req) {
  let raw=''; for await (const c of req) raw+=c;
  try{ return JSON.parse(raw||'{}'); }catch{ return {}; }
}

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
    gls:'GLS', dpd:'DPD',
    poste:'Poste', posteitaliane:'Poste',
    altro:'Altro', other:'Altro'
  };
  return map[k] || s;
}

/** Normalizza NOMI CAMPO lato server (incluso "e-DAS" → "Allegato 3") */
function normalizeFieldKey(key) {
  const raw = String(key || '');

  // normalizzazione forte per e-DAS (qualsiasi combinazione di caratteri/dash/underscore)
  const edasRx = /^e[\s_\-]*d[\s_\-]*a[\s_\-]*s$/i;
  if (edasRx.test(raw)) return 'Allegato 3';

  // alias tipici
  const clean = raw.trim();
  if (clean === 'LDV' || /Lettera\s*di\s*Vettura/i.test(clean)) return 'Allegato LDV';
  if (/^Fattura$/i.test(clean) || /Fattura\s*Commerciale/i.test(clean)) return 'Allegato Fattura';
  if (/^DLE$/i.test(clean) || /Dichiarazione\s*Esportazione/i.test(clean)) return 'Allegato DLE';
  if (/^PL$/i.test(clean)  || /Packing\s*List/i.test(clean)) return 'Allegato PL';

  // normalizza "Allegato1/2/3" → "Allegato 1/2/3"
  const allegatoRx = /^Allegato\s*([123])$/i;
  const m = clean.match(allegatoRx) || clean.replace(/\s+/g,'').match(/^Allegato([123])$/i);
  if (m) return `Allegato ${m[1]}`;

  return clean;
}

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

function resolveTablesInOrder() {
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  return uniq([
    process.env.TB_SPEDIZIONI_WEBAPP,            // "SpedizioniWebApp"
    process.env.TB_SPEDIZIONI,                   // legacy esplicita
    process.env.AIRTABLE_TABLE,                  // var generica
    process.env.USE_NEW_SHIPMENTS_TABLE ? 'SpedizioniWebApp' : null,
    'SpedizioniWebApp',
    'SPEDIZIONI'
  ]);
}

function mapDocsToAirtable(docs){
  const out = {};
  if (!docs || typeof docs !== 'object') return out;

  const LEGACY_ATT = {
    'Lettera_di_Vettura': 'Lettera di Vettura',
    'Fattura_Proforma': 'Fattura Proforma',
    'Dichiarazione_Esportazione': 'Dichiarazione Esportazione',
    'Packing_List': 'Packing List',
    'FDA_Prior_Notice': 'Prior Notice'
  };
  const LEGACY_LINKS = {
    'Fattura_Commerciale': 'Fattura Commerciale Caricata',
    'Fattura_Proforma_Caricata': 'Fattura Proforma Caricata'
  };

  const NEW_ATT = {
    'LDV': 'Allegato LDV',
    'Fattura': 'Allegato Fattura',
    'DLE': 'Allegato DLE',
    'PL': 'Allegato PL',
    'Allegato1': 'Allegato 1',
    'Allegato2': 'Allegato 2',
    'Allegato3': 'Allegato 3',
  };

  const NEW_CLIENT = {
    'Fattura_Client': 'Fattura - Allegato Cliente',
    'Packing_Client': 'Packing List - Allegato Cliente',
  };

  for (const [k, url] of Object.entries(docs)) {
    if (!url) continue;
    if (NEW_ATT[k]) out[NEW_ATT[k]] = [{ url: String(url) }];
    else if (NEW_CLIENT[k]) out[NEW_CLIENT[k]] = [{ url: String(url) }];
    else if (LEGACY_ATT[k]) out[LEGACY_ATT[k]] = [{ url: String(url) }];
    else if (LEGACY_LINKS[k]) out[LEGACY_LINKS[k]] = String(url);
    // varianti e-DAS che arrivassero in docs → Allegato 3
    else if (/^e[\s_\-]*d[\s_\-]*a[\s_\-]*s$/i.test(k)) out['Allegato 3'] = [{ url: String(url) }];
  }
  return out;
}
