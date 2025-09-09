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
import { dateTs } from './utils/misc.js';
import './back-office-tabs.js';

const elSearch   = document.getElementById('search');
const elOnlyOpen = document.getElementById('only-open');
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
  renderList(out, { onUploadForDoc, onSaveTracking, onComplete, onSendMail });
}

/* ───────── helpers DOM ───────── */
function setBadge(recId, text, cls){
  const card = document.getElementById(`card-${recId}`);
  const badge = card?.querySelector('.badge');
  if (badge){
    badge.textContent = text;
    badge.className = `badge ${cls||'green'}`;
  }
}
function enableNotify(recId){
  const card = document.getElementById(`card-${recId}`);
  const btn = card?.querySelector('.send-mail');
  const inp = card?.querySelector('.notify-email');
  if (btn && inp){
    btn.disabled = false;
    inp.disabled = false;
    btn.title = '';
    inp.title = '';
  }
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
    // salva TN + imposta Stato = "In transito"
    const res = await patchShipmentTracking(recId, {
      carrier,
      tracking: tn,
      fields: { 'Stato': 'In transito' },
    });
    if (DEBUG) console.log('[TRACK PATCH OK]', res);

    // Aggiorna subito la UI locale (NON ricarichiamo l’elenco)
    rec.tracking_carrier = carrier;
    rec.tracking_number  = tn;
    rec.stato = 'In transito';
    setBadge(rec.id, 'In transito', 'green');
    enableNotify(rec.id);

    toast(`${rec.id}: tracking salvato (stato → In transito)`);
  }catch(err){
    console.error('Errore salvataggio tracking', err);
    toast('Errore salvataggio tracking');
  }
}

async function onSendMail(rec, typedEmail){
  try{
    const to = String(typedEmail || '').trim();
    const hint = String(rec?.email || '').trim();

    if (!to){
      toast('Digita l’email del cliente');
      return;
    }
    // sicurezza: deve coincidere con quella del record
    if (hint && to.toLowerCase() !== hint.toLowerCase()){
      toast('L’email digitata non coincide con quella del record');
      return;
    }
    // sicurezza: solo se in transito
    if (String(rec?.stato || '').toLowerCase() !== 'in transito'){
      toast('Disponibile solo quando la spedizione è “In transito”');
      return;
    }

    const body = {
      to,
      id: rec.id,
      carrier: rec.tracking_carrier || '',
      tracking: rec.tracking_number || '',
      ritiroData: rec.ritiro_data || '',
    };

    const url = `${API_BASE}/notify/transit`;   // ⬅️ torna a chiamare il proxy Vercel
    if (DEBUG) console.log('[notify] POST', url, body);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      throw new Error(`HTTP ${r.status}: ${t}`);
    }

    toast('Mail inviata al cliente');
  }catch(err){
    console.error('[sendMail] error', err);
    toast('Errore invio mail');
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
    await loadData(); // qui sì: dopo completamento ricarichiamo (sparirà con "Solo non evase")
  }catch(err){
    console.error('Errore evasione', err);
    toast('Errore evasione');
  }
}

/* ───────── listeners ───────── */
if (elSearch)   elSearch.addEventListener('input', debounce(()=>loadData(), 250));
if (elOnlyOpen) elOnlyOpen.addEventListener('change', ()=>loadData());

/* ───────── bootstrap ───────── */
loadData().catch(e=>console.warn('init loadData failed', e));

export { onSendMail }; // (non obbligatorio, ma utile se mai servisse altrove)
