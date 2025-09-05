import { TEMPLATES, CARRIERS } from '../config.js';
import { toKg } from '../utils/misc.js';
import { totalPesoKg } from '../utils/weights.js';
import { labelInfoFor } from '../rules/labels.js';
import { computeRequiredDocs } from '../rules/docs.js';
import { trackingUrl } from '../utils/misc.js';

/* ──────────────────────────────────────────────────────────────
   ADAPTER: normalizza record Airtable (nuovo/legacy) → UI shape
   ────────────────────────────────────────────────────────────── */

function pick(fields, ...names) {
  for (const n of names) {
    if (n in fields && fields[n] != null && fields[n] !== '') return fields[n];
  }
  return undefined;
}

function mapDocs(fields) {
  const getAttUrl = (k) => {
    const v = fields[k];
    if (Array.isArray(v) && v.length && v[0]?.url) return v[0].url;
    if (typeof v === 'string' && v) return v; // legacy link
    return '';
  };
  return {
    // nomi attesi da computeRequiredDocs/render
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

function mapColliFallback(fields) {
  // Solo se non hai già colli strutturati dal backend; parse grezza da "Lista Colli"
  const lista = pick(fields, 'Lista Colli') || '';
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
  if (s === 'pronta alla spedizione' || s === 'evasa') return 'green';
  if (s === 'nuova') return 'gray';
  return 'yellow';
}

export function normalizeShipmentRecord(rec /* { id, fields } di Airtable */) {
  const f = rec.fields || {};

  const idSped = pick(f, 'ID Spedizione') || rec.id;
  const email = pick(f, 'Creato da', 'Mail Cliente');

  // Mittente
  const mitt_paese = pick(f, 'Mittente - Paese', 'Paese Mittente');
  const mitt_citta = pick(f, 'Mittente - Città', 'Città Mittente');
  const mitt_cap = pick(f, 'Mittente - CAP', 'CAP Mittente');
  const mitt_indir = pick(f, 'Mittente - Indirizzo', 'Indirizzo Mittente');
  const mitt_tel = pick(f, 'Mittente - Telefono', 'Telefono Mittente');
  const mitt_piva = pick(f, 'Mittente - P.IVA/CF', 'PIVA Mittente');
  const mitt_rs = pick(f, 'Mittente - Ragione sociale', 'Mittente');

  // Destinatario
  const dest_paese = pick(f, 'Destinatario - Paese', 'Paese Destinatario');
  const dest_citta = pick(f, 'Destinatario - Città', 'Città Destinatario');
  const dest_cap = pick(f, 'Destinatario - CAP', 'CAP Destinatario');
  const dest_indir = pick(f, 'Destinatario - Indirizzo', 'Indirizzo Destinatario');
  const dest_tel = pick(f, 'Destinatario - Telefono', 'Telefono Destinatario');
  const dest_rs = pick(f, 'Destinatario - Ragione sociale', 'Destinatario');

  // Stato nuovo (single select) + compat legacy
  const statoNew = pick(f, 'Stato');
  const statoLegacyEv = !!pick(f, 'Stato Spedizione');
  const stato = statoNew || (statoLegacyEv ? 'Evasa' : 'Nuova');

  const ritiroData = pick(f, 'Ritiro - Data', 'Data Ritiro');
  const incoterm = pick(f, 'Incoterm');
  const tipoSped = pick(f, 'Sottotipo', 'Tipo Spedizione'); // B2B/B2C/Sample
  const trackingNum = pick(f, 'Tracking Number');
  const trackingUrlField = pick(f, 'Tracking URL');
  const carrier = pick(f, 'Corriere');

  const docs = mapDocs(f);
  const colli = Array.isArray(rec.colli) ? rec.colli : mapColliFallback(f);

  return {
    // chiavi usate dalla UI
    id: idSped,
    cliente: dest_rs || mitt_rs || '(sconosciuto)',
    email,

    ritiro_data: ritiroData || '-',
    incoterm: incoterm || '-',
    tipo_spedizione: tipoSped || '-',

    // mittente
    mittente_paese: mitt_paese,
    mittente_citta: mitt_citta,
    mittente_cap: mitt_cap,
    mittente_indirizzo: mitt_indir,
    mittente_telefono: mitt_tel,
    piva_mittente: mitt_piva,
    mittente_eori: pick(f, 'Mittente EORI'),

    // destinatario
    dest_paese: dest_paese,
    dest_citta: dest_citta,
    dest_cap: dest_cap,
    dest_indirizzo: dest_indir,
    dest_telefono: dest_tel,
    dest_eori: pick(f, 'Codice EORI Destinatario Fattura', 'Destinatario EORI'),

    // tracking
    tracking_carrier: carrier,
    tracking_number: trackingNum,
    tracking_url: trackingUrlField,

    // stato
    stato,
    _badgeClass: badgeFor(stato),

    // liste
    colli,
    docs,
  };
}

/* ──────────────────────────────────────────────────────────────
   RENDER UI (immutato, usa i campi normalizzati sopra)
   ────────────────────────────────────────────────────────────── */

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
        <option value="">— Corriere —</option>
        ${CARRIERS.map(c=>`<option value="${c}" ${rec.tracking_carrier===c? 'selected':''}>${c}</option>`).join('')}
      </select>
      <input id="${tnId}" type="text" placeholder="Numero tracking" value="${rec.tracking_number||''}">
      <button class="mini-btn save-tracking" data-carrier="${carrierId}" data-tn="${tnId}">Salva tracking</button>
      <span class="small link">${(rec.tracking_carrier && rec.tracking_number && url && url!=='#')? `<a class="link-orange" href="${url}" target="_blank">Apri tracking</a>` : ''}</span>
    </div>
  `;
}

function renderPrintGrid(rec){
  const fields = [
    ['ID spedizione', rec.id],
    ['Cliente', rec.cliente],
    ['Email cliente', rec.email],
    ['Data ritiro', rec.ritiro_data],
    ['Incoterm', rec.incoterm],
    ['Tipo spedizione', rec.tipo_spedizione],
    ['Peso reale (tot.)', toKg(totalPesoKg(rec))],
    ['Mittente – Paese/Città (CAP)', `${rec.mittente_paese||'-'} • ${rec.mittente_citta||'-'} ${rec.mittente_cap?('('+rec.mittente_cap+')'):''}`],
    ['Mittente – Indirizzo', rec.mittente_indirizzo],
    ['Mittente – Telefono', rec.mittente_telefono],
    ['Mittente – P.IVA', rec.piva_mittente],
    ['Mittente – EORI', rec.mittente_eori],
    ['Destinatario – Paese/Città (CAP)', `${rec.dest_paese||'-'} • ${rec.dest_citta||'-'} ${rec.dest_cap?('('+rec.dest_cap+')'):''}`],
    ['Destinatario – Indirizzo', rec.dest_indirizzo],
    ['Destinatario – Telefono', rec.dest_telefono],
    ['Destinatario – EORI', rec.dest_eori],
    ['Colli (lista)', (rec.colli&&rec.colli.length)? rec.colli.map(c=>`${c.L}×${c.W}×${c.H}cm ${c.kg}kg`).join(' ; ') : '—']
  ];
  return `<div class="print-grid">${fields.map(([k,v])=>`<div class='k'>${k}</div><div>${v?String(v):'—'}</div>`).join('')}</div>`;
}

export function renderList(data, {onUploadForDoc, onSaveTracking, onComplete}){
  // 🔑 Normalizza i record prima del rendering
  const normalized = (data || []).map((rec) => {
    // se arriva già come {id, fields} (Airtable), normalizza
    if (rec && rec.fields) return normalizeShipmentRecord(rec);
    // se è già nel formato UI, lascialo com'è
    return rec;
  });

  const elList = document.getElementById('list');
  elList.innerHTML = '';
  if (!normalized.length){ elList.innerHTML = '<div class="small" style="opacity:.8">Nessun risultato</div>'; return; }

  normalized.forEach(rec=>{
    const {required, missing, notes, country, tipo} = computeRequiredDocs(rec);
    const badgeClass = rec._badgeClass || (rec.stato === 'Nuova' ? 'gray' : 'yellow');

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
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
        <div>
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
      <div class="small" style="opacity:.9; margin-bottom:8px"><em>ATTENZIONE:</em> il destinatario deve necessariamente avere un permesso/abilitazione all'importazione nel Paese di riferimento.</div>

      <div class="row" style="justify-content:space-between; align-items:center">
        <div class="small" style="margin-bottom:6px">Checklist documenti <span class="badge ${missing.length? 'yellow':'green'}" style="margin-left:8px">${missing.length?`mancano ${missing.length}`:'completa'}</span></div>
        <div class="row" style="gap:8px">
          <button class="btn ghost toggle-labels">Verifica etichette</button>
          <button class="btn ghost toggle-details">Espandi record</button>
        </div>
      </div>

      <div class="docs">
        ${required.map(name=>{
          const ok = rec.docs && !!rec.docs[name];
          const cls = ok ? 'ok' : 'missing';
          const templateLink = TEMPLATES[name] ? `<a href="${TEMPLATES[name]}" target="_blank">template</a>` : '';
          const openLink = ok ? `<a href="${rec.docs[name]}" target="_blank">apri</a>` : '';
          const inputId = `${rec.id}-${name}-input`;
          return `<div class="doc ${cls}">
              <strong>${name.replaceAll('_',' ')}</strong>
              ${[openLink, templateLink].filter(Boolean).length? ' · ' + [openLink, templateLink].filter(Boolean).join(' · ') : ''}
              · <button class="mini-btn upload-doc" data-doc="${name}" data-input="${inputId}">Carica</button>
              <input id="${inputId}" type="file" class="hidden per-doc-upload" accept=".pdf,.png,.jpg,.jpeg" data-doc="${name}">
            </div>`;
        }).join('')}
      </div>
      ${notes.length? `<div class="small" style="margin-top:6px; color:#c7cfdf">Note: ${notes.join(' ')}</div>`: ''}

      ${renderLabelPanel(rec)}
      ${renderTrackingBlock(rec)}
      <div class="details">${renderPrintGrid(rec)}</div>

      <div class="actions">
        <button class="btn complete" data-id="${rec.id}">Evasione completata</button>
      </div>
    `;

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

    elList.appendChild(card);
  });
}
