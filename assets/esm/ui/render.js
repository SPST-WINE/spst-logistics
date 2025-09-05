aimport { TEMPLATES, CARRIERS } from '../config.js';
import { toKg } from '../utils/misc.js';
import { totalPesoKg } from '../utils/weights.js';
import { labelInfoFor } from '../rules/labels.js';
import { computeRequiredDocs } from '../rules/docs.js';
import { trackingUrl } from '../utils/misc.js';
import { fetchColliFor } from '../airtable/api.js'; // <-- usa il proxy /colli se presente

/* ──────────────────────────────────────────────────────────────
   PICK “LOOSE”: gestisce -/–, spazi e case-insensitive
   ────────────────────────────────────────────────────────────── */

function normKey(s){
  return String(s || '')
    .replace(/[–—]/g, '-')       // en/em dash -> hyphen
    .replace(/\s+/g, ' ')        // collassa spazi
    .trim()
    .toLowerCase();
}
function pickLoose(fields, ...names){
  if (!fields) return undefined;
  const map = new Map(Object.keys(fields).map(k => [normKey(k), k]));
  for (const wanted of names){
    const real = map.get(normKey(wanted));
    if (real != null) {
      const v = fields[real];
      if (v !== '' && v != null) return v;
    }
  }
  // fallback: exact (per sicurezza)
  for (const n of names){
    if (n in fields && fields[n] !== '' && fields[n] != null) return fields[n];
  }
  return undefined;
}

/* ──────────────────────────────────────────────────────────────
   DOCS MAPPING (nuovo + legacy)
   ────────────────────────────────────────────────────────────── */

function mapDocs(fields) {
  const getAttUrl = (k) => {
    const v = pickLoose(fields, k);
    if (Array.isArray(v) && v.length && v[0]?.url) return v[0].url;
    if (typeof v === 'string' && v) return v;
    return '';
  };
  return {
    Lettera_di_Vettura: getAttUrl('Allegato LDV') || getAttUrl('Lettera di Vettura'),
    Fattura_Commerciale: getAttUrl('Allegato Fattura') || getAttUrl('Fattura Commerciale Caricata'),
    Fattura_Proforma: getAttUrl('Fattura Proforma') || '',
    Dichiarazione_Esportazione: getAttUrl('Allegato DLE') || getAttUrl('Dichiarazione Esportazione'),
    Packing_List: getAttUrl('Allegato PL') || getAttUrl('Packing List'),
    FDA_Prior_Notice: getAttUrl('Prior Notice') || '',
    // allegati cliente (nuovi)
    Fattura_Client: getAttUrl('Fattura - Allegato Cliente'),
    Packing_Client: getAttUrl('Packing List - Allegato Cliente'),
  };
}

/* ──────────────────────────────────────────────────────────────
   COLLI FALLBACK (solo se manca endpoint /colli)
   ────────────────────────────────────────────────────────────── */

function mapColliFallback(fields) {
  const lista = pickLoose(fields, 'Lista Colli Ordinata', 'Lista Colli', 'Contenuto Colli') || '';
  if (!lista) return [];
  return String(lista).split(/[;|\n]+/).map((s) => {
    const m = String(s).match(/(\d+)\D+(\d+)\D+(\d+).+?(\d+(?:[\.,]\d+)?)/);
    if (!m) return { L: '-', W: '-', H: '-', kg: 0 };
    return { L: m[1], W: m[2], H: m[3], kg: Number(String(m[4]).replace(',', '.')) || 0 };
  });
}

function badgeFor(stato) {
  if (!stato) return 'gray';
  const s = String(stato).toLowerCase();
  if (s === 'pronta alla spedizione' || s === 'evasa' || s === 'in transito' || s === 'consegnata') return 'green';
  if (s === 'nuova') return 'gray';
  return 'yellow';
}

/* ──────────────────────────────────────────────────────────────
   NORMALIZZAZIONE RECORD
   ────────────────────────────────────────────────────────────── */

