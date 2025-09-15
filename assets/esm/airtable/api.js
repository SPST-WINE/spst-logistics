// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS, DEBUG } from '../config.js';
import { showBanner } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

/* ───────── utils log ───────── */
const dlog  = (...a) => { if (DEBUG) console.log('[API]', ...a); };
const dwarn = (...a) => { if (DEBUG) console.warn('[API]', ...a); };
const derr  = (...a) => console.error('[API]', ...a);
const setDebugProbe = (k, v) => {
  try { if (typeof window !== 'undefined') { window[k] = v; } } catch {}
};

/* ───────── Normalizzazione robusta chiavi documento ───────── */
function normalizeDocKey(raw) {
  const s = String(raw || '')
    .normalize('NFKD')
    .replace(/[\u2010-\u2015\-_\s]+/g, '') // unifica dash/underscore/spazi
    .replace(/[^a-zA-Z0-9]/g, '')          // rimuovi simboli
    .toLowerCase();
  return s; // "e-DAS" → "edas", "Fattura_Commerciale" → "fatturacommerciale"
}

/* Mappa normalizzata → campo Airtable */
const DOC_FIELD_MAP_NORM = {
  letteradivettura: 'Allegato LDV',
  fatturacommerciale: 'Allegato Fattura',
  dichiarazioneesportazione: 'Allegato DLE',
  packinglist: 'Allegato PL',
  fatturaclient: 'Fattura - Allegato Cliente',
  packingclient: 'Packing List - Allegato Cliente',
  // e-DAS (tutte le varianti) → Allegato 3
  edas: 'Allegato 3',
};

export function docFieldFor(docKey) {
  const norm = normalizeDocKey(docKey);
  const mapped = DOC_FIELD_MAP_NORM[norm] || String(docKey || '').replaceAll('_', ' ');
  if (DEBUG) dlog('docFieldFor:', { docKey, norm, mapped });
  return mapped;
}

/* ───────── Query & Fetch ───────── */

export function buildFilterQuery({ q = '', onlyOpen = false } = {}) {
  const u = new URLSearchParams();
  if (q) u.set('search', q);
  u.set('onlyOpen', onlyOpen ? '1' : '0');
  u.set('pageSize', '50');
  return u.toString();
}

