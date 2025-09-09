// assets/esm/main.js
import { DEBUG } from './config.js';
import {
  fetchShipments,
  patchShipmentTracking,
  uploadAttachment,
  docFieldFor,
} from './airtable/api.js';
import { renderList } from './ui/render.js';
import { toast } from './utils/dom.js';
import { dateTs, trackingUrl } from './utils/misc.js';   // 👈 serve per il link tracking
import './back-office-tabs.js';

const elSearch   = document.getElementById('search');
const elOnlyOpen = document.getElementById('only-open');

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
  // 👇 passiamo anche onSendMail al render
  renderList(out, { onUploadForDoc, onSaveTracking, onComplete, onSendMail });
}

/* ───────── actions ───────── */
async function onUploadForDoc(e, rec, docKey){
  try{
    const file = e?.target?.files && e.target.files[0];
    if (!file) return;

    const recId = rec._recId || rec.id;
    if (!recId){ toast('Errore: id record mancante'); return; }

    toast('Upload in corso…');

    const { url, attachments } = await uploadAttachment(recId, docKey, file);
    const attArray = Array.isArray(attachments) && attachments.length ? attachments : [{ url }];

    const fieldName = docFieldFor(docKey);
    await patchShipmentTracking(recId, { [fieldName]: attArray });

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
    // 👉 oltre a carrier+tracking, forziamo lo Stato = "In transito"
    const res = await patchShipmentTracking(recId, {
      carrier,
      tracking: tn,
      fields: { 'Stato': 'In transito' },
    });
    if (DEBUG) console.log('[TRACK PATCH OK]', res);

    // Aggiorna subito la UI locale (anche se ricarichiamo dopo)
    rec.stato = 'In transito';

    toast(`${rec.id}: tracking salvato (stato → In transito)`);
    await loadData();
  }catch(err){
    console.error('Errore salvataggio tracking', err);
    toast('Errore salvataggio tracking');
  }
}

async function onComplete(rec){
  const recId = rec._recId || rec.id;
  if (!recId){
    rec.stato = 'Pronta alla spedizione';
    toast(`${rec.id}: evasione completata (locale)`);
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

/* invio mail sicuro (stato = In transito, email digitata deve coincidere) */
async function onSendMail(rec, typedEmail){
  const must = String(rec.email||'').trim().toLowerCase();
  const got  = String(typedEmail||'').trim().toLowerCase();

  if (!got){
    toast('Inserisci l’email del cliente');
    return;
  }
  if (must && got !== must){
    toast('L’email non coincide con quella del record');
    return;
  }
  const statoOk = String(rec.stato||'').toLowerCase() === 'in transito';
  if (!statoOk){
    toast('La notifica è disponibile solo con stato "In transito"');
    return;
  }
  if (!rec.tracking_carrier || !rec.tracking_number){
    toast('Inserisci prima corriere e tracking');
    return;
  }

  try{
    toast('Invio mail in corso…');
    const res = await fetch('/api/notify/transit', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({
        to: typedEmail,
        id: rec.id,
        carrier: rec.tracking_carrier,
        tracking: rec.tracking_number,
        trackingUrl: trackingUrl(rec.tracking_carrier, rec.tracking_number) || rec.tracking_url || '',
        ritiroData: rec.ritiro_data || '',
      })
    });
    if (!res.ok){
      const t = await res.text().catch(()=> '');
      throw new Error(`HTTP ${res.status}: ${t}`);
    }
    toast('Email inviata ✅');
  }catch(e){
    console.error('[sendMail] error', e);
    toast('Errore invio email');
  }
}

/* ───────── listeners ───────── */
if (elSearch)   elSearch.addEventListener('input', debounce(()=>loadData(), 250));
if (elOnlyOpen) elOnlyOpen.addEventListener('change', ()=>loadData());

/* ───────── bootstrap ───────── */
loadData().catch(e=>console.warn('init loadData failed', e));