export function normalizeShipmentRecord(rec) {
  const f = rec.fields || {};

  const idSped    = pickLoose(f, 'ID Spedizione') || rec.id;
  const email     = pickLoose(f, 'Creato da', 'Creato da email', 'Mail Cliente');

  // Mittente (copriamo sia “-” sia “–”, maiuscole/minuscole)
  const mitt_paese     = pickLoose(f, 'Mittente - Paese', 'Mittente – Paese', 'Paese Mittente');
  const mitt_citta     = pickLoose(f, 'Mittente - Città', 'Mittente – Città', 'Città Mittente');
  const mitt_cap       = pickLoose(f, 'Mittente - CAP', 'Mittente – CAP', 'CAP Mittente');
  const mitt_indir     = pickLoose(f, 'Mittente - Indirizzo', 'Mittente – Indirizzo', 'Indirizzo Mittente');
  const mitt_tel       = pickLoose(f, 'Mittente - Telefono', 'Mittente – Telefono', 'Telefono Mittente');
  const mitt_piva      = pickLoose(f, 'Mittente - P.IVA/CF', 'Mittente – P.IVA/CF', 'PIVA Mittente');
  const mitt_rs        = pickLoose(f, 'Mittente - Ragione sociale', 'Mittente – Ragione sociale', 'Mittente – ragione sociale', 'Mittente');

  // Destinatario
  const dest_paese     = pickLoose(f, 'Destinatario - Paese', 'Destinatario – Paese', 'Paese Destinatario');
  const dest_citta     = pickLoose(f, 'Destinatario - Città', 'Destinatario – Città', 'Città Destinatario');
  const dest_cap       = pickLoose(f, 'Destinatario - CAP', 'Destinatario – CAP', 'CAP Destinatario');
  const dest_indir     = pickLoose(f, 'Destinatario - Indirizzo', 'Destinatario – Indirizzo', 'Indirizzo Destinatario');
  const dest_tel       = pickLoose(f, 'Destinatario - Telefono', 'Destinatario – Telefono', 'Telefono Destinatario');
  const dest_rs        = pickLoose(f, 'Destinatario - Ragione sociale', 'Destinatario – Ragione sociale', 'Destinatario – ragione sociale', 'Destinatario');

  // Stato nuovo / legacy
  const statoNew       = pickLoose(f, 'Stato');
  const statoLegacyEv  = !!pickLoose(f, 'Stato Spedizione');
  const stato          = statoNew || (statoLegacyEv ? 'Evasa' : 'Nuova');

  const ritiroData     = pickLoose(f, 'Ritiro - Data', 'Ritiro – Data', 'Data Ritiro');
  const incoterm       = pickLoose(f, 'Incoterm');
  const tipoSped       = pickLoose(f, 'Sottotipo', 'Tipo Spedizione'); // B2B | B2C | Sample
  const trackingNum    = pickLoose(f, 'Tracking Number');
  const trackingUrlFld = pickLoose(f, 'Tracking URL');
  const carrier        = (function(){
    const c = pickLoose(f, 'Corriere');
    if (!c) return null;
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c.name) return c.name;
    return null;
  })();

  const docs  = mapDocs(f);
  const colli = Array.isArray(rec.colli) ? rec.colli : mapColliFallback(f);

  // LOG diagnostico (solo per il primo record della pagina)
  if (!window.__BO_DEBUG_ONCE__) {
    window.__BO_DEBUG_ONCE__ = true;
    console.group('[BO] Debug primo record');
    console.debug('Keys Airtable:', Object.keys(f));
    console.debug('RagioneSociale dest:', dest_rs, 'mitt:', mitt_rs);
    console.debug('Stato:', stato, 'Ritiro:', ritiroData, 'Carrier:', carrier, 'TN:', trackingNum);
    console.debug('Colli (dal record):', colli);
    console.groupEnd();
  }

  return {
    _recId: rec.id, // serve per PATCH e lazy colli
    id: idSped,
    cliente: dest_rs || mitt_rs || '(sconosciuto)',
    email,

    ritiro_data: ritiroData || '-',
    incoterm: incoterm || '-',
    tipo_spedizione: (String(tipoSped || 'B2B') === 'Sample') ? 'Campionatura' : (tipoSped || 'B2B'),

    // mittente
    mittente_paese: mitt_paese,
    mittente_citta: mitt_citta,
    mittente_cap: mitt_cap,
    mittente_indirizzo: mitt_indir,
    mittente_telefono: mitt_tel,
    piva_mittente: mitt_piva,
    mittente_eori: pickLoose(f, 'Mittente EORI'),

    // destinatario
    dest_paese: dest_paese,
    dest_citta: dest_citta,
    dest_cap: dest_cap,
    dest_indirizzo: dest_indir,
    dest_telefono: dest_tel,
    dest_eori: pickLoose(f, 'Codice EORI Destinatario Fattura', 'Destinatario EORI'),

    // tracking
    tracking_carrier: carrier,
    tracking_number: trackingNum,
    tracking_url: trackingUrlFld,

    // stato
    stato,
    _badgeClass: badgeFor(stato),

    // liste
    colli,
    docs,
  };
}

