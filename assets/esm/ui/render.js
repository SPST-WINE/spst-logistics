// assets/esm/ui/render.js
import { TEMPLATES, CARRIERS } from '../config.js';
import { toKg, trackingUrl } from '../utils/misc.js';
import { totalPesoKg } from '../utils/weights.js';
import { labelInfoFor } from '../rules/labels.js';
import { computeRequiredDocs } from '../rules/docs.js';
import { fetchColliFor } from '../airtable/api.js';

/* ──────────────────────────────────────────────────────────────
   Helpers: pick “loose” + mapping
   ────────────────────────────────────────────────────────────── */

function normKey(s){
  return String(s || '')
    .replace(/[–—]/g, '-')      // en/em dash → hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function pickLoose(fields, ...names){
  if (!fields) return undefined;
  var map = {};
  Object.keys(fields).forEach(function(k){ map[normKey(k)] = k; });
  for (var i=0;i<names.length;i++){
    var wanted = names[i];
    var real = map[normKey(wanted)];
    if (real != null) {
      var v = fields[real];
      if (v !== '' && v != null) return v;
    }
  }
  for (var j=0;j<names.length;j++){
    var n = names[j];
    if (n in fields && fields[n] !== '' && fields[n] != null) return fields[n];
  }
  return undefined;
}

function mapDocs(fields) {
  function firstAttUrl(v){
    return (Array.isArray(v) && v.length && v[0] && v[0].url) ? v[0].url : '';
  }
  function getAttUrl(k){
    var v = pickLoose(fields, k);
    if (Array.isArray(v)) return firstAttUrl(v);
    if (typeof v === 'string' && v) return v;
    return '';
  }
  return {
    Lettera_di_Vettura: getAttUrl('Allegato LDV') || getAttUrl('Lettera di Vettura'),
    Fattura_Commerciale: getAttUrl('Allegato Fattura') || getAttUrl('Fattura Commerciale Caricata'),
    Fattura_Proforma: getAttUrl('Fattura Proforma') || '',
    Dichiarazione_Esportazione: getAttUrl('Allegato DLE') || getAttUrl('Dichiarazione Esportazione'),
    Packing_List: getAttUrl('Allegato PL') || getAttUrl('Packing List'),
    FDA_Prior_Notice: getAttUrl('Prior Notice') || '',
    Fattura_Client: getAttUrl('Fattura - Allegato Cliente'),
    Packing_Client: getAttUrl('Packing List - Allegato Cliente')
  };
}

function mapColliFallback(fields) {
  var lista = pickLoose(fields, 'Lista Colli Ordinata', 'Lista Colli', 'Contenuto Colli') || '';
  if (!lista) return [];
  return String(lista).split(/[;|\n]+/).map(function(s){
    var m = String(s).match(/(\d+)\D+(\d+)\D+(\d+).+?(\d+(?:[\.,]\d+)?)/);
    if (!m) return { L: '-', W: '-', H: '-', kg: 0 };
    return { L: m[1], W: m[2], H: m[3], kg: Number(String(m[4]).replace(',', '.')) || 0 };
  });
}

function badgeFor(stato) {
  if (!stato) return 'gray';
  var s = String(stato).toLowerCase();
  if (s === 'pronta alla spedizione' || s === 'evasa' || s === 'in transito' || s === 'consegnata') return 'green';
  if (s === 'nuova') return 'gray';
  return 'yellow';
}

/* ──────────────────────────────────────────────────────────────
   Normalizzazione record Airtable → shape UI
   ────────────────────────────────────────────────────────────── */