export async function fetchShipments({ q = '', onlyOpen = false } = {}) {
  if (!USE_PROXY) { dwarn('USE_PROXY=false – uso MOCK'); return []; }
  const url = `${AIRTABLE.proxyBase}/spedizioni?${buildFilterQuery({ q: q.trim(), onlyOpen })}`;
  try {
    dlog('GET', url);
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Proxy ${res.status}: ${text.slice(0,180)}`);
    }
    const json = await res.json();
    const records = Array.isArray(json.records) ? json.records : [];
    showBanner('');
    return records;
  } catch (err) {
    derr('[fetchShipments] failed', { url, err });
    showBanner(`Impossibile raggiungere il proxy API (<code>${AIRTABLE.proxyBase}</code>). <span class="small">Dettagli: ${String(err.message||err)}</span>`);
    return [];
  }
}

/* ───────── Fetch singolo record (robusto) ───────── */
export async function fetchShipmentById(recordId) {
  if (!USE_PROXY || !recordId) return null;
  const base = AIRTABLE.proxyBase;

  try {
    const url = `${base}/spedizioni/${encodeURIComponent(recordId)}`;
    dlog('GET', url);
    const res = await fetch(url, FETCH_OPTS);
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      if (json && (json.id || json.fields)) return json;
      if (Array.isArray(json?.records)) {
        const m = json.records.find(r => r.id === recordId) || json.records[0];
        if (m) return m;
      }
    } else if (res.status !== 405 && res.status !== 404) {
      const t = await res.text().catch(() => '');
      dwarn('[fetchShipmentById] direct failed', res.status, t.slice(0, 180));
    }
  } catch (e) {
    dwarn('[fetchShipmentById] direct threw', e);
  }

  try {
    const url = `${base}/spedizioni?${new URLSearchParams({ search: recordId, pageSize: '5' })}`;
    dlog('GET', url);
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      dwarn('[fetchShipmentById] search failed', res.status, t.slice(0, 180));
      return null;
    }
    const json = await res.json().catch(() => ({}));
    const records = Array.isArray(json.records) ? json.records : [];
    return records.find(r => r.id === recordId) || records[0] || null;
  } catch (e) {
    dwarn('[fetchShipmentById] search threw', e);
    return null;
  }
}

/* ───────── PATCH “tollerante” ─────────
   Accetta:
   - { carrier, tracking }
   - { statoEvasa: true }
   - { fields: { "Allegato Fattura": [{url}] } }
   - { "Allegato Fattura": [{url}] }  ← le chiavi “sconosciute” vanno in fields
*/
export async function patchShipmentTracking(recOrId, payload = {}) {
  const id = (typeof recOrId === 'string') ? recOrId :
             (recOrId ? (recOrId._airId || recOrId._recId || recOrId.recordId || recOrId.id) : '');
  if (!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;

  // snapshot originale per debug
  const originalPayload = JSON.parse(JSON.stringify(payload || {}));

  const { carrier, tracking, statoEvasa, docs, fields, ...rest } = payload || {};
  const normCarrier = normalizeCarrier(carrier || '');

  const base = {};
  if (tracking) base.tracking = String(tracking).trim();
  if (typeof statoEvasa === 'boolean') base.statoEvasa = statoEvasa;
  if (docs && typeof docs === 'object') base.docs = docs;
  if (fields && typeof fields === 'object') base.fields = fields;

  // Se arriva un tracking e NON stiamo già settando lo Stato, forza "In transito"
  if (base.tracking && !(base.fields && ('Stato' in base.fields))) {
    base.fields = { ...(base.fields || {}), 'Stato': 'In transito' };
  }

  // porta eventuali chiavi top-level sconosciute in fields (es. "e-DAS", "Allegato Fattura")
  const KNOWN = new Set(['carrier','tracking','statoEvasa','docs','fields']);
  const unknownKeys = Object.keys(rest || {}).filter(k => !KNOWN.has(k));

  const aliasApplied = [];
  if (unknownKeys.length) {
    base.fields = base.fields || {};
    for (const k of unknownKeys) {
      const mapped = docFieldFor(k); // usa normalizzazione robusta (e-DAS → Allegato 3)
      base.fields[mapped] = rest[k];
      aliasApplied.push({ from: k, to: mapped });
    }
  }

  if (!('tracking' in base) && !('statoEvasa' in base) && !('docs' in base) && !('fields' in base)) {
    throw new Error('PATCH failed (client): no fields to update');
  }

  const attempts = [];
  if (normCarrier) attempts.push({ carrier: normCarrier });
  if (normCarrier) attempts.push({ carrier: { name: normCarrier } });
  attempts.push({}); // anche senza carrier

  let lastErrTxt = '';
  let lastStatus = 0;

  for (const extra of attempts) {
    const body = { ...base, ...extra };
    // probe per debug in console
    setDebugProbe('__LAST_PATCH_ATTEMPT__', { url, id, originalPayload, aliasApplied, attemptBody: body });

    try {
      if (DEBUG) dlog('PATCH', url, { id, aliasApplied, body });
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      lastStatus = res.status;

      if (res.ok) {
        const json = await res.json().catch(() => ({}));
        setDebugProbe('__LAST_PATCH_RESULT__', { ok: true, status: res.status, json });
        if (DEBUG) dlog('PATCH OK', { status: res.status, json });
        return json;
      }

      const txt = await res.text();
      lastErrTxt = txt;
      setDebugProbe('__LAST_PATCH_RESULT__', { ok: false, status: res.status, text: txt });
      dwarn('PATCH not ok', { status: res.status, text: txt.slice(0, 300) });

      if (!/INVALID_VALUE_FOR_COLUMN|Cannot parse value for field Corriere/i.test(txt)) {
        throw new Error('PATCH failed ' + res.status + ': ' + txt);
      }
    } catch (e) {
      lastErrTxt = String(e?.message || e || '');
      setDebugProbe('__LAST_PATCH_RESULT__', { ok: false, status: lastStatus || 'n/a', error: lastErrTxt });
      if (!/INVALID_VALUE_FOR_COLUMN|Cannot parse value for field Corriere/i.test(lastErrTxt)) {
        derr('PATCH exception', lastErrTxt);
        throw e;
      }
    }
  }

  const errMsg = 'PATCH failed (tentativi esauriti): ' + lastErrTxt;
  derr(errMsg);
  throw new Error(errMsg);
}

/* ───────── Upload → Vercel Blob (CORS lato server) ───────── */
export async function uploadAttachment(recordId, docKey, file) {
  if (!USE_PROXY) {
    const url = `https://files.dev/mock/${recordId}-${docKey}-${Date.now()}-${file?.name||'file'}`;
    return { url, attachments: [{ url }] };
  }

  const safe = (s) => String(s || '').replace(/[^\w.\-]+/g, '_');
  const filename = `${safe(recordId)}__${safe(docKey)}__${Date.now()}__${safe(file?.name || 'file')}`;
  const url = `${AIRTABLE.proxyBase}/upload?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(file?.type || 'application/octet-stream')}`;

  dlog('UPLOAD →', { url, filename, type: file?.type, size: file?.size });
  const res = await fetch(url, { method: 'POST', headers: { 'Accept': 'application/json' }, body: file });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    derr('Upload proxy error', res.status, t.slice(0,180));
    throw new Error(`Upload proxy ${res.status}: ${t.slice(0,180)}`);
  }
  const json = await res.json().catch(() => ({}));
  if (!json || !json.url) throw new Error('Upload: URL non ricevuta dal proxy');
  const attachments = Array.isArray(json.attachments) && json.attachments.length ? json.attachments : [{ url: json.url }];
  dlog('UPLOAD OK', { url: json.url, n: attachments.length });
  return { url: json.url, attachments };
}

