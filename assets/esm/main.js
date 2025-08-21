import { DEBUG } from './config.js';
import { fetchShipments, patchShipmentTracking } from './airtable/api.js';
import { renderList } from './ui/render.js';
import { toast } from './utils/dom.js';
import { dateTs } from './utils/misc.js';

const elSearch   = document.getElementById('search');
const elOnlyOpen = document.getElementById('only-open');
const elStatus   = document.getElementById('status-filter');

let DATA = [];

/* ───────── utils ───────── */
function debounce(fn, ms=250){
  let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
}

/* ───────── data flow ───────── */
async function loadData(){
  try{
    const q = (elSearch?.value || '').trim();
    const status = elStatus?.value || 'all';
    const onlyOpen = !!elOnlyOpen?.checked;

    const items = await fetchShipments({ q, status, onlyOpen });
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

/* ───────── actions ───────── */
function onUploadForDoc(e, rec, docName){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  rec.docs = rec.docs || {};
  rec.docs[docName] = `https://files.dev/mock/${rec.id}-${docName}.pdf`;
  toast(`${docName.replaceAll('_',' ')} caricato su ${rec.id} (mock)`);
  applyFilters();
}

async function onSaveTracking(rec, carrier, tn){
  carrier = (carrier||'').trim();
  tn = (tn||'').trim();
  if(!carrier || !tn){
    toast('Inserisci corriere e numero tracking');
    return;
  }
  const recId = rec._recId || rec.id;
  if(!recId){
    console.warn('onSaveTracking: record id mancante', rec);
    toast('Errore: id record mancante');
    return;
  }

  try{
    // Compatibile con entrambe le firme della API:
    // - patchShipmentTracking(id, { carrier, tracking })
    // - patchShipmentTracking(id, carrier, tracking)
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
  if(!recId){
    rec.stato = 'Pronta alla spedizione';
    toast(`${rec.id}: evasione completata (mock)`);
    applyFilters();
    return;
  }
  try{
    await patchShipmentTracking(recId, { statoEvasa: true });
    toast(`${rec.id}: evasione completata`);
    await loadData();
  }catch(err){
    console.error('Errore evasione', err);
    toast('Errore evasione');
  }
}

/* ───────── listeners ───────── */
if (elSearch)   elSearch.addEventListener('input', debounce(()=>loadData(), 250));
if (elOnlyOpen) elOnlyOpen.addEventListener('change', ()=>loadData());
if (elStatus)   elStatus.addEventListener('change', ()=>loadData());

/* ───────── bootstrap ───────── */
loadData().catch(e=>console.warn('init loadData failed', e));