export function normalizeShipmentRecord(rec) {
  var f = rec.fields || {};

  var idSped    = pickLoose(f, 'ID Spedizione') || rec.id;
  var email     = pickLoose(f, 'Creato da', 'Creato da email', 'Mail Cliente');

  // Mittente
  var mitt_paese = pickLoose(f, 'Mittente - Paese', 'Mittente – Paese', 'Paese Mittente');
  var mitt_citta = pickLoose(f, 'Mittente - Città', 'Mittente – Città', 'Città Mittente');
  var mitt_cap   = pickLoose(f, 'Mittente - CAP', 'Mittente – CAP', 'CAP Mittente');
  var mitt_indir = pickLoose(f, 'Mittente - Indirizzo', 'Mittente – Indirizzo', 'Indirizzo Mittente');
  var mitt_tel   = pickLoose(f, 'Mittente - Telefono', 'Mittente – Telefono', 'Telefono Mittente');
  var mitt_piva  = pickLoose(f, 'Mittente - P.IVA/CF', 'Mittente – P.IVA/CF', 'PIVA Mittente');
  var mitt_rs    = pickLoose(f, 'Mittente - Ragione sociale', 'Mittente – Ragione sociale', 'Mittente – ragione sociale', 'Mittente');

  // Destinatario
  var dest_paese = pickLoose(f, 'Destinatario - Paese', 'Destinatario – Paese', 'Paese Destinatario');
  var dest_citta = pickLoose(f, 'Destinatario - Città', 'Destinatario – Città', 'Città Destinatario');
  var dest_cap   = pickLoose(f, 'Destinatario - CAP', 'Destinatario – CAP', 'CAP Destinatario');
  var dest_indir = pickLoose(f, 'Destinatario - Indirizzo', 'Destinatario – Indirizzo', 'Indirizzo Destinatario');
  var dest_tel   = pickLoose(f, 'Destinatario - Telefono', 'Destinatario – Telefono', 'Telefono Destinatario');
  var dest_rs    = pickLoose(f, 'Destinatario - Ragione sociale', 'Destinatario – Ragione sociale', 'Destinatario – ragione sociale', 'Destinatario');

  // Stato nuovo / legacy
  var statoNew      = pickLoose(f, 'Stato');
  var statoLegacyEv = !!pickLoose(f, 'Stato Spedizione');
  var stato         = statoNew || (statoLegacyEv ? 'Evasa' : 'Nuova');

  var ritiroData     = pickLoose(f, 'Ritiro - Data', 'Ritiro – Data', 'Data Ritiro');
  var incoterm       = pickLoose(f, 'Incoterm');
  var tipoSped       = pickLoose(f, 'Sottotipo', 'Tipo Spedizione'); // B2B | B2C | Sample
  var trackingNum    = pickLoose(f, 'Tracking Number');
  var trackingUrlFld = pickLoose(f, 'Tracking URL');
  var pesoTot        = Number(pickLoose(f, 'Peso reale tot', 'Peso Reale tot', 'Peso reale (tot)', 'Peso tariffato tot') || 0);
  var carrier        = (function(){
    var c = pickLoose(f, 'Corriere');
    if (!c) return null;
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c.name) return c.name;
    return null;
  })();

  var docs  = mapDocs(f);
  var colli = Array.isArray(rec.colli) ? rec.colli : mapColliFallback(f);

  if (!window.__BO_DEBUG_ONCE__) {
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
    id: idSped,
    cliente: dest_rs || mitt_rs || '(sconosciuto)',
    email: email,

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
    stato: stato,
    _badgeClass: badgeFor(stato),

    // liste
    _peso_tot_kg: pesoTot,
    colli: colli,
    docs: docs
  };
}

/* ──────────────────────────────────────────────────────────────
   UI blocks
   ────────────────────────────────────────────────────────────── */

function renderLabelPanel(rec){
  var info = labelInfoFor(rec);
  return (
    '<div class="label-panel">' +
      '<div class="label-title">'+info.title+'</div>' +
      '<div class="label-items">'+info.must.map(function(m){ return '<span class="label-badge">'+m+'</span>'; }).join('')+'</div>' +
      (info.extra.length? '<div class="label-note">Note: '+info.extra.join(' • ')+'</div>' : '') +
    '</div>'
  );
}

function renderTrackingBlock(rec){
  var carrierId = rec.id+'-carrier';
  var tnId = rec.id+'-tn';
  var url = trackingUrl(rec.tracking_carrier, rec.tracking_number) || rec.tracking_url || '#';
  return (
    '<div class="track" id="'+rec.id+'-track">' +
      '<span class="small" style="opacity:.9">Tracking</span>' +
      '<select id="'+carrierId+'" aria-label="Corriere">' +
        '<option value="">— Corriere —</option>' +
        CARRIERS.map(function(c){ return '<option value="'+c+'" '+(rec.tracking_carrier===c? 'selected':'')+'>'+c+'</option>'; }).join('') +
      '</select>' +
      '<input id="'+tnId+'" type="text" placeholder="Numero tracking" value="'+(rec.tracking_number||'')+'">' +
      '<button class="mini-btn save-tracking" data-carrier="'+carrierId+'" data-tn="'+tnId+'">Salva tracking</button>' +
      '<span class="small link">'+((rec.tracking_carrier && rec.tracking_number && url && url!=='#')? '<a class="link-orange" href="'+url+'" target="_blank">Apri tracking</a>' : '')+'</span>' +
    '</div>'
  );
}

