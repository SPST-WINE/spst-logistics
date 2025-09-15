// assets/esm/main.js

// Top of file
const __BUILD__ = '2025-09-15T15:xx v3'; // cambia testo a piacere
console.log('[BO] Loaded', import.meta.url, __BUILD__);

import { DEBUG, AIRTABLE } from './config.js?v=3';
import {
  fetchShipments,
  patchShipmentTracking,
  uploadAttachment,
  docFieldFor,
  patchDocAttachment,
} from './airtable/api.js?v=3';
import { renderList } from './ui/render.js?v=3';
import { toast } from './utils/dom.js?v=3';
import { dateTs } from './utils/misc.js?v=3';
import './back-office-tabs.js?v=3';


const log  = (...a)=>{ if (DEBUG) console.log('[BO]', ...a); };
const warn = (...a)=>{ if (DEBUG) console.warn('[BO]', ...a); };
const err  = (...a)=> console.error('[BO]', ...a);

const elSearch   = document.getElementById('search');
const elOnlyOpen = document.getElementById('only-open');

// Base API per tutte le route del proxy Vercel (notify, airtable, docs, ecc.)
const API_BASE =
  (AIRTABLE?.proxyBase || '')
    .replace(/\/airtable\/?$/i, '')  // es. https://spst-logistics.vercel.app/api
  || 'https://spst-logistics.vercel.app/api';

let DATA = [];

/* ───────── utils ───────── */
function debounce(fn, ms = 250){
  let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}

/* ───────── data flow ───────── */
async function loadData(){
  try{
    const q = (elSearch?.value || '').trim();
    const onlyOpen = !!elOnlyOpen?.checked;
    const status = 'all';

    log('loadData', { q, onlyOpen, status, proxy: AIRTABLE?.proxyBase });
    const items = await fetchShipments({ q, status, onlyOpen });
    DATA = items || [];
    applyFilters();
  }catch(e){
    err('[loadData] errore', e);
    toast('Errore nel caricamento dati');
  }
}

function applyFilters(){
  const out = [...DATA].sort((a,b)=> dateTs(b.ritiro_data) - dateTs(a.ritiro_data));
  log('applyFilters → renderList', { count: out.length });
  renderList(out, {
    onUploadForDoc,
    onSaveTracking,
    onComplete,
    onSendMail,
    onGenerateDoc,
  });
}

/* ───────── actions: upload allegati ───────── */
async function onUploadForDoc(e, rec, docKey){
  try{
    const file = e?.target?.files && e.target.files[0];
    if (!file) return;

    const recId = rec._recId || rec.id;
    if (!recId){ toast('Errore: id record mancante'); return; }

    const mapped = docFieldFor(docKey);
    log('onUploadForDoc:start', {
      recId,
      docKey,
      mapped,
      file: { name: file.name, type: file.type, size: file.size }
    });

    toast('Upload in corso…');

    // 1) upload al proxy → url/attachments
    const { url, attachments } = await uploadAttachment(recId, docKey, file);
    const attArray = Array.isArray(attachments) && attachments.length ? attachments : [{ url }];

    // debug probe
    try { window.__LAST_UPLOAD__ = { recId, docKey, mapped, attArray }; } catch {}

    // 2) patch sicura (mappa docKey → campo giusto, e-DAS → Allegato 3)
    const rawFields = rec.fields || {};
    log('onUploadForDoc:patch', { recId, docKey, mapped, rawFieldsKeys: Object.keys(rawFields || {}) });
    await patchDocAttachment(recId, docKey, attArray, rawFields);

    toast(`${(mapped || docKey).replaceAll('_',' ')} caricato`);
    log('onUploadForDoc:done');
    await loadData();
  }catch(e){
    err('[onUploadForDoc] errore upload', e);
    toast('Errore caricamento documento');
  }finally{
    if (e?.target) e.target.value = '';
  }
}

