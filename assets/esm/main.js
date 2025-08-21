import { DEBUG } from './config.js';
import { fetchShipments, patchShipmentTracking } from './airtable/api.js';
import { renderList } from './ui/render.js';
import { toast } from './utils/dom.js';
import { dateTs } from './utils/misc.js';

const elSearch   = document.getElementById('search');
const elOnlyOpen = document.getElementById('only-open');
const elStatus   = document.getElementById('status-filter');

let DATA = [];

async function loadData(){
  const q = elSearch.value.trim();
  const status = elStatus.value;
  const onlyOpen = elOnlyOpen.checked;
  const items = await fetchShipments({q, status, onlyOpen});
  DATA = items;
  applyFilters();
}

function applyFilters(){
  let out = [...DATA];
  out.sort((a,b)=> dateTs(b.ritiro_data) - dateTs(a.ritiro_data));
  renderList(out, { onUploadForDoc, onSaveTracking, onComplete });
}

function onUploadForDoc(e, rec, docName){
  const file = e.target.files && e.target.files[0];
  if(!file) return;
  rec.docs = rec.docs || {};
  rec.docs[docName] = `https://files.dev/mock/${rec.id}-${docName}.pdf`;
  toast(`${docName.replaceAll('_',' ')} caricato su ${rec.id} (mock)`);
  applyFilters();
}

async function onSaveTracking(rec, carrier, tn){
  carrier = (carrier||'').trim(); tn = (tn||'').trim();
  if(!carrier || !tn){ toast('Inserisci corriere e numero tracking'); return; }
  try{
    if(rec._recId || rec.id){
      const res = await patchShipmentTracking(rec._recId || rec.id, { carrier, tracking: tn });
      if (DEBUG) console.log('[TRACK PATCH OK]', res);
      toast(`${rec.id}: tracking salvato`);
      await loadData();
    }else{
      rec.tracking_carrier = carrier; rec.tracking_number = tn;
      toast(`${rec.id}: tracking salvato (mock)`);
      applyFilters();
    }
  }catch(err){
    console.error('Errore salvataggio tracking', err);
    toast('Errore salvataggio tracking');
  }
}

async function onComplete(rec){
  try{
    if(rec._recId || rec.id){
      await patchShipmentTracking(rec._recId || rec.id, { statoEvasa: true });
      toast(`${rec.id}: evasione completata`);
      await loadData();
    }else{
      rec.stato = 'Pronta alla spedizione';
      toast(`${rec.id}: evasione completata (mock)`);
      applyFilters();
    }
  }catch(err){ console.error('Errore evasione', err); toast('Errore evasione'); }
}

// listeners
elSearch.addEventListener('input', ()=>loadData());
elOnlyOpen.addEventListener('change', ()=>loadData());
elStatus.addEventListener('change', ()=>loadData());

// bootstrap
loadData().catch(e=>console.warn('init loadData failed', e));