function renderPrintGrid(rec){
  var fields = [
    ['ID spedizione', rec.id],
    ['Cliente', rec.cliente],
    ['Email cliente', rec.email],
    ['Data ritiro', rec.ritiro_data],
    ['Incoterm', rec.incoterm],
    ['Tipo spedizione', rec.tipo_spedizione],
    ['Peso reale (tot.)', toKg(rec._peso_tot_kg > 0 ? rec._peso_tot_kg : totalPesoKg(rec))],
    ['Mittente – Paese/Città (CAP)', (rec.mittente_paese||'-')+' • '+(rec.mittente_citta||'-')+' '+(rec.mittente_cap?('('+rec.mittente_cap+')'):'')],
    ['Mittente – Indirizzo', rec.mittente_indirizzo],
    ['Mittente – Telefono', rec.mittente_telefono],
    ['Mittente – P.IVA', rec.piva_mittente],
    ['Mittente – EORI', rec.mittente_eori],
    ['Destinatario – Paese/Città (CAP)', (rec.dest_paese||'-')+' • '+(rec.dest_citta||'-')+' '+(rec.dest_cap?('('+rec.dest_cap+')'):'')],
    ['Destinatario – Indirizzo', rec.dest_indirizzo],
    ['Destinatario – Telefono', rec.dest_telefono],
    ['Destinatario – EORI', rec.dest_eori],
    ['Colli (lista)', (rec.colli&&rec.colli.length)? rec.colli.map(function(c){ return c.L+'×'+c.W+'×'+c.H+'cm '+toKg(c.kg); }).join(' ; ') : '—']
  ];
  return '<div class="print-grid">'+fields.map(function(pair){
    var k = pair[0], v = pair[1];
    return "<div class='k'>"+k+"</div><div>"+(v?String(v):'—')+"</div>";
  }).join('')+'</div>';
}

/* ──────────────────────────────────────────────────────────────
   Render list
   ────────────────────────────────────────────────────────────── */

function ensureListContainer() {
  var el = document.getElementById('list');
  if (el) return el;
  var host = document.getElementById('view-spedizioni') || document.body;
  el = document.createElement('div');
  el.id = 'list';
  host.appendChild(el);
  console.warn('[BO] #list non trovato: creato dinamicamente dentro #view-spedizioni');
  return el;
}

