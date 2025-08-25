// assets/esm/quotes-admin.js
console.debug('[quotes-admin] boot');

const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const root = $('#quotes-admin');

if (!root) console.warn('[quotes-admin] #quotes-admin non trovato');

// --- Incoterms ---
const INCOTERMS = (() => {
  const fromConf = window.BACK_OFFICE_CONFIG?.INCOTERMS;
  const base = Array.isArray(fromConf) && fromConf.length
    ? fromConf
    : ['EXW','FCA','CPT','CIP','DAP','DPU','DDP','FAS','FOB','CFR','CIF'];
  return base;
})();

function populateIncotermSelects(root = document) {
  const sels = root.querySelectorAll('#quotes-admin .qa-incoterm');
  sels.forEach(sel => {
    sel.innerHTML =
      '<option value="" disabled selected>Seleziona incoterm</option>' +
      INCOTERMS.map(i => `<option value="${i}">${i}</option>`).join('');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  populateIncotermSelects();
});


/* ---------- UI: trasforma i campi "Corriere*" in single-select ---------- */
function upgradeCarrierInputs() {
  const carriers =
    Array.isArray(window.BACK_OFFICE_CONFIG?.CARRIERS) &&
    window.BACK_OFFICE_CONFIG.CARRIERS.length
      ? window.BACK_OFFICE_CONFIG.CARRIERS
      : ['DHL','UPS','FedEx','TNT','Privato']; // fallback

  $$('.qa-option', root).forEach(opt => {
    // trova il contenitore del campo con label "Corriere*"
    const fieldBoxes = $$('.qa-grid.qa-cols-2 > div', opt);
    const corriereBox = fieldBoxes.find(b =>
      $('.qa-label', b)?.textContent?.trim().toLowerCase().startsWith('corriere')
    );
    if (!corriereBox) return;

    const old = $('input, select', corriereBox);

    // crea/select e popola
    const sel = document.createElement('select');
    sel.setAttribute('data-field','carrier');

    // placeholder
    const ph = new Option('Seleziona corriere', '', true, false);
    ph.disabled = true;
    sel.add(ph);
    carriers.forEach(c => sel.add(new Option(c, c)));

    if (old) corriereBox.replaceChild(sel, old);
    else corriereBox.appendChild(sel);
  });

  console.debug('[quotes-admin] carrier selects ready');
}

/* ---------------- Abilita bottoni e collega eventi ---------------- */
function enableAndWireButtons() {
  const createBtns = $$('button[title="Crea preventivo"]', root);
  const draftBtns  = $$('button[title="Salva bozza"]', root);

  [...createBtns, ...draftBtns].forEach(b => { b.disabled = false; b.removeAttribute('disabled'); });

  createBtns.forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      handleCreateQuote().catch(err => {
        console.error('[quotes-admin] errore creazione', err);
        alert('Errore durante la creazione del preventivo.');
      });
    });
  });

  console.debug('[quotes-admin] create buttons wired:', createBtns.length);
}

/* ---------------- Helpers ---------------- */
const val = (el) => (el && typeof el.value === 'string') ? el.value.trim() : '';

/* ---------------- Raccoglie i dati dal form ---------------- */
function collectPayload() {
  // Dati cliente
  const customerCard = $('.qa-split section.card', root);
  const cliente_email = val($('#customer-email', customerCard));
  const valuta        = val($('select', customerCard)) || 'EUR';
  const validita_iso  = val($('input[type="date"]', customerCard)) || null;
  const note_globali  = val($('textarea', customerCard));

  // Mittente
  const mittente = {
    sender_name:    val($('[data-field="sender_name"]', root)),
    sender_country: val($('[data-field="sender_country"]', root)),
    sender_city:    val($('[data-field="sender_city"]', root)),
    sender_zip:     val($('[data-field="sender_zip"]', root)),
    sender_address: val($('[data-field="sender_address"]', root)),
    sender_phone:   val($('[data-field="sender_phone"]', root)),
    sender_tax:     val($('[data-field="sender_tax"]', root)),
  };

  // Destinatario (per posizione nella 2ª card)
  const destCard   = $$('.qa-inner', root)[1] || null;
  const destInputs = destCard ? $$('.qa-grid input', destCard) : [];
  const destinatario = {
    name:    val(destInputs[0]),
    country: val(destInputs[1]),
    city:    val(destInputs[2]),
    zip:     val(destInputs[3]),
    address: val(destInputs[4]),
    phone:   val(destInputs[5]),
    tax:     val(destInputs[6]),
  };

  const note_spedizione = val($('section.card textarea[rows="3"]', root));

  // Opzioni
  const opzioni = $$('.qa-option', root).map(opt => {
    const badge    = $('.qa-badge', opt)?.textContent?.trim() || '';
    const carrier  = $('select[data-field="carrier"]', opt) ||
                     $('select[name="carrier"]', opt) ||
                     $('input[placeholder^="DHL"]', opt); // fallback se non trasformato
    const servizio = $('input[placeholder*="Express"]', opt);
    const resa     = $('input[placeholder*="giorni"]', opt);
    const incoterm = $('input[placeholder^="EXW"]', opt);
    const selects  = $$('select', opt);
    // dopo l'upgrade avremo 2 select: [carrier, oneri] + valuta più avanti
    const oneriSel = selects.find(s => s !== carrier && !s.matches('[data-field="carrier"]'));
    const valutaSel= selects[selects.length - 1];

    const prezzo = Number(val($('input[type="number"][placeholder^="es. 12"]', opt)) || 0);
    const peso   = Number(val($('input[type="number"][placeholder^="es. 2"]', opt)) || 0);
    const note   = val($('textarea', opt));

    return {
      etichetta: badge,
      corriere:  val(carrier),
      servizio:  val(servizio),
      resa:      val(resa),
      incoterm:  val(incoterm),
      oneri:     val(oneriSel),
      prezzo,
      valuta:    val(valutaSel) || 'EUR',
      peso,
      note,
      consigliata: false
    };
  });

  // Termini & visibilità
  const termsSection = $('section.card:last-of-type', root);
  const selects = $$('select', termsSection);
  const versione   = val(selects[0]) || 'v1.0';
  const visibilita = val(selects[1]) || 'Subito';
  const scadenza_giorni = Number(val($('input[type="number"]', termsSection)) || 14);

  return {
    cliente_email,
    valuta,
    validita_iso,
    note_globali,
    mittente,
    destinatario,
    note_spedizione,
    opzioni,
    termini: { versione, visibilita, scadenza_giorni },
  };
}

/* ---------------- Invio al backend ---------------- */
async function handleCreateQuote() {
  const payload = collectPayload();

  if (!payload.cliente_email) {
    alert('Inserisci l’email del cliente.');
    $('#customer-email', root)?.focus();
    return;
  }
  if (payload.opzioni.some(o => !o.corriere)) {
    alert('Scegli il corriere in ogni opzione.');
    return;
  }

  console.debug('[quotes-admin] payload →', payload);

  const r = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || 'HTTP ' + r.status);

  alert(`Preventivo creato!\nID: ${data.id || '—'}`);
}

/* ---------------- Bootstrap ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  if (!root) return;
  upgradeCarrierInputs();   // 👈 rende i corrieri single-select
  enableAndWireButtons();   // 👈 abilita bottoni e collega click
});
