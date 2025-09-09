// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS } from '../config.js';
import { showBanner } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

/* ───────── Doc mapping UI → Airtable fields ─────────
   Campi attachment in “SpedizioniWebApp”:
   - Fattura - Allegato Cliente
   - Packing List - Allegato Cliente
   - Allegato LDV
   - Allegato Fattura
   - Allegato DLE
   - Allegato PL
   - Allegato 1
   - Allegato 2
   - Allegato 3
*/
export const DOC_FIELD_MAP = {
  // principali
  Lettera_di_Vettura: 'Allegato LDV',
  Fattura_Commerciale: 'Allegato Fattura',
  Fattura_Proforma: 'Allegato 1',
  Packing_List: 'Allegato PL',
  Dichiarazione_Esportazione: 'Allegato DLE',
  FDA_Prior_Notice: 'Allegato 2',
  'e-DAS': 'Allegato 1',

  // allegati cliente (valgono come “ok” in checklist)
  Fattura_Client: 'Fattura - Allegato Cliente',
  Packing_Client: 'Packing List - Allegato Cliente',
};

export function docFieldFor(docKey) {
  return DOC_FIELD_MAP[docKey] || docKey.replaceAll('_', ' ');
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
  if (!USE_PROXY) { console.warn('USE_PROXY=false – uso MOCK'); return []; }
  const url = `${AIRTABLE.proxyBase}/spedizioni?${buildFilterQuery({ q: q.trim(), onlyOpen })}`;
  try {
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
    console.error('[fetchShipments] failed', { url, err });
    showBanner(
      `Impossibile raggiungere il proxy API (<code>${AIRTABLE.proxyBase}</code>). ` +
      `<span class="small">Dettagli: ${String(err.message||err)}</span>`
    );
    return [];
  }
}

/* ───────── PATCH “tollerante” ───────── */
export async function patchShipmentTracking(recOrId, payload = {}) {
  const id = (typeof recOrId === 'string')
    ? recOrId
    : (recOrId ? (recOrId._airId || recOrId._recId || recOrId.recordId || recOrId.id) : '');
  if (!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;

  const { carrier, tracking, statoEvasa, docs, fields, ...rest } = payload || {};
  const norm = normalizeCarrier(carrier || '');

  const base = {};
  if (tracking) base.tracking = String(tracking).trim();
  if (typeof statoEvasa === 'boolean') base.statoEvasa = statoEvasa;
  if (docs && typeof docs === 'object') base.docs = docs;
  if (fields && typeof fields === 'object') base.fields = fields;

  // sposta chiavi “sconosciute” (es. "Allegato Fattura") dentro fields
  const KNOWN = new Set(['carrier','tracking','statoEvasa','docs','fields']);
  const unknownKeys = Object.keys(rest || {}).filter(k => !KNOWN.has(k));
  if (unknownKeys.length) {
    base.fields = base.fields || {};
    for (const k of unknownKeys) base.fields[k] = rest[k];
  }

  if (!('tracking' in base) && !('statoEvasa' in base) && !('docs' in base) && !('fields' in base)) {
    throw new Error('PATCH failed (client): no fields to update');
  }

  const attempts = [];
  if (norm) attempts.push({ carrier: norm });
  if (norm) attempts.push({ carrier: { name: norm } });
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

/* ✔️ wrapper comodo per allegati: mappa docKey → campo Airtable e patcha */
export async function patchDocAttachment(recordId, docKey, attachmentsArray) {
  const fieldName = docFieldFor(docKey);
  const att = Array.isArray(attachmentsArray) && attachmentsArray.length
    ? attachmentsArray
    : [];
  if (!att.length) throw new Error('patchDocAttachment: attachmentsArray vuoto');
  return patchShipmentTracking(recordId, { [fieldName]: att });
}

/* ───────── Upload verso Vercel Blob ───────── */
export async function uploadAttachment(recordId, docKey, file) {
  if (!USE_PROXY) {
    const url = `https://files.dev/mock/${recordId}-${docKey}-${Date.now()}-${file?.name||'file'}`;
    return { url, attachments: [{ url }] };
  }

  const safe = (s) => String(s || '').replace(/[^\w.\-]+/g, '_');
  const filename = `${safe(recordId)}__${safe(docKey)}__${Date.now()}__${safe(file?.name || 'file')}`;
  const url = `${AIRTABLE.proxyBase}/upload?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(file?.type || 'application/octet-stream')}`;

  const res = await fetch(url, { method: 'POST', headers: { 'Accept': 'application/json' }, body: file });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upload proxy ${res.status}: ${t.slice(0,180)}`);
  }
  const json = await res.json().catch(() => ({}));
  if (!json || !json.url) throw new Error('Upload: URL non ricevuta dal proxy');
  const attachments = Array.isArray(json.attachments) && json.attachments.length ? json.attachments : [{ url: json.url }];
  return { url: json.url, attachments };
}

/* ───────── Colli per spedizione ───────── */
export async function fetchColliFor(recordId) {
  try {
    if (!recordId) return [];
    const base = AIRTABLE?.proxyBase || '';
    if (!base) return [];
    const url = `${base}/spedizioni/${encodeURIComponent(recordId)}/colli`;

    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) return [];

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
    console.warn('[fetchColliFor] errore', e);
    return [];
  }
}
