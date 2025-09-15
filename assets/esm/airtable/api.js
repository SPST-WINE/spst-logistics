// assets/esm/airtable/api.js

// Top of file
const __BUILD__ = '2025-09-15T15:xx v3'; // cambia testo a piacere
console.log('[BO] Loaded', import.meta.url, __BUILD__);

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

  const { carrier, tracking, statoEvasa, docs, fields, ...rest } = payload || {};
  const normCarrier = normalizeCarrier(carrier || '');

  const base = {};
  if (tracking) base.tracking = String(tracking).trim();
  if (typeof statoEvasa === 'boolean') base.statoEvasa = statoEvasa;
  if (docs && typeof docs === 'object') base.docs = docs;
  if (fields && typeof fields === 'object') base.fields = { ...fields };

  // Se arriva un tracking e NON stiamo già settando lo Stato, forza "In transito"
  if (base.tracking && !(base.fields && ('Stato' in base.fields))) {
    base.fields = { ...(base.fields || {}), 'Stato': 'In transito' };
  }

  // Porta eventuali chiavi top-level sconosciute in fields
  const KNOWN = new Set(['carrier','tracking','statoEvasa','docs','fields']);
  const unknownKeys = Object.keys(rest || {}).filter(k => !KNOWN.has(k));
  if (unknownKeys.length) {
    base.fields = base.fields || {};
    for (const k of unknownKeys) {
      base.fields[k] = rest[k];
    }
  }

  // NORMALIZZAZIONE FINALE DELLE CHIAVI PRIMA DELL’INVIO
  // - Qualsiasi variante di e-DAS → "Allegato 3"
  // - Alias tipici (LDV/Fattura/DLE/PL, Allegato1/2/3 → con spazio)
  const outFields = {};
  const edasRx = /^e[\s_\-]*d[\s_\-]*a[\s_\-]*s$/i;
  for (const [k, v] of Object.entries(base.fields || {})) {
    let key = String(k || '').trim();

    if (edasRx.test(key)) {
      key = 'Allegato 3';
    } else if (key === 'LDV' || /Lettera\s*di\s*Vettura/i.test(key)) {
      key = 'Allegato LDV';
    } else if (/^Fattura$/i.test(key) || /Fattura\s*Commerciale/i.test(key)) {
      key = 'Allegato Fattura';
    } else if (/^DLE$/i.test(key) || /Dichiarazione\s*Esportazione/i.test(key)) {
      key = 'Allegato DLE';
    } else if (/^PL$/i.test(key) || /Packing\s*List/i.test(key)) {
      key = 'Allegato PL';
    } else {
      const m = key.replace(/\s+/g,'').match(/^Allegato([123])$/i);
      if (m) key = `Allegato ${m[1]}`;
    }

    outFields[key] = v;
  }
  if (Object.keys(outFields).length) base.fields = outFields;

  if (!('tracking' in base) && !('statoEvasa' in base) && !('docs' in base) && !('fields' in base)) {
    throw new Error('PATCH failed (client): no fields to update');
  }

  const attempts = [];
  if (normCarrier) attempts.push({ carrier: normCarrier });
  if (normCarrier) attempts.push({ carrier: { name: normCarrier } });
  attempts.push({}); // anche senza carrier

  let lastErrTxt = '';
  for (const extra of attempts) {
    const body = { ...base, ...extra };
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();

      const txt = await res.text();
      lastErrTxt = txt;
      if (!/INVALID_VALUE_FOR_COLUMN|Cannot parse value for field Corriere/i.test(txt)) {
        throw new Error('PATCH failed ' + res.status + ': ' + txt);
      }
    } catch (e) {
      lastErrTxt = String(e?.message || e || '');
      if (!/INVALID_VALUE_FOR_COLUMN|Cannot parse value for field Corriere/i.test(lastErrTxt)) throw e;
    }
  }
  throw new Error('PATCH failed (tentativi esauriti): ' + lastErrTxt);
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
