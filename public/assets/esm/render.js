/// spst-logistics/public/assets/esm/render.js

/* ===== Env & assets (URL assoluti) ===== */
const DEFAULT_ORIGIN = 'https://spst-logistics.vercel.app';
function __detectOrigin() {
  try {
    // prova a dedurre l'origine dall'URL dello script caricato
    const fromCurrent = document.currentScript?.src;
    if (fromCurrent) return new URL(fromCurrent).origin;
    const s = Array.from(document.scripts).map(x => x.src).find(u => u && u.includes('/assets/esm/render'));
    if (s) return new URL(s).origin;
  } catch {}
  return DEFAULT_ORIGIN;
}
export const BO_ORIGIN = __detectOrigin();
export const BO_ASSETS = `${BO_ORIGIN}/assets/esm`;
const CSS_URLS = [`${BO_ASSETS}/base.css?v=1`, `${BO_ASSETS}/quotes-admin.css?v=1`];
const STANDALONE_TPL_URL = `${BO_ASSETS}/back-office-standalone.html?v=4`;

/* ===== Iniezione CSS (una sola volta) ===== */
export function ensureBoAssets() {
  if (window.__BO_CSS_INJECTED__) return;
  window.__BO_CSS_INJECTED__ = true;
  CSS_URLS.forEach(href => {
    if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  });
}

/* ===== Mount opzionale del template standalone (nessun 404 automatico) ===== */
export async function mountStandalone(containerId = 'view-spedizioni') {
  ensureBoAssets();
  let host = document.getElementById(containerId);
  if (!host) {
    host = document.createElement('div');
    host.id = containerId;
    document.body.appendChild(host);
  }
  try {
    const res = await fetch(STANDALONE_TPL_URL, { cache: 'no-store' });
    if (!res.ok) {
      console.warn('[BO] template non trovato', res.status);
      return host;
    }
    const html = await res.text();
    host.innerHTML = html;
  } catch (e) {
    console.warn('[BO] errore fetch template', e);
  }
  return host;
}

/* ===== IMPORTS originali ===== */
import { TEMPLATES, CARRIERS } from '../config.js';
import { toKg, trackingUrl } from '../utils/misc.js';
import { totalPesoKg } from '../utils/weights.js';
import { labelInfoFor } from '../rules/labels.js';
import { computeRequiredDocs } from '../rules/docs.js';
import { fetchColliFor } from '../airtable/api.js';

