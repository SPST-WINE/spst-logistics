// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS } from '../config.js';
import { showBanner } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

/* ──────────────────────────────────────────────────────────────
   Mappa doc UI -> nome campo Airtable (allegati)
   ────────────────────────────────────────────────────────────── */
const DOC_FIELD_MAP = {
  Lettera_di_Vettura: 'Allegato LDV',
  Fattura_Commerciale: 'Allegato Fattura',
  Fattura_Proforma: 'Fattura Proforma',
  Dichiarazione_Esportazione: 'Allegato DLE',
  Packing_List: 'Allegato PL',
  FDA_Prior_Notice: 'Prior Notice',
  // allegati caricati dal cliente (se presenti in base)
  Fattura_Client: 'Fattura - Allegato Cliente',
  Packing_Client: 'Packing List - Allegato Cliente',
};

function resolveDocField(docKey){
  return DOC_FIELD_MAP[docKey] || String(docKey || '').replaceAll('_',' ');
}

/* ──────────────────────────────────────────────────────────────
   Query / lista spedizioni
   ────────────────────────────────────────────────────────────── */
function buildFilterQuery({ q = '', onlyOpen = false } = {}) {
  const u = new URLSearchParams();
  if (q) u.set('search', q);
  u.set('onlyOpen', onlyOpen ? '1' : '0');
  u.set('pageSize', '50');
  return u.toString();
}

export async function fetchShipments({ q = '', onlyOpen = false } = {}) {
  if (!USE_PROXY) { console.warn('USE_PROXY=false – uso MOCK'); return []; }
  const url = `${AIRTABLE.proxyBase}/spedizioni?${buildFilterQuery({ q: q.trim(), onlyOpen })}`;
  try{
    const res = await fetch(url, FETCH_OPTS);
    if (!res.ok) throw new Error(`Proxy ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const records = Array.isArray(json.records) ? json.records : [];
    showBanner('');
    // Ritorniamo i record grezzi Airtable ({id, fields,...})
    return records;
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
   PATCH spedizione
   - accetta: carrier, tracking, stato, statoEvasa (legacy), docs:{}, fields:{}
   ────────────────────────────────────────────────────────────── */
export async function patchShipmentTracking(recOrId, patch = {}){
  const id =
    (typeof recOrId === 'string')
      ? recOrId
      : (recOrId ? (recOrId._airId || recOrId._recId || recOrId.recordId || recOrId.id) : '');

  if (!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;

  // Costruiamo SEMPRE "fields" per Airtable
  const fields = {};

  // Tracking / Corriere
  if (patch.tracking){
    fields['Tracking Number'] = String(patch.tracking).trim();
  }
  if (patch.carrier){
    const norm = normalizeCarrier(patch.carrier || '');
    if (norm) fields['Corriere'] = norm;
  }

  // Stato: valore esplicito ha precedenza
  if (patch.stato){
    fields['Stato'] = String(patch.stato);
  } else if (typeof patch.statoEvasa === 'boolean'){
    // retro-compatibilità (non usata più nel BO, ma lasciamo)
    fields['Stato'] = patch.statoEvasa ? 'Evasa' : 'Nuova';
  }

  // Allegati: docs = { UI_KEY: [ {url}, ... ] }
  if (patch.docs && typeof patch.docs === 'object'){
    for (const [docKey, attVal] of Object.entries(patch.docs)){
      const fieldName = resolveDocField(docKey);
      const attArray = Array.isArray(attVal) ? attVal : (attVal ? [attVal] : []);
      // Airtable attachment vuole [{ url, filename?, type? }, ...]
      fields[fieldName] = attArray;
    }
  }

  // Campi arbitrari (usa con cautela)
  if (patch.fields && typeof patch.fields === 'object'){
    Object.assign(fields, patch.fields);
  }

  if (!Object.keys(fields).length){
    throw new Error('PATCH failed (client): no fields to update');
  }

  const body = { fields };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`PATCH failed ${res.status}: ${t}`);
  }
  return await res.json();
}

/* ──────────────────────────────────────────────────────────────
   Upload allegato → URL pubblica (Vercel Blob lato proxy)
   ────────────────────────────────────────────────────────────── */
export async function uploadAttachment(recordId, docName, file){
  if (!USE_PROXY){
    return { url: `https://files.dev/mock/${recordId}-${docName}-${Date.now()}-${file?.name||'file'}` };
  }
  const safe = (s)=> String(s||'').replace(/[^\w.\-]+/g,'_');
  const filename = `${safe(recordId)}__${safe(docName)}__${Date.now()}__${safe(file?.name||'file')}`;
  const url = `${AIRTABLE.proxyBase}/upload?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(file?.type || 'application/octet-stream')}`;

  const res = await fetch(url, { method:'POST', headers:{ 'Accept':'application/json' }, body:file });
  if (!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`Upload proxy ${res.status}: ${t.slice(0,180)}`);
  }
  const json = await res.json().catch(()=> ({}));
  if (!json || !json.url) throw new Error('Upload: URL non ricevuta dal proxy');
  return { url: json.url };
}

/* ──────────────────────────────────────────────────────────────
   Colli per spedizione (proxy /spedizioni/:id/colli)
   ────────────────────────────────────────────────────────────── */
export async function fetchColliFor(recordId){
  try{
    if(!recordId) return [];
    const base = AIRTABLE?.proxyBase || '';
    if(!base){ console.warn('[fetchColliFor] proxyBase mancante'); return []; }
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
