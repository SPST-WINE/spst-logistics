// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS } from '../config.js';
import { showBanner, toast } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

/* ──────────────────────────────────────────────────────────────
   Mappa Documenti: UI key → Campo Airtable (nuova base)
   ────────────────────────────────────────────────────────────── */

export const DOC_FIELD_MAP = {
  // Operativi SPST
  Lettera_di_Vettura:         'Allegato LDV',
  Fattura_Commerciale:        'Allegato Fattura',
  Fattura_Proforma:           'Fattura Proforma',
  Dichiarazione_Esportazione: 'Allegato DLE',
  Packing_List:               'Allegato PL',
  FDA_Prior_Notice:           'Prior Notice',
  // Allegati caricati dal cliente
  Fattura_Client:             'Fattura - Allegato Cliente',
  Packing_Client:             'Packing List - Allegato Cliente',
};

export function docFieldFor(docKey){
  return DOC_FIELD_MAP[docKey] || docKey.replaceAll('_',' ');
}

/* ──────────────────────────────────────────────────────────────
   Query spedizioni (lista)
   ────────────────────────────────────────────────────────────── */

export function buildFilterQuery({ q = '', onlyOpen = false } = {}) {
  const u = new URLSearchParams();
  if (q) u.set('search', q);
  u.set('onlyOpen', onlyOpen ? '1' : '0');
  u.set('pageSize', '50');
  return u.toString();
}

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
    // Ritorniamo i record grezzi Airtable (normalizzazione in render.js)
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
   PATCH spedizione (tracking / stato / allegati)
   Invia SEMPRE { fields } già mappati per la nuova base.
   ────────────────────────────────────────────────────────────── */

export async function patchShipmentTracking(recOrId, patch = {}){
  const id =
    (typeof recOrId === 'string') ? recOrId
    : (recOrId ? (recOrId._airId || recOrId._recId || recOrId.recordId || recOrId.id) : '');
  if(!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;

  // Costruisci i campi da inviare a Airtable
  const fields = {};

  // Tracking
  if (patch.carrier){
    const norm = normalizeCarrier(patch.carrier || '');
    if (norm) fields['Corriere'] = norm;
  }
  if (patch.tracking){
    fields['Tracking Number'] = String(patch.tracking).trim();
  }

  // Stato (interpreta statoEvasa come Evasa nella nuova base)
  if (typeof patch.statoEvasa === 'boolean'){
    fields['Stato'] = patch.statoEvasa ? 'Evasa' : 'Nuova';
  }

  // Documenti: UI key → campo Airtable (attachment)
  if (patch.docs && typeof patch.docs === 'object'){
    for (const [uiKey, value] of Object.entries(patch.docs)){
      const fieldName = docFieldFor(uiKey);
      if (!fieldName) continue;
      let attachments = value;
      if (typeof value === 'string') attachments = [{ url: value }];
      if (Array.isArray(attachments) && attachments.length){
        fields[fieldName] = attachments;
      }
    }
  }

  // Campi extra già “Airtable-ready” (facoltativi)
  if (patch.fields && typeof patch.fields === 'object'){
    Object.assign(fields, patch.fields);
  }

  if (!Object.keys(fields).length){
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
   Upload allegato → Vercel Blob → URL pubblica
   ────────────────────────────────────────────────────────────── */

export async function uploadAttachment(recordId, docName, file){
  if(!USE_PROXY){ // mock offline
    return { url: `https://files.dev/mock/${recordId}-${docName}-${Date.now()}-${file?.name||'file'}` };
  }
  const safe = (s)=> String(s||'').replace(/[^\w.\-]+/g,'_');
  const filename = `${safe(recordId)}__${safe(docName)}__${Date.now()}__${safe(file?.name||'file')}`;
  const url = `${AIRTABLE.proxyBase}/upload?filename=${encodeURIComponent(filename)}&contentType=${encodeURIComponent(file?.type || 'application/octet-stream')}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Accept':'application/json' },
    body: file
  });
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