/* ===== Helpers (normKey, pickLoose, toNum, mapDocs, colli fallback, badgeFor) ===== */
function normKey(s){return String(s||'').replace(/[–—]/g,'-').replace(/\s+/g,' ').trim().toLowerCase();}
function pickLoose(fields,...names){if(!fields)return;const m=new Map(Object.keys(fields).map(k=>[normKey(k),k]));for(const n of names){const real=m.get(normKey(n));if(real!=null){const v=fields[real];if(v!==''&&v!=null)return v;}}for(const n of names){if(n in fields&&fields[n]!==''&&fields[n]!=null)return fields[n];}return;}
function toNum(v){if(v==null||v==='')return NaN;const n=Number(String(v).replace(',', '.').replace(/[^0-9.]+/g,''));return isFinite(n)?n:NaN;}
function mapDocs(fields){
  const getAttUrl=k=>{
    const v=pickLoose(fields,k);
    if(Array.isArray(v)&&v.length&&v[0]?.url)return v[0].url;
    if(typeof v==='string'&&v)return v;
    return'';
  };
  const fatturaCli=getAttUrl('Fattura - Allegato Cliente');
  const packingCli=getAttUrl('Packing List - Allegato Cliente');
  const ldv=getAttUrl('Allegato LDV')||getAttUrl('Lettera di Vettura');
  const fatturaBO=getAttUrl('Allegato Fattura');
  const dle=getAttUrl('Allegato DLE')||getAttUrl('Dichiarazione Esportazione');
  const plBO=getAttUrl('Allegato PL')||getAttUrl('Packing List');
  const att1=getAttUrl('Allegato 1');
  const att2=getAttUrl('Allegato 2');
  const att3=getAttUrl('Allegato 3');
  const PROFORMA=att1||att2||att3;
  const FDA_PN=att2||att1||att3;
  const EDAS=att3||att2||att1;
  return{
    Lettera_di_Vettura:ldv,
    Fattura_Commerciale:fatturaBO||fatturaCli,
    Fattura_Proforma:PROFORMA,
    Dichiarazione_Esportazione:dle,
    Packing_List:plBO||packingCli,
    FDA_Prior_Notice:FDA_PN,
    'e-DAS':EDAS,
    Fattura_Client:fatturaCli,
    Packing_Client:packingCli,
    Allegato_1:att1,Allegato_2:att2,Allegato_3:att3
  };
}
function colliFromListString(str){
  if(!str)return[];
  return String(str).split(/[;|\n]+/).map(p=>{
    const m=String(p).match(/(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?)\D+(\d+(?:[.,]\d+)?).*?(\d+(?:[.,]\d+)?)/);
    return m?{L:String(m[1]).replace(',', '.'),W:String(m[2]).replace(',', '.'),H:String(m[3]).replace(',', '.'),kg:toNum(m[4])||0}:{L:'-',W:'-',H:'-',kg:0};
  }).filter(x=>x.L!=='-');
}
function buildColliSmart(fields){
  const list=pickLoose(fields,'Lista Colli Ordinata','Lista Colli','Contenuto Colli')||'';
  const a=colliFromListString(list);
  if(a.length)return a;
  const dimStr=pickLoose(fields,'Dimensioni','Dimensioni (cm)','Dim. (cm)','LxWxH','L×W×H','Dim LxWxH','Dimensioni LxWxH');
  let L,W,H;
  if(dimStr){
    const m=String(dimStr).match(/(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i);
    if(m){L=String(m[1]).replace(',', '.');W=String(m[2]).replace(',', '.');H=String(m[3]).replace(',', '.');}
  }
  if(!L)L=pickLoose(fields,'L','L (cm)','Lunghezza','Lunghezza (cm)','Dim L');
  if(!W)W=pickLoose(fields,'W','W (cm)','Larghezza','Larghezza (cm)','Dim W');
  if(!H)H=pickLoose(fields,'H','H (cm)','Altezza','Altezza (cm)','Dim H');
  let kg=toNum(pickLoose(fields,'Peso reale','Peso','Peso (kg)','Peso pezzo'))||0;
  if(L&&W&&H){return[{L:String(L).replace(',', '.'),W:String(W).replace(',', '.'),H:String(H).replace(',', '.'),kg}];}
  return[];
}
function badgeFor(stato){
  if(!stato)return'gray';
  const s=String(stato).toLowerCase();
  if(['pronta alla spedizione','evasa','in transito','consegnata'].includes(s))return'green';
  if(s==='nuova')return'gray';
  return'yellow';
}

/* ===== Normalizzazione record ===== */
export function normalizeShipmentRecord(rec){
  const f = rec.fields || {};
  const idSped = pickLoose(f,'ID Spedizione') || rec.id;
  const email  = pickLoose(f,'Creato da','Creato da email','Mail Cliente');

  // mittente/destinatario…
  const mitt_paese = pickLoose(f,'Mittente - Paese','Mittente – Paese','Paese Mittente');
  const mitt_citta = pickLoose(f,'Mittente - Città','Mittente – Città','Città Mittente');
  const mitt_cap   = pickLoose(f,'Mittente - CAP','Mittente – CAP','CAP Mittente');
  const mitt_indir = pickLoose(f,'Mittente - Indirizzo','Mittente – Indirizzo','Indirizzo Mittente');
  const mitt_tel   = pickLoose(f,'Mittente - Telefono','Mittente – Telefono','Telefono Mittente');
  const mitt_piva  = pickLoose(f,'Mittente - P.IVA/CF','Mittente – P.IVA/CF','PIVA Mittente');
  const mitt_rs    = pickLoose(f,'Mittente - Ragione sociale','Mittente – Ragione sociale','Mittente – ragione sociale','Mittente');
  const mitt_ref   = pickLoose(f,'Mittente - Referente','Referente Mittente','Persona di riferimento Mittente');

  const dest_paese = pickLoose(f,'Destinatario - Paese','Destinatario – Paese','Paese Destinatario');
  const dest_citta = pickLoose(f,'Destinatario - Città','Destinatario – Città','Città Destinatario');
  const dest_cap   = pickLoose(f,'Destinatario - CAP','Destinatario – CAP','CAP Destinatario');
  const dest_indir = pickLoose(f,'Destinatario - Indirizzo','Destinatario – Indirizzo','Indirizzo Destinatario');
  const dest_tel   = pickLoose(f,'Destinatario - Telefono','Destinatario – Telefono','Telefono Destinatario');
  const dest_rs    = pickLoose(f,'Destinatario - Ragione sociale','Destinatario – Ragione sociale','Destinatario – ragione sociale','Destinatario');
  const dest_ref   = pickLoose(f,'Destinatario - Referente','Referente Destinatario','Persona di riferimento Destinatario');

  const dest_piva  = pickLoose(f,'Destinatario - P.IVA/CF','P.IVA/CF Destinatario','PIVA Destinatario','P.IVA Destinatario','CF Destinatario','Codice Fiscale Destinatario');

  const statoNew      = pickLoose(f,'Stato');
  const statoLegacyEv = !!pickLoose(f,'Stato Spedizione');
  const stato         = statoNew || (statoLegacyEv ? 'Evasa' : 'Nuova');

  const ritiroData     = pickLoose(f,'Ritiro - Data','Ritiro – Data','Data Ritiro');
  const incoterm       = pickLoose(f,'Incoterm');
  const tipoSped       = pickLoose(f,'Sottotipo','Tipo Spedizione');
  const trackingNum    = pickLoose(f,'Tracking Number');
  const trackingUrlFld = pickLoose(f,'Tracking URL');

  const pesoTot = Number(pickLoose(f,'Peso reale tot','Peso Reale tot','Peso reale (tot)','Peso tariffato tot','Peso reale','Peso','Peso (kg)') || 0);

  const destImportRaw  = pickLoose(f,'Destinatario abilitato import','Abilitato import destinatario','Import OK Destinatario');
  const dest_import_ok = (()=>{
    if (typeof destImportRaw === 'boolean') return destImportRaw;
    const s = String(destImportRaw || '').trim().toLowerCase();
    return ['si','sì','yes','true','ok','1'].includes(s);
  })();

  const carrier = (()=>{
    const c = pickLoose(f,'Corriere');
    if (!c) return null;
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c.name) return c.name;
    return null;
  })();

  const docs  = { ...mapDocs(f) };
  const colli = Array.isArray(rec.colli) && rec.colli.length ? rec.colli : buildColliSmart(f);

  if (!window.__BO_DEBUG_ONCE__){
    window.__BO_DEBUG_ONCE__ = true;
    console.group('[BO] Debug primo record');
    console.debug('Keys Airtable:', Object.keys(f));
    console.debug('Cliente (dest|mitt):', dest_rs || mitt_rs);
    console.debug('Stato:', stato, 'Ritiro:', ritiroData, 'Carrier:', carrier, 'TN:', trackingNum);
    console.debug('Colli (inline):', colli);
    console.groupEnd();
  }

  return {
    _recId: rec.id,
    _rawFields: f,
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
    mittente_ragione: mitt_rs,
    mittente_referente: mitt_ref,

    // destinatario
    dest_paese: dest_paese,
    dest_citta: dest_citta,
    dest_cap: dest_cap,
    dest_indirizzo: dest_indir,
    dest_telefono: dest_tel,
    dest_ragione: dest_rs,
    dest_referente: dest_ref,
    dest_piva: dest_piva,
    dest_import_ok,

    // tracking
    tracking_carrier: carrier,
    tracking_number: trackingNum,
    tracking_url: trackingUrlFld,

    // stato
    stato,
    _badgeClass: badgeFor(stato),

    // liste
    _peso_tot_kg: pesoTot,
    colli,
    docs,
  };
}

