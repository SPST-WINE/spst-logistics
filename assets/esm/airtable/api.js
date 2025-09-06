// assets/esm/airtable/api.js
import { AIRTABLE, USE_PROXY, FETCH_OPTS } from '../config.js';
// ⛔️ rimuoviamo l'adapter legacy: il render normalizza già i record grezzi
// import { airtableRecordToRec } from './adapter.js';
import { showBanner, toast } from '../utils/dom.js';
import { normalizeCarrier } from '../utils/misc.js';

 export function buildFilterQuery({ q = '', onlyOpen = false } = {}) {
   const u = new URLSearchParams();
   if (q) u.set('search', q);
   u.set('onlyOpen', onlyOpen ? '1' : '0');
   u.set('pageSize', '50');
   return u.toString();
}
diff
Copia codice


export async function fetchShipments({q='',status='all',onlyOpen=false}={}){
  if(!USE_PROXY){ console.warn('USE_PROXY=false – uso MOCK'); return []; }
  const url = `${AIRTABLE.proxyBase}/spedizioni?${buildFilterQuery({q: q.trim(), status, onlyOpen})}`;
  try{
    const res = await fetch(url, FETCH_OPTS);
    if(!res.ok){
      const text = await res.text().catch(()=> '');
      throw new Error(`Proxy ${res.status}: ${text.slice(0,180)}`);
    }
    const json = await res.json();
    const records = Array.isArray(json.records) ? json.records : [];
    showBanner('');
    // ✅ RITORNIAMO i record grezzi di Airtable ({id, fields, createdTime...})
    // Il normalizzatore moderno vive in assets/esm/ui/render.js
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

export async function patchShipmentTracking(recOrId, { carrier, tracking, statoEvasa, docs, fields }){
  const id = (typeof recOrId === 'string') ? recOrId : (recOrId? (recOrId._airId||recOrId._recId||recOrId.recordId||recOrId.id) : '');
  if(!id) throw new Error('Missing record id');

  const url = `${AIRTABLE.proxyBase}/spedizioni/${encodeURIComponent(id)}`;
  const norm = normalizeCarrier(carrier||'');
  const base = {};
  if (tracking) base.tracking = String(tracking).trim();
  if (typeof statoEvasa === 'boolean') base.statoEvasa = statoEvasa;
  if (docs && typeof docs === 'object') base.docs = docs;
  if (fields && typeof fields === 'object') base.fields = fields; // 👈 NEW

  const attempts = [];
  if (norm) attempts.push({ carrier: norm });
  if (norm) attempts.push({ carrier: { name: norm } });
  attempts.push({}); // senza carrier (es. solo docs/fields)

  let lastErrTxt = '';
  for (const extra of attempts){
    const body = { ...base, ...extra };
    try{
      const res = await fetch(url, {
        method:'PATCH',
        headers:{ 'Content-Type':'application/json','Accept':'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) return await res.json();
      const txt = await res.text();
      lastErrTxt = txt;
      if (!/INVALID_VALUE_FOR_COLUMN|Cannot parse value for field Corriere/i.test(txt)){
        throw new Error('PATCH failed '+res.status+': '+txt);
      }
    }catch(e){
      lastErrTxt = String(e && e.message || e || '');
      if (!/INVALID_VALUE_FOR_COLUMN|Cannot parse value for field Corriere/i.test(lastErrTxt)) throw e;
    }
  }
  throw new Error('PATCH failed (tentativi esauriti): '+lastErrTxt);
}


/**
 * Carica un file sullo storage del proxy (Vercel Blob) e ritorna una URL pubblica.
 * Poi questa URL verrà passata a Airtable come attachment.
 */
export async function uploadAttachment(recordId, docName, file){
  if(!USE_PROXY){ // fallback mock
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