/* ───────── actions: tracking ───────── */
async function onSaveTracking(rec, carrier, tn){
  carrier = (carrier||'').trim();
  tn = (tn||'').trim();
  if (!carrier || !tn){ toast('Inserisci corriere e numero tracking'); return; }

  const recId = rec._recId || rec.id;
  if (!recId){ toast('Errore: id record mancante'); return; }

  try{
    log('onSaveTracking', { recId, carrier, tn });
    await patchShipmentTracking(recId, { carrier, tracking: tn });
    rec.tracking_carrier = carrier;
    rec.tracking_number  = tn;

    const card = document.getElementById(`card-${rec.id}`);
    const btn = card?.querySelector('.send-mail');
    const inp = card?.querySelector('.notify-email');
    if (btn && inp){ btn.disabled = false; inp.disabled = false; btn.title = ''; inp.title = ''; }

    toast(`${rec.id}: tracking salvato`);
  }catch(e){
    err('Errore salvataggio tracking', e);
    toast('Errore salvataggio tracking');
  }
}

/* ───────── actions: genera PDF e allega (server wrapper) ───────── */
async function onGenerateDoc(rec, type = 'proforma'){
  try{
    const recId = rec._recId || rec.id;
    if (!recId){ toast('Errore: id record mancante'); return; }

    const url = `${API_BASE}/docs/unified/generate`;
    const body = { shipmentId: recId, type };

    log('[generateDoc] POST', url, body);
    toast(`Generazione ${type.toUpperCase()}…`);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j.ok){
      err('[generateDoc] error', { status: r.status, j });
      throw new Error(j?.error || `HTTP ${r.status}`);
    }

    toast(`${type.toUpperCase()} generata e allegata ✓`);
    await loadData();
    return j;
  }catch(e){
    err('[onGenerateDoc] error', e);
    toast(`Errore generazione ${type}`);
  }
}

/* ───────── notify mail (Resend) ───────── */
async function onSendMail(rec, typedEmail, opts = {}){
  try{
    const to = String(typedEmail || '').trim();
    const hint = String(rec?.email || '').trim();

    if (!to){
      toast('Digita l’email del cliente');
      return;
    }
    if (hint && to.toLowerCase() !== hint.toLowerCase()){
      toast('L’email digitata non coincide con quella del record');
      return;
    }
    if (!(rec.tracking_carrier && rec.tracking_number)){
      toast('Salva prima corriere e numero tracking');
      return;
    }

    const body = {
      to,
      id: rec.id,
      carrier: rec.tracking_carrier || '',
      tracking: rec.tracking_number || '',
      ritiroData: rec.ritiro_data || '',
    };

    const url = `${API_BASE}/notify/transit`;
    log('[notify] POST', url, body);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      err('[notify] HTTP error', r.status, t.slice(0,180));
      throw new Error(`HTTP ${r.status}: ${t}`);
    }

    rec._mailSent = true;
    opts.onSuccess && opts.onSuccess();

    toast('Mail inviata al cliente');
  }catch(e){
    err('[sendMail] error', e);
    toast('Errore invio mail');
  }
}

/* ───────── evasione ───────── */
async function onComplete(rec){
  const recId = rec._recId || rec.id;
  if (!recId){
    rec.stato = 'In transito';
    toast(`${rec.id}: evasione completata (locale)`);
    return applyFilters();
  }
  try{
    log('onComplete', { recId });
    await patchShipmentTracking(recId, { fields: { 'Stato': 'In transito' } });
    toast(`${rec.id}: evasione completata`);
    await loadData();
  }catch(e){
    err('Errore evasione', e);
    toast('Errore evasione');
  }
}

/* ───────── listeners ───────── */
if (elSearch)   elSearch.addEventListener('input', debounce(()=>loadData(), 250));
if (elOnlyOpen) elOnlyOpen.addEventListener('change', ()=>loadData());

/* ───────── bootstrap ───────── */
loadData().catch(e=>warn('init loadData failed', e));

export { onSendMail, onGenerateDoc };