/* ===== UI blocks ===== */
function renderLabelPanel(rec){
  const info = labelInfoFor(rec);
  return `
    <div class="label-panel">
      <div class="label-title">${info.title}</div>
      <div class="label-items">${info.must.map(m=>`<span class="label-badge">${m}</span>`).join('')}</div>
      ${info.extra.length? `<div class="label-note">Note: ${info.extra.join(' • ')}</div>`:''}
    </div>
  `;
}

function renderTrackingBlock(rec){
  const carrierId = `${rec.id}-carrier`;
  const tnId = `${rec.id}-tn`;
  const url = trackingUrl(rec.tracking_carrier, rec.tracking_number) || rec.tracking_url || '#';
  return `
    <div class="track" id="${rec.id}-track">
      <span class="small" style="opacity:.9">Tracking</span>
      <select id="${carrierId}" aria-label="Corriere">
        <option value="">Scegli corriere</option>
        ${CARRIERS.map(c=>`<option value="${c}" ${rec.tracking_carrier===c? 'selected':''}>${c}</option>`).join('')}
      </select>
      <input id="${tnId}" type="text" placeholder="Numero tracking" value="${rec.tracking_number||''}">
      <button class="mini-btn save-tracking" data-carrier="${carrierId}" data-tn="${tnId}">Salva tracking</button>
      <span class="small link">
        ${(rec.tracking_carrier && rec.tracking_number && url && url!=='#')
          ? `<a class="link-orange" href="${url}" target="_blank">Apri tracking</a>`
          : ''}
      </span>
    </div>
  `;
}

