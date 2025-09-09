// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS } from '../config.js';
import { showBanner } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

/* ──────────────────────────────────────────────────────────────
   Mappa Documenti: UI key → Campo Airtable (NUOVA BASE)
   ────────────────────────────────────────────────────────────── */
export const DOC_FIELD_MAP = {
  Lettera_di_Vettura:         'Allegato LDV',
  Fattura_Commerciale:        'Allegato Fattura',
  Fattura_Proforma:           'Fattura Proforma',
  Dichiarazione_Esportazione: 'Allegato DLE',
  Packing_List:               'Allegato PL',
  FDA_Prior_Notice:           'Prior Notice',
  // opzionali (cliente)
  Fattura_Client:             'Fattura - Allegato Cliente',
  Packing_Client:             'Packing List - Allegato Cliente',
};

// utile anche altrove se dovesse servire
export function docFieldFor(docKey){
  return DOC_FIELD_MAP[docKey] || docKey.replaceAll('_', ' ');
}

function buildFilterQuery({ q = '', onlyOpen = false } = {}) {
  const u = new URLSearchParams();
  if (q) u.set('search', q);
  u.set('onlyOpen', onlyOpen ? '1' : '0');
  u.set('pageSize', '50');
  return u.toString();
}

/* ──────────────────────────────────────────────────────────────
   LISTA SPEDIZIONI
   ────────────────────────────────────────────────────────────── */
export async function fetchShipments({ q = '', onlyOpen = false } = {}) {
  if (!USE_PROXY){ console.warn('USE_PROXY=false – uso MOCK'); return []; }
  const url = `${AIRTABLE.proxyBase}/spedizioni?${buildFilterQuery({ q: q.trim(), onlyOpen })}`;
  try{
    const res = await fetch(url, FETCH_OPTS);
    if(!res.ok){
      const text = await res.text().catch(()=> '');
      throw new Error(`Proxy ${res.status}: ${text.slice(0,180)}`);
    }
    const json = await res.json();
    const records = Array.isArray(json.records) ? json.records : [];
    showBanner('');
    return records; // normalizzazione la fa render.js
  }catch(err){
    console.error('[fetchShipments] failed', { url, err });
    showBanner(
      `Impossibile raggiungere il proxy API (<code>${AIRTABLE.proxyBase}</code>). ` +
      `<span class="small">Dettagli: ${String(err.message||err)}</span>`
    );
    return [];
  }
}

/* ──────────────────────────────────────────────────────────────
   PATCH SPEDIZIONE (tracking / stato / allegati)
   - Costruiamo SEMPRE { fields } con i nomi NUOVI
   ────────────────────────────────────────────────────────────── */
export async function patchShipmentTracking(recOrId, patch = {}){
  const id =
    (typeof recOrId === 'string') ? recOrId
    : (recOrId ? (recOrId._airId || recOrId._recId || recOrId.recordId || recOrId.id) : '');
  if(!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;
  const fields = {};

  // Tracking
  if (patch.carrier){
    const norm = normalizeCarrier(patch.carrier || '');
    if (norm) fields['Corriere'] = norm;
  }
  if (patch.tracking){
    fields['Tracking Number'] = String(patch.tracking).trim();
  }

  // Stato (se serve)
  if (typeof patch.statoEvasa === 'boolean'){
    fields['Stato'] = patch.statoEvasa ? 'Evasa' : 'Nuova';
  }

  // Documenti → mappa diretta NUOVA BASE
  if (patch.docs && typeof patch.docs === 'object'){
    for (const [uiKey, value] of Object.entries(patch.docs)){
      const fieldName = DOC_FIELD_MAP[uiKey];
      if (!fieldName){
        console.warn('[patchShipmentTracking] doc senza mapping:', uiKey);
        continue;
      }
      const att =
        typeof value === 'string' ? [{ url: value }] :
        (Array.isArray(value) ? value : []);
      if (!att.length) continue;
      fields[fieldName] = att;
    }
  }

  // Pass-through opzionale: { fields: {...} } già risolto a monte
  if (patch.fields && typeof patch.fields === 'object'){
    Object.assign(fields, patch.fields);
  }

  if (!Object.keys(fields).length){
    console.debug('[patchShipmentTracking] nessun campo mappato. Input:', patch);
    throw new Error('PATCH failed (client): no fields to update');
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ fields })
  });

  if (res.ok) return res.json();

  const txt = await res.text().catch(()=> '');
  throw new Error(`PATCH failed ${res.status}: ${txt || res.statusText}`);
}

/* ──────────────────────────────────────────────────────────────
   UPLOAD allegato (→ URL pubblica)
   ────────────────────────────────────────────────────────────── */
export async function uploadAttachment(recordId, docKey, file){
  if(!USE_PROXY){
    return { url: `https://files.dev/mock/${recordId}-${docKey}-${Date.now()}-${file?.name||'file'}` };
  }
  const safe = (s)=> String(s||'').replace(/[^\w.\-]+/g,'_');
  const filename = `${safe(recordId)}__${safe(docKey)}__${Date.now()}__${safe(file?.name||'file')}`;
  const url = `${AIRTABLE.proxyBase}/upload?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(file?.type || 'application/octet-stream')}`;

  const res = await fetch(url, { method: 'POST', headers: { 'Accept':'application/json' }, body: file });
  if (!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`Upload proxy ${res.status}: ${t.slice(0,180)}`);
  }
  const json = await res.json().catch(()=> ({}));
  if (!json || !json.url) throw new Error('Upload: URL non ricevuta dal proxy');
  return { url: json.url };
}

/* ──────────────────────────────────────────────────────────────
   COLLI per spedizione
   ────────────────────────────────────────────────────────────── */
export async function fetchColliFor(recordId){
  try{
    if(!recordId) return [];
    const base = AIRTABLE?.proxyBase || '';
    if(!base){
      console.warn('[fetchColliFor] proxyBase mancante, ritorno []');
      return [];
    }
    const url = `${base}/spedizioni/${encodeURIComponent(recordId)}/colli`;

    const res = await fetch(url, FETCH_OPTS);
    if(!res.ok){
      const t = await res.text().catch(()=> '');
      console.warn('[fetchColliFor] HTTP', res.status, t.slice(0,180));
      return [];
    }

    const json = await res.json().catch(()=> ({}));
    const rows = Array.isArray(json?.rows) ? json.rows : (Array.isArray(json) ? json : []);
    const toNum = (v)=> (v==null||v==='') ? null : Number(String(v).replace(',','.')) || null;

    const out = [];
    for (const r of rows){
      const L = toNum(r.lunghezza_cm ?? r.L ?? r.l1_cm);
      const W = toNum(r.larghezza_cm ?? r.W ?? r.l2_cm);
      const H = toNum(r.altezza_cm   ?? r.H ?? r.l3_cm);
      const kg= toNum(r.peso_kg      ?? r.kg ?? r.Peso ?? r['Peso (kg)']) || 0;
      const q = Math.max(1, Number(r.quantita ?? r.qty ?? r.Quantita ?? 1));
      for (let i=0;i<q;i++){
        out.push({ L: L ?? '-', W: W ?? '-', H: H ?? '-', kg });
      }
    }
    return out;
  }catch(e){
    console.warn('[fetchColliFor] errore', e);
    return [];
  }
}
