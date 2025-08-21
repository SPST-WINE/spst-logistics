import { TEMPLATES, CARRIERS } from '../config.js';
import { toKg } from '../utils/misc.js';
import { totalPesoKg } from '../utils/weights.js';
import { labelInfoFor } from '../rules/labels.js';
import { computeRequiredDocs } from '../rules/docs.js';
import { trackingUrl } from '../utils/misc.js';

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
  const url = trackingUrl(rec.tracking_carrier, rec.tracking_number);
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
  const elList = document.getElementById('list');
  elList.innerHTML = '';
  if (!data.length){ elList.innerHTML = '<div class="small" style="opacity:.8">Nessun risultato</div>'; return; }

  data.forEach(rec=>{
    const {required, missing, notes, country, tipo} = computeRequiredDocs(rec);
    const badgeClass = rec.stato === 'Pronta alla spedizione' ? 'green' : (rec.stato === 'Nuova' ? 'gray' : 'yellow');

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="row spaced">
        <h3>${rec.id} — ${rec.cliente}</h3>
        <span class="badge ${badgeClass}">${rec.stato}</span>
      </div>
      <div class="kv">
        <div class="k">Email cliente</div><div>${rec.email||'-'}</div>
        <div class="k">Partenza</div><div>${(rec.mittente_paese||'-')} • ${(rec.mittente_citta||'-')} ${(rec.mittente_cap?('('+rec.mittente_cap+')'):'')}</div>
        <div class="k">Indirizzo partenza</div><div>${rec.mittente_indirizzo||'-'}</div>
        <div class="k">Arrivo</div><div>${(rec.dest_paese||rec.paese||'-')} • ${(rec.dest_citta||rec.citta||'-')} ${(rec.dest_cap?('('+rec.dest_cap+')'):'')}</div>
        <div class="k">Indirizzo destinazione</div><div>${rec.dest_indirizzo||'-'}</div>
        <div class="k">Tipo spedizione</div><div>${rec.tipo_spedizione}</div>
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

    // Upload per-doc (mock UI)
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