/* print-grid */
function renderPrintGrid(rec){
  const colliListHtml = (rec.colli && rec.colli.length)
    ? rec.colli.map(c=>`${c.L}×${c.W}×${c.H}cm ${toKg(c.kg)}`).join(' ; ')
    : '—';

  const fields = [
    ['ID spedizione', rec.id],
    ['Cliente', rec.cliente],
    ['Email cliente', rec.email],
    ['Data ritiro', rec.ritiro_data],
    ['Incoterm', rec.incoterm],
    ['Tipo spedizione', rec.tipo_spedizione],
    ['Peso reale (tot.)', toKg(rec._peso_tot_kg > 0 ? rec._peso_tot_kg : totalPesoKg(rec))],
    ['Mittente – Paese/Città (CAP)', `${rec.mittente_paese||'-'} • ${rec.mittente_citta||'-'} ${rec.mittente_cap?('('+rec.mittente_cap+')'):''}`],
    ['Mittente – Indirizzo', rec.mittente_indirizzo],
    ['Mittente – Telefono', rec.mittente_telefono],
    ['Mittente – P.IVA', rec.piva_mittente],
    ['Destinatario – Paese/Città (CAP)', `${rec.dest_paese||'-'} • ${rec.dest_citta||'-'} ${rec.dest_cap?('('+rec.dest_cap+')'):''}`],
    ['Destinatario – Indirizzo', rec.dest_indirizzo],
    ['Destinatario – Telefono', rec.dest_telefono],
    ['Destinatario – P.IVA/CF', rec.dest_piva || '—'],
  ];

  let html = `<div class="print-grid">`;
  for (const [k,v] of fields){ html += `<div class='k'>${k}</div><div>${v?String(v):'—'}</div>`; }
  html += `<div class='k'>Colli (lista)</div><div id="print-colli-${rec.id}">${colliListHtml}</div>`;
  html += `</div>`;
  return html;
}

/* ===== Render list ===== */

/**
 * Garantisce che esista #list e inietta i CSS.
 * Non fa fetch del template: quello è opzionale (mountStandalone()).
 */
function ensureListContainer() {
  ensureBoAssets(); // CSS assoluti verso spst-logistics
  let el = document.getElementById('list');
  if (el) return el;

  const host = document.getElementById('view-spedizioni') || document.body;
  // Se non è la pagina giusta, non faccio nulla "in anticipo":
  // creo il contenitore solo quando effettivamente chiami renderList.
  el = document.createElement('div'); el.id = 'list'; host.appendChild(el);
  console.warn('[BO] #list non trovato: creato dinamicamente dentro #view-spedizioni');
  return el;
}

