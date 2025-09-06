import { DEBUG } from './config.js';
import { fetchShipments, patchShipmentTracking, uploadAttachment } from './airtable/api.js';
import { renderList } from './ui/render.js';
import { toast } from './utils/dom.js';
import { dateTs } from './utils/misc.js';
import './back-office-tabs.js';
import './header-compact.js';


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

// ...imports invariati...

function ritiroDateOf(item){
  if (item && item.fields){
    return item.fields['Ritiro - Data'] || item.fields['Data Ritiro'] || (item.createdTime ? item.createdTime.slice(0,10) : '');
  }
  return item?.ritiro_data || '';
}

function applyFilters(){
  const out = [...DATA].sort((a,b)=> dateTs(ritiroDateOf(b)) - dateTs(ritiroDateOf(a)));
  renderList(out, { onUploadForDoc, onSaveTracking, onComplete });
}


/* ───────── actions ───────── */
async function onUploadForDoc(e, rec, docName){
  try{
    const file = e?.target?.files && e.target.files[0];
    if(!file) return;

    const recId = rec._recId || rec.id;
    if(!recId){
      toast('Errore: id record mancante');
      return;
    }

    toast('Upload in corso…');

    // 1) carica il file su storage (proxy → Vercel Blob) e ottieni una URL pubblica
    const { url } = await uploadAttachment(recId, docName, file);

    // 2) patch su Airtable: mappa il docName al campo attachment
    await patchShipmentTracking(recId, { docs: { [docName]: url } });

    toast(`${docName.replaceAll('_',' ')} caricato`);
    await loadData();
  }catch(err){
    console.error('[onUploadForDoc] errore upload', err);
    toast('Errore caricamento documento');
  }finally{
    // reset input file per permettere ri-upload dello stesso nome
    if (e?.target) e.target.value = '';
  }
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