/* ──────────────────────────────────────────────────────────────
   RENDER UI
   ────────────────────────────────────────────────────────────── */

function ensureListContainer() {
  // prova #list
  let el = document.getElementById('list');
  if (el) return el;

  // prova contenitore tab spedizioni
  const host = document.getElementById('view-spedizioni') || document.body;
  el = document.createElement('div');
  el.id = 'list';
  host.appendChild(el);

  console.warn('[BO] #list non trovato: creato dinamicamente dentro #view-spedizioni');
  return el;
}

export function renderList(data, {onUploadForDoc, onSaveTracking, onComplete}){
  // Se arrivano già adattati (adapter), li uso; se arrivano grezzi {id,fields}, li normalizzo qui
  const normalized = (data || []).map((rec) => rec && rec.fields ? normalizeShipmentRecord(rec) : rec);

  const elList = ensureListContainer();
  try {
    elList.innerHTML = '';
  } catch (e) {
    console.error('[BO] impossibile scrivere in #list', e);
    return;
  }

  console.debug('[BO] renderList — items:', normalized.length);

  if (!normalized.length){
    elList.innerHTML = '<div class="small" style="opacity:.8">Nessun risultato</div>';
    return;
  }

  normalized.forEach(rec=>{
    const {required, missing, notes, country, tipo} = computeRequiredDocs(rec);
    const badgeClass = rec._badgeClass || (rec.stato === 'Nuova' ? 'gray' : 'yellow');

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = /* …tutto il markup identico a prima… */ `
      <div class="row spaced">
        <h3>${rec.id} — ${rec.cliente}</h3>
        <span class="badge ${badgeClass}">${rec.stato||'-'}</span>
      </div>
      <div class="kv">
        <div class="k">Email cliente</div><div>${rec.email||'-'}</div>
        <div class="k">Partenza</div><div>${(rec.mittente_paese||'-')} • ${(rec.mittente_citta||'-')} ${(rec.mittente_cap?('('+rec.mittente_cap+')'):'')}</div>
        <div class="k">Indirizzo partenza</div><div>${rec.mittente_indirizzo||'-'}</div>
        <div class="k">Arrivo</div><div>${(rec.dest_paese||rec.paese||'-')} • ${(rec.dest_citta||rec.citta||'-')} ${(rec.dest_cap?('('+rec.dest_cap+')'):'')}</div>
        <div class="k">Indirizzo destinazione</div><div>${rec.dest_indirizzo||'-'}</div>
        <div class="k">Tipo spedizione</div><div>${rec.tipo_spedizione||'-'}</div>
        <div class="k">Incoterm</div><div>${rec.incoterm||'-'}</div>
        <div class="k">Peso reale</div><div>${toKg(totalPesoKg(rec))}</div>
        <div class="k">Lista colli</div>
        <div class="bo-colli-holder">${(rec.colli&&rec.colli.length)?`
          <table class="colli">
            <thead><tr><th>Dim. (L×W×H cm)</th><th>Peso reale</th></tr></thead>
            <tbody>
              ${rec.colli.map((c)=>`<tr><td>${c.L}×${c.W}×${c.H}</td><td>${toKg(c.kg)}</td></tr>`).join('')}
            </tbody>
          </table>` : '<span class="small">—</span>'}
        </div>
      </div>

      <div class="hr"></div>

      ${renderLabelPanel(rec)}
      ${renderTrackingBlock(rec)}
      <div class="details">${renderPrintGrid(rec)}</div>

      <div class="actions">
        <button class="btn complete" data-id="${rec.id}">Evasione completata</button>
      </div>
    `;

    // 🔹 Lazy-load colli, ora cerca il holder in modo esplicito
    (async ()=>{
      try{
        if (!rec.colli || !rec.colli.length) {
          const holder = card.querySelector('.bo-colli-holder');
          if (holder) holder.innerHTML = '<span class="small">Carico colli…</span>';
          const rows = await fetchColliFor(rec._recId || rec.id);
          if (Array.isArray(rows) && rows.length){
            const html = `
              <table class="colli">
                <thead><tr><th>Dim. (L×W×H cm)</th><th>Peso reale</th></tr></thead>
                <tbody>
                  ${rows.map(c=>`<tr><td>${c.L}×${c.W}×${c.H}</td><td>${toKg(c.kg)}</td></tr>`).join('')}
                </tbody>
              </table>`;
            if (holder) holder.innerHTML = html;
            rec.colli = rows;
          } else if (holder) {
            holder.innerHTML = '<span class="small">—</span>';
          }
        }
      }catch(err){
        console.warn('[BO] fetchColliFor error per', rec.id, err);
      }
    })();

    // …(listeners upload, complete, toggle, tracking) restano identici…

    try {
      elList.appendChild(card);
    } catch (e) {
      console.error('[BO] append card fallito', e);
    }

    console.debug('[BO] card', { id: rec.id, cliente: rec.cliente, colli: rec.colli?.length||0 });
  });
}


    // Upload per-doc
    card.querySelectorAll('.upload-doc').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const input = card.querySelector(`#${btn.dataset.input}`);
        if(input) input.click();
      });
    });
    card.querySelectorAll('.per-doc-upload').forEach(inp=>{
      inp.addEventListener('change', (e)=>onUploadForDoc(e, rec, e.target.dataset.doc));
    });

    // Complete
    card.querySelector('.complete').addEventListener('click', ()=>onComplete(rec));

    // Toggle dettagli
    const btnToggle = card.querySelector('.toggle-details');
    const details = card.querySelector('.details');
    btnToggle.addEventListener('click', ()=>{
      details.classList.toggle('show');
      btnToggle.textContent = details.classList.contains('show') ? 'Comprimi record' : 'Espandi record';
    });

    // Toggle etichette
    const btnLabels = card.querySelector('.toggle-labels');
    const labelPanel = card.querySelector('.label-panel');
    btnLabels.addEventListener('click', ()=>{
      labelPanel.classList.toggle('show');
      btnLabels.textContent = labelPanel.classList.contains('show') ? 'Nascondi etichette' : 'Verifica etichette';
    });

    // Salva tracking
    const saveBtn = card.querySelector('.save-tracking');
    const carrierSel = card.querySelector('#'+saveBtn.dataset.carrier);
    const tnInput = card.querySelector('#'+saveBtn.dataset.tn);
    saveBtn.addEventListener('click', ()=>onSaveTracking(rec, carrierSel.value, tnInput.value));

    // Log sintetico della card
    console.debug('[BO] card', { id: rec.id, cliente: rec.cliente, dest_rs: rec.dest_paese && (rec.dest_paese+' / '+rec.dest_citta), colli: rec.colli?.length||0 });
  });
}
