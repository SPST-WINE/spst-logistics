// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS } from '../config.js';
import { showBanner } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

/* ──────────────────────────────────────────────────────────────
   Mappa di base (nomi “canonici” in Airtable, già usati nel tuo base)
   ────────────────────────────────────────────────────────────── */
const DOC_FIELD_MAP = {
  Lettera_di_Vettura: 'Allegato LDV',
  Fattura_Commerciale: 'Allegato Fattura',
  Fattura_Proforma: 'Fattura Proforma',
  Dichiarazione_Esportazione: 'Allegato DLE',
  Packing_List: 'Allegato PL',
  FDA_Prior_Notice: 'Prior Notice',
  Fattura_Client: 'Fattura - Allegato Cliente',
  Packing_Client: 'Packing List - Allegato Cliente',

  // 👉 nuovo: e-DAS (il tuo Airtable probabilmente NON usa il nome secco “e-DAS”)
  'e-DAS': 'e-DAS - Allegato',
};

/* Candidati extra: se la mappa sopra non torna, proviamo questi nomi in fallback */
function candidateFieldNamesFor(docKey){
  const pretty = String(docKey || '').replaceAll('_',' ').trim(); // es. "Fattura Commerciale"
  const base = DOC_FIELD_MAP[docKey] ? [DOC_FIELD_MAP[docKey]] : [];

  // fallback euristici
  const extras = [
    pretty,
    `${pretty} - Allegato`,
    `Allegato ${pretty}`,
  ];

  // special case
  if (docKey === 'Dichiarazione_Esportazione'){
    extras.unshift('Dichiarazione Esportazione');
  }
  if (docKey === 'Packing_List'){
    extras.unshift('Packing List');
  }
  if (docKey === 'Lettera_di_Vettura'){
    extras.unshift('Lettera di Vettura', 'LDV');
  }
  if (docKey === 'Fattura_Commerciale'){
    extras.unshift('Fattura Commerciale Caricata');
  }
  if (docKey === 'e-DAS'){
    extras.unshift('Allegato e-DAS', 'e-DAS');
  }

  // de-dup
  const out = [];
  for (const n of [...base, ...extras]){
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────
   Lista spedizioni via proxy
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
    return records; // record grezzi Airtable
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
   PATCH generico (tracking, stato, docs, campi arbitrari)
   ────────────────────────────────────────────────────────────── */
export async function patchShipmentTracking(recOrId, patch = {}){
  const id =
    (typeof recOrId === 'string')
      ? recOrId
      : (recOrId ? (recOrId._airId || recOrId._recId || recOrId.recordId || recOrId.id) : '');

  if (!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;
  const fields = {};

  if (patch.tracking) fields['Tracking Number'] = String(patch.tracking).trim();
  if (patch.carrier){
    const norm = normalizeCarrier(patch.carrier || '');
    if (norm) fields['Corriere'] = norm;
  }

  if (patch.stato){
    fields['Stato'] = String(patch.stato);
  } else if (typeof patch.statoEvasa === 'boolean'){
    fields['Stato'] = patch.statoEvasa ? 'Evasa' : 'Nuova';
  }

  if (patch.docs && typeof patch.docs === 'object'){
    // questa strada resta per chiamate “multiple”; per affidabilità meglio patchDocAttachment per singolo campo
    for (const [docKey, attVal] of Object.entries(patch.docs)){
      const candidates = candidateFieldNamesFor(docKey);
      const attArray = Array.isArray(attVal) ? attVal : (attVal ? [attVal] : []);
      // prendi il primo candidato e affida agli altri tentativi in una chiamata separata
      if (candidates[0]) fields[candidates[0]] = attArray;
    }
  }

  if (patch.fields && typeof patch.fields === 'object'){
    Object.assign(fields, patch.fields);
  }

  if (!Object.keys(fields).length){
    throw new Error('PATCH failed (client): no fields to update');
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify({ fields })
  });
  if (!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`PATCH failed ${res.status}: ${t}`);
  }
  return await res.json();
}

/* Patch di UN documento con fallback su più possibili nomi colonna */
export async function patchDocAttachment(recordId, docKey, attArray){
  const candidates = candidateFieldNamesFor(docKey);
  let lastErr = null;

  for (const fieldName of candidates){
    try{
      return await patchShipmentTracking(recordId, { fields: { [fieldName]: attArray } });
    }catch(e){
      const msg = String(e?.message || '');
      // se il problema è proprio “campo inesistente”, prova il prossimo candidato
      if (/UNKNOWN_FIELD_NAME|Unknown field name/i.test(msg)) {
        lastErr = e;
        continue;
      }
      // altri errori: esci subito
      throw e;
    }
  }
  // tutti i tentativi falliti
  throw (lastErr || new Error('Nessun nome campo valido per '+docKey));
}

/* ──────────────────────────────────────────────────────────────
   Upload allegato (proxy)
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
   Colli (proxy /spedizioni/:id/colli)
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
