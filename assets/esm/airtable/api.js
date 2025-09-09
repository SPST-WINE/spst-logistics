// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS } from '../config.js';
import { showBanner } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

/* ──────────────────────────────────────────────────────────────
   Mappa Documenti: UI key → Campo Airtable (nuova base)
   ────────────────────────────────────────────────────────────── */

export const DOC_FIELD_MAP = {
  // Operativi SPST (nuovi nomi tabella SpedizioniWebApp)
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

/* Extra: per i doc principali, prova più nomi (nuovi + legacy) */
function fieldCandidatesForDoc(uiKey){
  const k = String(uiKey || '').trim();
  const legacy = k.replaceAll('_', ' ');
  const extra = {
    Lettera_di_Vettura:         ['Allegato LDV', 'Lettera di Vettura'],
    Fattura_Commerciale:        ['Allegato Fattura', 'Fattura Commerciale Caricata', 'Fattura Commerciale'],
    Fattura_Proforma:           ['Fattura Proforma'],
    Dichiarazione_Esportazione: ['Allegato DLE', 'Dichiarazione Esportazione'],
    Packing_List:               ['Allegato PL', 'Packing List'],
    FDA_Prior_Notice:           ['Prior Notice'],
  };
  const out = new Set();
  if (DOC_FIELD_MAP[k]) out.add(DOC_FIELD_MAP[k]);
  if (extra[k]) extra[k].forEach(n => out.add(n));
  out.add(legacy); // sempre anche il legacy “con spazi”
  return Array.from(out).filter(Boolean);
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
   - Costruiamo SEMPRE { fields }.
   - Se per qualche motivo non mappiamo nulla ma abbiamo docs,
     passiamo anche docs (fallback legacy).
   ────────────────────────────────────────────────────────────── */

export async function patchShipmentTracking(recOrId, patch = {}){
  const id =
    (typeof recOrId === 'string') ? recOrId
    : (recOrId ? (recOrId._airId || recOrId._recId || recOrId.recordId || recOrId.id) : '');
  if(!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;

  const fields = {};
  let hadDocs = false;

  // Tracking → campi tabella
  if (patch.carrier){
    const norm = normalizeCarrier(patch.carrier || '');
    if (norm) fields['Corriere'] = norm;
  }
  if (patch.tracking){
    fields['Tracking Number'] = String(patch.tracking).trim();
  }

  // Stato (interpreta statoEvasa come “Evasa” nella nuova base)
  if (typeof patch.statoEvasa === 'boolean'){
    fields['Stato'] = patch.statoEvasa ? 'Evasa' : 'Nuova';
  }

  // Documenti → attachment fields
  if (patch.docs && typeof patch.docs === 'object'){
    hadDocs = true;
    for (const [uiKey, value] of Object.entries(patch.docs)){
      const attachments =
        typeof value === 'string' ? [{ url: value }] :
        (Array.isArray(value) ? value : []);
      if (!attachments.length) continue;

      const candidates = fieldCandidatesForDoc(uiKey);
      candidates.forEach(fn => { fields[fn] = attachments; });
    }
  }

  // Log utile (una volta per sessione)
  if (!window.__PATCH_DOC_LOG__){
    window.__PATCH_DOC_LOG__ = true;
    if (hadDocs){
      console.debug('[patchShipmentTracking] docs IN:', Object.keys(patch.docs||{}));
      console.debug('[patchShipmentTracking] fields OUT:', Object.keys(fields));
    }
  }

  // Costruisci body: preferiamo fields; aggiungiamo docs come fallback legacy
  const body = {};
  if (Object.keys(fields).length) body.fields = fields;
  if (hadDocs) body.docs = patch.docs; // fallback per proxy legacy

  // Se davvero non c’è nulla da inviare, fermiamoci (caso anomalo)
  if (!Object.keys(body).length){
    throw new Error('PATCH failed (client): no fields to update');
  }

  const res = await fetch(url, {
    method: 'PATCH',
    headers:{ 'Content-Type':'application/json', 'Accept':'application/json' },
    body: JSON.stringify(body)
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
