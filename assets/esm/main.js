// assets/esm/main.js
import { DEBUG, AIRTABLE } from './config.js';
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
  renderList(out, {
    onUploadForDoc,
    onSaveTracking,
    onComplete,
    onSendMail,
    onGenerateDoc,
  });
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

/* ───────── actions: upload allegati ───────── */
async function onUploadForDoc(e, rec, docKey){
  try{
    const file = e?.target?.files && e.target.files[0];
    if (!file) return;

    const recId = rec._recId || rec.id;
    if (!recId){ toast('Errore: id record mancante'); return; }

    toast('Upload in corso…');

    const { url, attachments } = await uploadAttachment(recId, docKey, file);
    const attArray = Array.isArray(attachments) && attachments.length ? attachments : [{ url }];

    // Mappa la chiave UI (es. "e-DAS") al vero campo Airtable e PATCHA SEMPRE dentro fields
    const fieldName = docFieldFor(docKey);
    await patchShipmentTracking(recId, { fields: { [fieldName]: attArray } });

    toast(`${docKey.replaceAll('_',' ')} caricato`);
    await loadData();
  }catch(err){
    console.error('[onUploadForDoc] errore upload', err);
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
    await patchShipmentTracking(recId, { carrier, tracking: tn }); // NON cambiamo lo Stato qui
    rec.tracking_carrier = carrier;
    rec.tracking_number  = tn;
    enableNotify(rec.id);
    toast(`${rec.id}: tracking salvato`);
  }catch(err){
    console.error('Errore salvataggio tracking', err);
    toast('Errore salvataggio tracking');
  }
}

/* ───────── actions: genera PDF e allega ───────── */
async function onGenerateDoc(rec, type = 'proforma'){
  try{
    const recId = rec._recId || rec.id;
    if (!recId){ toast('Errore: id record mancante'); return; }

    const url = `${API_BASE}/docs/unified/generate`;
    const body = { shipmentId: recId, type };

    if (DEBUG) console.log('[generateDoc] POST', url, body);
    toast(`Generazione ${type.toUpperCase()}…`);

    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(()=> ({}));
    if (!r.ok || !j.ok){
      throw new Error(j?.error || `HTTP ${r.status}`);
    }

    toast(`${type.toUpperCase()} generata e allegata ✓`);
    await loadData();
    return j;
  }catch(err){
    console.error('[onGenerateDoc] error', err);
    toast(`Errore generazione ${type}`);
  }
}

/* ───────── notify mail ───────── */
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

    rec._mailSent = true;
    opts.onSuccess && opts.onSuccess();
    toast('Mail inviata al cliente');
  }catch(err){
    console.error('[sendMail] error', err);
    toast('Errore invio mail');
  }
}

/* ───────── evasione ───────── */
async function onComplete(rec){
  const recId = rec._recId || rec.id;
  if (!recId){
    rec.stato = 'In transito';
    toast(`${rec.id}: evasione completata (locale)`);
    applyFilters();
    return;
  }
  try{
    await patchShipmentTracking(recId, { fields: { 'Stato': 'In transito' } });
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

/* ───────── bootstrap ───────── */
loadData().catch(e=>console.warn('init loadData failed', e));

export { onSendMail, onGenerateDoc };