/* ───────── Colli ───────── */
export async function fetchColliFor(recordId) {
  try {
    if (!recordId) return [];
    const base = AIRTABLE?.proxyBase || '';
    if (!base) return [];
    const url = `${base}/spedizioni/${encodeURIComponent(recordId)}/colli`;

    dlog('GET colli', url);
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) { return []; }

    const json = await res.json().catch(() => ({}));
    const rows = Array.isArray(json?.rows) ? json.rows : (Array.isArray(json) ? json : []);
    const toNum = (v) => (v==null||v==='') ? null : Number(String(v).replace(',','.')) || null;

    const out = [];
    for (const r of rows) {
      const L = toNum(r.lunghezza_cm ?? r.L ?? r.l1_cm);
      const W = toNum(r.larghezza_cm ?? r.W ?? r.l2_cm);
      const H = toNum(r.altezza_cm   ?? r.H ?? r.l3_cm);
      const kg= toNum(r.peso_kg      ?? r.kg ?? r.Peso ?? r['Peso (kg)']) || 0;
      const q = Math.max(1, Number(r.quantita ?? r.qty ?? r.Quantita ?? 1));
      for (let i = 0; i < q; i++) out.push({ L: L ?? '-', W: W ?? '-', H: H ?? '-', kg });
    }
    return out;
  } catch (e) {
    dwarn('[fetchColliFor] errore', e);
    return [];
  }
}

/* ───────── Logica documenti “extra” → Allegato 1/2/3 ───────── */
const PRIMARY_FIELDS = new Set(['Allegato LDV', 'Allegato Fattura', 'Allegato DLE', 'Allegato PL']);
const EXTRA_SLOTS = ['Allegato 1', 'Allegato 2', 'Allegato 3'];

export async function patchDocAttachment(recordId, docKey, attachments, rawFields = null) {
  if (!recordId) throw new Error('Missing record id');
  const mapped = docFieldFor(docKey);
  dlog('patchDocAttachment:', { recordId, docKey, mapped, rawFieldsPresent: !!rawFields });

  // Se il mapping forza uno slot extra esplicito → patch diretto su quello
  if (EXTRA_SLOTS.includes(mapped)) {
    const existing = Array.isArray(rawFields?.[mapped]) ? rawFields[mapped] : [];
    const next = [...existing, ...attachments];
    dlog('→ direct slot', { slot: mapped, existing: existing.length, add: attachments.length, total: next.length });
    return patchShipmentTracking(recordId, { fields: { [mapped]: next } });
  }

  // Documenti principali → campo dedicato
  if (PRIMARY_FIELDS.has(mapped)) {
    dlog('→ primary field', { field: mapped, add: attachments.length });
    return patchShipmentTracking(recordId, { fields: { [mapped]: attachments } });
  }

  // Documenti “extra” non mappati → scegli A1/A2/A3
  let chosen = null;
  let existing = [];

  if (rawFields) {
    for (const slot of EXTRA_SLOTS) {
      const cur = Array.isArray(rawFields[slot]) ? rawFields[slot] : [];
      if (!cur.length) { chosen = slot; existing = []; break; }
    }
    if (!chosen) {
      chosen = 'Allegato 3'; // fallback append
      existing = Array.isArray(rawFields[chosen]) ? rawFields[chosen] : [];
    }
  } else {
    chosen = 'Allegato 1';
    existing = [];
  }

  const next = [...existing, ...attachments];
  dlog('→ chosen slot', { slot: chosen, prev: existing.length, add: attachments.length, total: next.length });
  return patchShipmentTracking(recordId, { fields: { [chosen]: next } });
}

/* ───────── notify ───────── */
function notifyBaseFromAirtableBase() {
  const b = (typeof AIRTABLE?.proxyBase === 'string') ? AIRTABLE.proxyBase : '';
  return b.replace('/api/airtable', '/api/notify');
}

export async function sendTransitEmail(recordId, to){
  const base = notifyBaseFromAirtableBase() || '';
  const url  = `${base}/transit`;
  dlog('POST notify', { url, recordId, to });
  const res = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json','Accept':'application/json' },
    body: JSON.stringify({ recordId, to })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=> '');
    derr('Notify error', res.status, t.slice(0,180));
    throw new Error(`Notify ${res.status}: ${t.slice(0,180)}`);
  }
  const j = await res.json().catch(()=> ({}));
  dlog('Notify OK', j);
  return j;
}