export function renderList(
  data,
  {
    onUploadForDoc,
    onSaveTracking,
    onComplete,
    onSendMail,
    onGenerateDoc // ← nuovo handler
  }
){
  const normalized = (data || []).map((rec) => rec && rec.fields ? normalizeShipmentRecord(rec) : rec);

  const elList = ensureListContainer();
  try { elList.innerHTML = ''; } catch (e) { console.error('[BO] impossibile scrivere in #list', e); return; }

  console.debug('[BO] renderList — items:', normalized.length);

  if (!normalized.length){
    elList.innerHTML = '<div class="small" style="opacity:.8">Nessun risultato</div>';
    return;
  }

  normalized.forEach(rec=>{
    const {required, notes, country, tipo} = computeRequiredDocs(rec);
    const missing = required.filter(name => !(rec.docs && rec.docs[name]));
    const badgeClass = rec._badgeClass || (rec.stato === 'Nuova' ? 'gray' : 'yellow');

    const card = document.createElement('div');
    card.className = 'card';
    card.id = `card-${rec.id}`;

    // flags per abilitare/disabilitare i bottoni di generazione
    const hasProforma = !!(rec.docs && rec.docs.Fattura_Proforma);
    const hasCommercial = !!(rec.docs && rec.docs.Fattura_Commerciale);

    card.innerHTML = `
      <div class="card-head" style="display:flex;gap:12px;align-items:center;">
        <div class="title-line" style="display:flex;gap:12px;align-items:center;">
          <span class="id-chip" style="background:#f7911e; color:#111; border-color:rgba(0,0,0,.15)">${rec.id}</span>
          <span class="dest">${rec.cliente}</span>
        </div>

        <div style="margin-left:auto;display:flex;gap:8px;align-items:center;">
          <button class="btn ghost toggle-labels">Verifica etichette</button>
          <button class="btn ghost toggle-details">Espandi record</button>
          <span class="badge ${badgeClass}">${rec.stato||'-'}</span>
        </div>
      </div>

      <div class="kv">
        <div class="k">Email cliente</div><div>${rec.email||'-'}</div>
        <div class="k">Partenza</div><div>${(rec.mittente_paese||'-')} • ${(rec.mittente_citta||'-')} ${(rec.mittente_cap?('('+rec.mittente_cap+')'):'')}</div>
        <div class="k">Indirizzo partenza</div><div>${rec.mittente_indirizzo||'-'}</div>
        <div class="k">Arrivo</div><div>${(rec.dest_paese||rec.paese||'-')} • ${(rec.dest_citta||rec.citta||'-')} ${(rec.dest_cap?('('+rec.dest_cap+')'):'')}</div>
        <div class="k">Indirizzo destinazione</div><div>${rec.dest_indirizzo||'-'}</div>
        <div class="k">Tipo spedizione</div><div>${rec.tipo_spedizione||'-'}</div>
        <div class="k">Incoterm</div><div>${rec.incoterm||'-'}</div>

        <div class="k">Dest. abilitato import</div>
        <div>
          <span class="import-flag ${rec.dest_import_ok ? 'yes' : 'no'}">
            <span class="dot"></span>
            ${rec.dest_import_ok ? 'Abilitato' : 'Non abilitato'}
          </span>
        </div>

        <div class="k">Peso reale</div>
        <div>
          <span class="bo-peso-reale" id="peso-${rec.id}">
            ${toKg(rec._peso_tot_kg > 0 ? rec._peso_tot_kg : totalPesoKg(rec))}
          </span>
        </div>

        <div class="k">Lista colli</div>
        <div class="bo-colli-holder">
          ${(rec.colli&&rec.colli.length)?`
          <table class="colli">
            <thead><tr><th>Dim. (L×W×H cm)</th><th>Peso reale</th></tr></thead>
            <tbody>
              ${rec.colli.map((c)=>`<tr><td>${c.L}×${c.W}×${c.H}</td><td>${toKg(c.kg)}</td></tr>`).join('')}
            </tbody>
          </table>` : '<span class="small">—</span>'}
        </div>
      </div>

      <div class="hr"></div>

      <div class="small" style="margin:4px 0 6px 0"><strong>Documenti necessari per spedire in ${country} (${tipo})</strong>: ${required.join(', ').replaceAll('_',' ')}</div>

      <div class="docs">
        ${required.map(name=>{
          const ok = rec.docs && !!rec.docs[name];
          const cls = ok ? 'ok' : 'missing';
          const templateLink = TEMPLATES[name] ? `<a href="${TEMPLATES[name]}" target="_blank">template</a>` : '';
          const openLink = ok ? `<a href="${rec.docs[name]}" target="_blank">apri</a>` : '';
          const inputId = `${rec.id}-${name}-input`;

          const genBtn = (()=>{
            if (name === 'Fattura_Proforma') {
              return `<button class="mini-btn generate-doc" data-type="proforma" ${ok?'disabled':''}>Genera Proforma</button>`;
            }
            if (name === 'Fattura_Commerciale') {
              return `<button class="mini-btn generate-doc" data-type="commercial" ${ok?'disabled':''}>Genera Commercial</button>`;
            }
            return '';
          })();

          return `<div class="doc ${cls}">
              <strong>${name.replaceAll('_',' ')}</strong>
              ${[openLink, templateLink].filter(Boolean).length? ' · ' + [openLink, templateLink].filter(Boolean).join(' · ') : ''}
              ${genBtn ? ' · ' + genBtn : ''}
              · <button class="mini-btn upload-doc" data-doc="${name}" data-input="${inputId}">Carica</button>
              <input id="${inputId}" type="file" class="hidden per-doc-upload" accept=".pdf,.png,.jpg,.jpeg" data-doc="${name}">
            </div>`;
        }).join('')}
      </div>
      ${notes.length? `<div class="small" style="margin-top:6px; color:#c7cfdf">Note: ${notes.join(' ')}</div>`: ''}

      ${renderLabelPanel(rec)}
      ${renderTrackingBlock(rec)}

      <!-- Notifica cliente -->
      <div class="notify" id="notify-${rec.id}" style="margin-top:10px;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px;">
        <div class="small" style="opacity:.9;margin-bottom:6px">Notifica cliente — digita l’email e invia (richiede tracking salvato)</div>
        <div class="row" style="display:flex;gap:8px;align-items:center;">
          <input
            class="mail-input notify-email"
            type="email"
            placeholder="${rec.email || 'email@cliente.com'}"
            value=""
            inputmode="email"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            style="flex:1;min-width:220px"
          />
          <button class="mini-btn send-mail">Invia mail</button>
          <span class="small" style="opacity:.7">L’indirizzo deve coincidere con quello del record.</span>
        </div>
        <div class="small notify-sent ${rec._mailSent ? '' : 'hidden'}" style="margin-top:6px;color:#6ddf97;">Email inviata ✓</div>
      </div>

      <div class="actions">
        <button class="btn complete" data-id="${rec.id}">Evasione completata</button>
      </div>

      <!-- Dettagli COMPRESSI di default -->
      <div class="details">${renderPrintGrid(rec)}</div>
    `;

    // evidenzia card se checklist completa
    card.classList.toggle('ok-docs', missing.length === 0);

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
    const completeBtn = card.querySelector('.complete');
    if (completeBtn) completeBtn.addEventListener('click', ()=>onComplete(rec));

    // Toggle dettagli (di default COLLASSATI)
    const btnToggle = card.querySelector('.toggle-details');
    const details = card.querySelector('.details');
    if (btnToggle && details){
      btnToggle.textContent = 'Espandi record';
      details.classList.remove('show');
      btnToggle.addEventListener('click', ()=>{
        details.classList.toggle('show');
        btnToggle.textContent = details.classList.contains('show') ? 'Comprimi record' : 'Espandi record';
      });
    }

    // Toggle etichette
    const btnLabels = card.querySelector('.toggle-labels');
    const labelPanel = card.querySelector('.label-panel');
    if (btnLabels && labelPanel){
      btnLabels.addEventListener('click', ()=>{
        labelPanel.classList.toggle('show');
        btnLabels.textContent = labelPanel.classList.contains('show') ? 'Nascondi etichette' : 'Verifica etichette';
      });
    }

    // Salva tracking
    const saveBtn = card.querySelector('.save-tracking');
    if (saveBtn){
      const carrierSel = card.querySelector('#'+saveBtn.dataset.carrier);
      const tnInput = card.querySelector('#'+saveBtn.dataset.tn);
      saveBtn.addEventListener('click', ()=>onSaveTracking(rec, carrierSel?.value || '', tnInput?.value || ''));
    }

    // Invia mail
    const sendBtn   = card.querySelector('.send-mail');
    const emailInput= card.querySelector('.notify-email');
    const sentFlag  = card.querySelector('.notify-sent');
    const canNotify = !!(rec.tracking_carrier && rec.tracking_number);

    if (!canNotify) {
      sendBtn.disabled = true;
      sendBtn.title = 'Disponibile dopo il salvataggio del tracking';
    }
    if (rec._mailSent) {
      sendBtn.disabled = true;
      emailInput.disabled = true;
      sentFlag?.classList.remove('hidden');
    }

    sendBtn?.addEventListener('click', async ()=>{
      const to = (emailInput.value || '').trim();
      await onSendMail(rec, to, { onSuccess: ()=>{
        sendBtn.disabled = true;
        emailInput.disabled = true;
        if (sentFlag) sentFlag.classList.remove('hidden');
      }});
    });

    // Generazione documenti (Proforma/Commercial)
    card.querySelectorAll('.generate-doc').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        const type = btn.dataset.type || 'proforma';
        btn.disabled = true;
        btn.textContent = 'Generazione…';
        try{
          await onGenerateDoc(rec, type);
          btn.textContent = 'Generata ✓';
        }catch(e){
          btn.disabled = false;
          btn.textContent = (type === 'commercial' ? 'Genera Commercial' : 'Genera Proforma');
        }
      });
    });

    // Lazy-load colli se assenti + aggiorna print-grid
    (async ()=>{
      try{
        if (!rec.colli || !rec.colli.length) {
          const holder = card.querySelector('.bo-colli-holder');
          if (holder) holder.innerHTML = '<span class="small">Carico colli…</span>';
          const rows = await fetchColliFor(rec._recId || rec.id);
          if (!document.body.contains(card)) return; // evita update se l'utente ha cambiato vista

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

            const pesoEl = card.querySelector(`#peso-${rec.id}`);
            if (pesoEl) pesoEl.textContent = toKg(totalPesoKg(rec));

            const printCell = card.querySelector(`#print-colli-${rec.id}`);
            if (printCell){
              printCell.textContent = rows.map(c=>`${c.L}×${c.W}×${c.H}cm ${toKg(c.kg)}`).join(' ; ');
            }
          } else if (holder) {
            const fb = buildColliSmart(rec._rawFields || {});
            if (fb.length){
              const html = `
                <table class="colli">
                  <thead><tr><th>Dim. (L×W×H cm)</th><th>Peso reale</th></tr></thead>
                  <tbody>
                    ${fb.map(c=>`<tr><td>${c.L}×${c.W}×${c.H}</td><td>${toKg(c.kg)}</td></tr>`).join('')}
                  </tbody>
                </table>`;
              holder.innerHTML = html;
              rec.colli = fb;
              const pesoEl = card.querySelector(`#peso-${rec.id}`);
              if (pesoEl) pesoEl.textContent = toKg(totalPesoKg(rec));
              const printCell = card.querySelector(`#print-colli-${rec.id}`);
              if (printCell){
                printCell.textContent = fb.map(c=>`${c.L}×${c.W}×${c.H}cm ${toKg(c.kg)}`).join(' ; ');
              }
            } else {
              holder.innerHTML = '<span class="small">—</span>';
            }
          }
        }
      }catch(err){
        console.warn('[BO] fetchColliFor error per', rec.id, err);
      }
    })();

    try { elList.appendChild(card); } catch (e) { console.error('[BO] append card fallito', e); }
  });
}
