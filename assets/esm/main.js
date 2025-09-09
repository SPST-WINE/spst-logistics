// assets/esm/main.js
import { DEBUG } from './config.js';
import {
  fetchShipments,
  patchShipmentTracking,
  uploadAttachment,
  patchDocAttachment, // ⬅️ nuovo: patch di un allegato con fallback nomi campo
} from './airtable/api.js';
import { renderList } from './ui/render.js';
import { toast } from './utils/dom.js';
import { dateTs } from './utils/misc.js';
import './back-office-tabs.js';

const elSearch   = document.getElementById('search');
const elOnlyOpen = document.getElementById('only-open');

let DATA = [];

/* utils */
function debounce(fn, ms = 250){
  let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}

/* data flow */
async function loadData(){
  try{
    const q = (elSearch?.value || '').trim();
    const onlyOpen = !!elOnlyOpen?.checked;
    const items = await fetchShipments({ q, onlyOpen });
    DATA = items || [];
    applyFilters();
  }catch(err){
    console.error('[loadData] errore', err);
    toast('Errore nel caricamento dati');
  }
}

function applyFilters(){
  const out = [...DATA].sort((a,b)=> dateTs(b.ritiro_data) - dateTs(a.ritiro_data));
  renderList(out, { onUploadForDoc, onSaveTracking, onComplete });
}

/* actions */
async function onUploadForDoc(e, rec, docKey){
  try{
    const file = e?.target?.files && e.target.files[0];
    if (!file) return;

    const recId = rec._recId || rec.id;
    if (!recId){
      toast('Errore: id record mancante');
      return;
    }

    toast('Upload in corso…');

    // 1) upload al proxy → URL pubblica
    const { url } = await uploadAttachment(recId, docKey, file);
    const attArray = [{ url }];

    // 2) patch SOLO quel documento con fallback nomi campo
    await patchDocAttachment(recId, docKey, attArray);

    toast(`${docKey.replaceAll('_',' ')} caricato`);
    await loadData();
  }catch(err){
    console.error('[onUploadForDoc] errore upload', err);
    toast('Errore caricamento documento');
  }finally{
    if (e?.target) e.target.value = '';
  }
}

async function onSaveTracking(rec, carrier, tn){
  carrier = (carrier||'').trim();
  tn = (tn||'').trim();
  if (!carrier || !tn){
    toast('Inserisci corriere e numero tracking');
    return;
  }
  const recId = rec._recId || rec.id;
  if (!recId){
    console.warn('onSaveTracking: record id mancante', rec);
    toast('Errore: id record mancante');
    return;
  }

  try{
    const res = await patchShipmentTracking(recId, { carrier, tracking: tn });
    if (DEBUG) console.log('[TRACK PATCH OK]', res);
    toast(`${rec.id}: tracking salvato`);
    await loadData();
  }catch(err){
    console.error('Errore salvataggio tracking', err);
    toast('Errore salvataggio tracking');
  }
}

async function onComplete(rec){
  const recId = rec._recId || rec.id;
  if (!recId){
    rec.stato = 'In transito';
    toast(`${rec.id}: segnata in transito (locale)`);
    applyFilters();
    return;
  }
  try{
    await patchShipmentTracking(recId, { stato: 'In transito' });
    toast(`${rec.id}: segnata in transito`);
    await loadData();
  }catch(err){
    console.error('Errore cambio stato', err);
    toast('Errore cambio stato');
  }
}

/* listeners */
if (elSearch)   elSearch.addEventListener('input', debounce(()=>loadData(), 250));
if (elOnlyOpen) elOnlyOpen.addEventListener('change', ()=>loadData());

/* bootstrap */
loadData().catch(e=>console.warn('init loadData failed', e));
