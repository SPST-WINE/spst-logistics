// /api/airtable/spedizioni/[id].js
// PATCH /api/airtable/spedizioni/:id
// Body accettati:
//   { fields:{...} }
//   { carrier, tracking, stato, statoEvasa, docs:{ chiaveUI:url } }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const id = (req.query.id || req.query.slug || '').toString();
    if (!id) return res.status(400).json({ error: 'Missing record id' });

    const pat = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    assertEnv({ pat, baseId });

    const bodyRaw = await readJson(req);
    const fields = { ...(bodyRaw.fields || {}) };

    // ---- Tracking number ----
    if (typeof bodyRaw.tracking === 'string' && bodyRaw.tracking.trim()) {
      fields['Tracking Number'] = bodyRaw.tracking.trim();
    }

    // ---- Corriere ----
    const rawCarrier = (typeof bodyRaw.carrier !== 'undefined') ? bodyRaw.carrier : undefined;
    if (typeof rawCarrier !== 'undefined') {
      const norm = normalizeCarrier(rawCarrier);
      if (norm) fields['Corriere'] = norm;
    }

    // ---- Stato spedizione ----
    if (typeof bodyRaw.stato === 'string' && bodyRaw.stato.trim()) {
      fields['Stato'] = bodyRaw.stato.trim();
      delete fields['Stato Spedizione'];
    } else if (typeof bodyRaw.statoEvasa === 'boolean') {
      fields['Stato'] = bodyRaw.statoEvasa ? 'Evasa' : 'Nuova';
      delete fields['Stato Spedizione'];
    }

    // ---- Documenti ----
    if (bodyRaw.docs && typeof bodyRaw.docs === 'object') {
      Object.assign(fields, mapDocsToAirtable(bodyRaw.docs));
    }

    if (!Object.keys(fields).length) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // ---------- Risoluzione tabella + retry automatico ----------
    const candidates = resolveTablesInOrder();
    let last = { status: 500, data: { error: 'No attempt' } };

    for (const table of candidates) {
      const attempt = await airtablePatch({ baseId, table, id, pat, fields });
      if (attempt.ok) {
        // risposta OK
        return res.status(attempt.status).json({ ...attempt.data, _table: table });
      }
      // errori "model not found/permissions" → prova la prossima tabella
      const errMsg = JSON.stringify(attempt.data || {});
      const retriable =
        attempt.status === 403 || attempt.status === 404 ||
        /MODEL_NOT_FOUND|NOT_FOUND|TABLE_NOT_FOUND|INVALID_PERMISSIONS/i.test(errMsg);

      console.warn('[PATCH spedizione] Airtable error', { table, status: attempt.status, id, err: attempt.data });
      last = attempt;
      if (!retriable) break;
    }

    // esci con l’ultimo errore
    return res.status(last.status).json(last.data);
  } catch (e) {
    console.error('[PATCH spedizione] unexpected error', e);
    return res.status(502).json({ error: 'Upstream error', details: String(e?.message || e) });
  }
}

/* ───────── helpers ───────── */

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
function escapeRegex(str) { return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

function assertEnv({ pat, baseId }) {
  if (!pat) throw new Error('AIRTABLE_PAT missing');
  if (!baseId) throw new Error('AIRTABLE_BASE_ID missing');
}

/** Ordine tabelle: preferisci sempre la nuova; poi legacy; poi fallback sicuri */
function resolveTablesInOrder() {
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  return uniq([
    process.env.TB_SPEDIZIONI_WEBAPP,            // es. "SpedizioniWebApp"
    process.env.TB_SPEDIZIONI,                   // eventuale legacy esplicita
    process.env.AIRTABLE_TABLE,                  // eventuale var generica
    process.env.USE_NEW_SHIPMENTS_TABLE ? 'SpedizioniWebApp' : null,
    'SpedizioniWebApp',                          // fallback di default
    'SPEDIZIONI'                                 // ultimo tentativo legacy
  ]);
}

async function readJson(req) {
  let raw = ''; for await (const c of req) raw += c;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

function normalizeCarrier(input) {
  if (input == null) return '';
  let s = input;
  if (typeof s === 'object' && s.name) s = s.name;
  s = String(s).trim();
  if (!s) return '';
  const k = s.toLowerCase().replace(/[\s-]/g, '');
  const map = {
    dhl: 'DHL', dhlexpress: 'DHL',
    fedex: 'FedEx', fedexexpress: 'FedEx', fx: 'FedEx', fedexground: 'FedEx',
    ups: 'UPS', unitedparcelservice: 'UPS',
    tnt: 'TNT', tntexpress: 'TNT',
    gls: 'GLS',
    dpd: 'DPD',
    poste: 'Poste', posteitaliane: 'Poste',
    altro: 'Altro', other: 'Altro'
  };
  return map[k] || s;
}

async function airtablePatch({ baseId, table, id, pat, fields }) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${encodeURIComponent(id)}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  return { status: r.status, ok: r.ok, data };
}

function mapDocsToAirtable(docs) {
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
  }
  return out;
}
