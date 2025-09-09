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

// Base API per tutte le route del proxy Vercel (notify, airtable, ecc.)
const API_BASE =
  (AIRTABLE?.proxyBase || '')
    .replace(/\/airtable\/?$/i, '')  // es. https://spst-logistics.vercel.app/api
  || 'https://spst-logistics.vercel.app/api';

/* ───────── Persistenza locale: “mail inviata” ───────── */
const MAIL_KEY = 'boMailSent_v1';
function loadMailMap(){ try { return JSON.parse(localStorage.getItem(MAIL_KEY) || '{}'); } catch { return {}; } }
function hasMailSent(id){ const m = loadMailMap(); return !!m[id]; }
function markMailSent(id){ const m = loadMailMap(); m[id] = Date.now(); localStorage.setItem(MAIL_KEY, JSON.stringify(m)); }

/* Default: “Solo non evase” attivo all’apertura */
if (elOnlyOpen) elOnlyOpen.checked = true;

let DATA = [];

/* ───────── utils ───────── */
function debounce(fn, ms = 250){
  let t; return (...args)=>{ clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}

/* ───────── data flow ───────── */
async function loadData(){
  try{
    const q = (elSearch?.value || '').trim();

    // Con checkbox attivo mostriamo SOLO stato=Nuova
    const status   = elOnlyOpen?.checked ? 'nuova' : 'all';
    const onlyOpen = false; // non lo usiamo più per filtrare “in transito”

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
    isMailSent: hasMailSent,         // ➜ per mostrare “Email inviata ✓” in card
  });
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
  if (!carrier || !tn){ toast('Inserisci corriere e numero tracking'); return; }

  const recId = rec._recId || rec.id;
  if (!recId){ toast('Errore: id record mancante'); return; }

  try{
    // Solo salvataggio carrier + tracking (lo stato passerà a “In transito” con Evasione completata)
    await patchShipmentTracking(recId, { carrier, tracking: tn });

    // aggiorna UI locale senza ricaricare
    rec.tracking_carrier = carrier;
    rec.tracking_number  = tn;

    toast(`${rec.id}: tracking salvato`);
  }catch(err){
    console.error('Errore salvataggio tracking', err);
    toast('Errore salvataggio tracking');
  }
}

/**
 * Invio mail sicuro con Resend.
 * Accetta un terzo parametro opzionale { onSuccess } per aggiornare la UI della card (flag “inviata”).
 */
async function onSendMail(rec, typedEmail, opts = {}){
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
    // disponibile solo quando Stato = “In transito”
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

    markMailSent(rec.id);           // ✓ ricordiamo che è stata inviata
    if (typeof opts.onSuccess === 'function') opts.onSuccess();

    toast('Mail inviata al cliente');
  }catch(err){
    console.error('[sendMail] error', err);
    toast('Errore invio mail');
  }
}

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
    await loadData(); // con "Solo non evase" attivo scompare perché non è più "Nuova"
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

export { onSendMail };