export function renderList(data, opts){
  opts = opts || {};
  var onUploadForDoc = opts.onUploadForDoc;
  var onSaveTracking = opts.onSaveTracking;
  var onComplete     = opts.onComplete;

  var normalized = (data || []).map(function(rec){ return (rec && rec.fields) ? normalizeShipmentRecord(rec) : rec; });

  var elList = ensureListContainer();
  try { elList.innerHTML = ''; } catch (e) { console.error('[BO] impossibile scrivere in #list', e); return; }

  console.debug('[BO] renderList — items:', normalized.length);

  if (!normalized.length){
    elList.innerHTML = '<div class="small" style="opacity:.8">Nessun risultato</div>';
    return;
  }

  normalized.forEach(function(rec){
    var docInfo = computeRequiredDocs(rec);
    var required = docInfo.required, missing = docInfo.missing, notes = docInfo.notes, country = docInfo.country, tipo = docInfo.tipo;
    var badgeClass = rec._badgeClass || (rec.stato === 'Nuova' ? 'gray' : 'yellow');

    var card = document.createElement('div');
    card.className = 'card';
    card.innerHTML =
      '<div class="row spaced">' +
        '<h3>'+rec.id+' — '+rec.cliente+'</h3>' +
        '<span class="badge '+badgeClass+'">'+(rec.stato||'-')+'</span>' +
      '</div>' +
      '<div class="kv">' +
        '<div class="k">Email cliente</div><div>'+(rec.email||'-')+'</div>' +
        '<div class="k">Partenza</div><div>'+(rec.mittente_paese||'-')+' • '+(rec.mittente_citta||'-')+' '+(rec.mittente_cap?('('+rec.mittente_cap+')'):'')+'</div>' +
        '<div class="k">Indirizzo partenza</div><div>'+(rec.mittente_indirizzo||'-')+'</div>' +
        '<div class="k">Arrivo</div><div>'+((rec.dest_paese||rec.paese||'-')+' • '+(rec.dest_citta||rec.citta||'-')+' '+(rec.dest_cap?('('+rec.dest_cap+')'):'') )+'</div>' +
        '<div class="k">Indirizzo destinazione</div><div>'+(rec.dest_indirizzo||'-')+'</div>' +
        '<div class="k">Tipo spedizione</div><div>'+(rec.tipo_spedizione||'-')+'</div>' +
        '<div class="k">Incoterm</div><div>'+(rec.incoterm||'-')+'</div>' +
        '<div class="k">Peso reale</div><div id="wr-'+rec.id+'">'+toKg(rec._peso_tot_kg > 0 ? rec._peso_tot_kg : totalPesoKg(rec))+'</div>' +
        '<div class="k">Lista colli</div>' +
        '<div class="bo-colli-holder">' +
          ((rec.colli&&rec.colli.length)?
            ('<table class="colli"><thead><tr><th>Dim. (L×W×H cm)</th><th>Peso reale</th></tr></thead><tbody>'+
              rec.colli.map(function(c){ return '<tr><td>'+c.L+'×'+c.W+'×'+c.H+'</td><td>'+toKg(c.kg)+'</td></tr>'; }).join('')+
            '</tbody></table>')
            : '<span class="small">—</span>') +
        '</div>' +
      '</div>' +

      '<div class="hr"></div>' +

      '<div class="small" style="margin:4px 0 6px 0"><strong>Documenti necessari per spedire in '+country+' ('+tipo+')</strong>: '+required.join(', ').split('_').join(' ')+'</div>' +
      '<div class="small" style="opacity:.9; margin-bottom:8px"><em>ATTENZIONE:</em> il destinatario deve necessariamente avere un permesso/abilitazione all\'importazione nel Paese di riferimento.</div>' +

      '<div class="row" style="justify-content:space-between; align-items:center">' +
        '<div class="small" style="margin-bottom:6px">Checklist documenti <span class="badge '+(missing.length? 'yellow':'green')+'" style="margin-left:8px">'+(missing.length?('mancano '+missing.length):'completa')+'</span></div>' +
        '<div class="row" style="gap:8px">' +
          '<button class="btn ghost toggle-labels">Verifica etichette</button>' +
          '<button class="btn ghost toggle-details">Espandi record</button>' +
        '</div>' +
      '</div>' +

      '<div class="docs">' +
        required.map(function(name){
          var ok = rec.docs && !!rec.docs[name];
          var cls = ok ? 'ok' : 'missing';
          var templateLink = TEMPLATES[name] ? '<a href="'+TEMPLATES[name]+'" target="_blank">template</a>' : '';
          var openLink = ok ? '<a href="'+rec.docs[name]+'" target="_blank">apri</a>' : '';
          var inputId = rec.id+'-'+name+'-input';
          var links = [];
          if (openLink) links.push(openLink);
          if (templateLink) links.push(templateLink);
          return '<div class="doc '+cls+'">' +
              '<strong>'+name.split('_').join(' ')+'</strong>' +
              (links.length ? ' · '+links.join(' · ') : '') +
              ' · <button class="mini-btn upload-doc" data-doc="'+name+'" data-input="'+inputId+'">Carica</button>' +
              '<input id="'+inputId+'" type="file" class="hidden per-doc-upload" accept=".pdf,.png,.jpg,.jpeg" data-doc="'+name+'">' +
            '</div>';
        }).join('') +
      '</div>' +
      (notes.length? '<div class="small" style="margin-top:6px; color:#c7cfdf">Note: '+notes.join(' ')+'</div>' : '') +

      renderLabelPanel(rec) +
      renderTrackingBlock(rec) +
      '<div class="details">'+renderPrintGrid(rec)+'</div>' +

      '<div class="actions">' +
        '<button class="btn complete" data-id="'+rec.id+'">Evasione completata</button>' +
      '</div>';

    // Lazy-load colli se non presenti
    (function(){
      if (rec.colli && rec.colli.length) return;
      var holder = card.querySelector('.bo-colli-holder');
      if (holder) holder.innerHTML = '<span class="small">Carico colli…</span>';
      fetchColliFor(rec._recId || rec.id).then(function(rows){
        if (Array.isArray(rows) && rows.length){
          // espandi per Quantità e calcola il peso totale
          var expanded = [];
          var sumKg = 0;
          rows.forEach(function(r){
            var q = Math.max(1, Number(r.quantita || 1));
            var L = (r.L != null ? r.L : (r.lunghezza_cm != null ? r.lunghezza_cm : '-'));
            var W = (r.W != null ? r.W : (r.larghezza_cm  != null ? r.larghezza_cm  : '-'));
            var H = (r.H != null ? r.H : (r.altezza_cm    != null ? r.altezza_cm    : '-'));
            var kg = Number((r.kg != null ? r.kg : (r.peso_kg != null ? r.peso_kg : 0)));
            for (var i=0;i<q;i++) expanded.push({ L:L, W:W, H:H, kg:kg });
            sumKg += kg * q;
          });

          rec.colli = expanded;
          rec._peso_tot_kg = sumKg;

          if (holder){
            holder.innerHTML =
              '<table class="colli">' +
                '<thead><tr><th>Dim. (L×W×H cm)</th><th>Peso reale</th></tr></thead>' +
                '<tbody>' +
                  expanded.map(function(c){ return '<tr><td>'+c.L+'×'+c.W+'×'+c.H+'</td><td>'+toKg(c.kg)+'</td></tr>'; }).join('') +
                '</tbody>' +
              '</table>';
          }

          var wr = card.querySelector('#wr-'+rec.id);
          if (wr) wr.textContent = toKg(sumKg);
        }else{
          if (holder) holder.innerHTML = '<span class="small">—</span>';
        }
      }).catch(function(err){
        console.warn('[BO] fetchColliFor error per', rec.id, err);
      });
    })();

    // Upload per doc
    [].slice.call(card.querySelectorAll('.upload-doc')).forEach(function(btn){
      btn.addEventListener('click', function(){
        var input = card.querySelector('#'+btn.getAttribute('data-input'));
        if (input) input.click();
      });
    });
    [].slice.call(card.querySelectorAll('.per-doc-upload')).forEach(function(inp){
      inp.addEventListener('change', function(e){
        if (onUploadForDoc) onUploadForDoc(e, rec, inp.getAttribute('data-doc'));
      });
    });

    // Complete
    var completeBtn = card.querySelector('.complete');
    if (completeBtn && onComplete) completeBtn.addEventListener('click', function(){ onComplete(rec); });

    // Toggle dettagli
    var btnToggle = card.querySelector('.toggle-details');
    var details = card.querySelector('.details');
    if (btnToggle && details){
      btnToggle.addEventListener('click', function(){
        if (details.classList.contains('show')){ details.classList.remove('show'); btnToggle.textContent = 'Espandi record'; }
        else { details.classList.add('show'); btnToggle.textContent = 'Comprimi record'; }
      });
    }

    // Toggle etichette
    var btnLabels = card.querySelector('.toggle-labels');
    var labelPanel = card.querySelector('.label-panel');
    if (btnLabels && labelPanel){
      btnLabels.addEventListener('click', function(){
        if (labelPanel.classList.contains('show')){ labelPanel.classList.remove('show'); btnLabels.textContent = 'Verifica etichette'; }
        else { labelPanel.classList.add('show'); btnLabels.textContent = 'Nascondi etichette'; }
      });
    }

    // Salva tracking
    var saveBtn = card.querySelector('.save-tracking');
    if (saveBtn && onSaveTracking){
      var carrierSel = card.querySelector('#'+saveBtn.getAttribute('data-carrier'));
      var tnInput = card.querySelector('#'+saveBtn.getAttribute('data-tn'));
      saveBtn.addEventListener('click', function(){
        onSaveTracking(rec, carrierSel ? carrierSel.value : '', tnInput ? tnInput.value : '');
      });
    }

    try { elList.appendChild(card); }
    catch (e) { console.error('[BO] append card fallito', e); }

    console.debug('[BO] card', { id: rec.id, cliente: rec.cliente, colli: (rec.colli ? rec.colli.length : 0) });
  });
}
