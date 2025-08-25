// assets/esm/quotes-admin.js
console.debug('[quotes-admin] boot');

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const root = $('#quotes-admin');
if (!root) {
  console.warn('[quotes-admin] #quotes-admin non trovato');
}

// --- abilita bottoni e collega eventi
function enableAndWireButtons() {
  const createBtns = $$('button[title="Crea preventivo"]', root);
  const draftBtns  = $$('button[title="Salva bozza"]', root);

  // abilita
  [...createBtns, ...draftBtns].forEach(b => {
    if (!b) return;
    b.disabled = false;
    b.removeAttribute('disabled');
  });

  // collega click
  createBtns.forEach(b => {
    b.addEventListener('click', (e) => {
      e.preventDefault();
      handleCreateQuote().catch(err => {
        console.error('[quotes-admin] errore creazione', err);
        alert('Errore durante la creazione del preventivo.');
      });
    }, { once: false });
  });

  console.debug('[quotes-admin] create buttons wired:', createBtns.length);
}

// --- helper per leggere un valore in modo sicuro
const val = (el) => (el && typeof el.value === 'string') ? el.value.trim() : '';

// --- raccoglie i dati dal form
function collectPayload() {
  // Card "Dati cliente" (è la prima section dentro .qa-split)
  const customerCard = $('.qa-split section.card', root);
  const cliente_email = val($('#customer-email', customerCard));
  const valuta        = val($('select', customerCard)) || 'EUR';
  const validita_iso  = val($('input[type="date"]', customerCard)) || null;
  const note_globali  = val($('textarea', customerCard));

  // Mittente (usa i data-field che hai impostato)
  const mitt = $('.qa-inner .qa-sub', root)?.textContent?.includes('Mittente')
    ? $('.qa-inner', root) : null;
  const mittente = {
    sender_name:    val($('[data-field="sender_name"]', root)),
    sender_country: val($('[data-field="sender_country"]', root)),
    sender_city:    val($('[data-field="sender_city"]', root)),
    sender_zip:     val($('[data-field="sender_zip"]', root)),
    sender_address: val($('[data-field="sender_address"]', root)),
    sender_phone:   val($('[data-field="sender_phone"]', root)),
    sender_tax:     val($('[data-field="sender_tax"]', root)),
  };

  // Destinatario (non hai data-field: leggo per posizione nella seconda card "Destinatario")
  const destCard = $$('.qa-inner', root)[1] || null;
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

  // Opzioni (2 card .qa-option). Leggo i campi per placeholder/ordine.
  const opzioni = $$('.qa-option', root).map(opt => {
    const badge = $('.qa-badge', opt)?.textContent?.trim() || '';
    const corriere = val($('input[placeholder^="DHL"]', opt));
    const servizio = val($('input[placeholder*="Express"]', opt));
    const resa     = val($('input[placeholder*="giorni"]', opt));
    const incoterm = val($('input[placeholder^="EXW"]', opt));
    const selects  = $$('select', opt);
    const oneriSel = selects[0];
    const valutaSel= selects[1];
    const prezzo   = Number(val($('input[type="number"][placeholder^="es. 12"]', opt)) || 0);
    const peso     = Number(val($('input[type="number"][placeholder^="es. 2"]', opt)) || 0);
    const note     = val($('textarea', opt));

    return {
      etichetta: badge,
      corriere,
      servizio,
      resa,
      incoterm,
      oneri: val(oneriSel),
      prezzo,
      valuta: val(valutaSel) || 'EUR',
      peso,
      note,
      consigliata: false
    };
  });

  // Termini & visibilità (ultima section)
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

// --- invio al backend
async function handleCreateQuote() {
  const payload = collectPayload();

  if (!payload.cliente_email) {
    alert('Inserisci l’email del cliente.');
    $('#customer-email', root)?.focus();
    return;
  }

  console.debug('[quotes-admin] payload →', payload);

  const r = await fetch('/api/quotes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('[quotes-admin] response error', data);
    throw new Error(data?.error || 'HTTP ' + r.status);
  }

  alert(`Preventivo creato!\nID: ${data.id || '—'}`);
}

// bootstrap
document.addEventListener('DOMContentLoaded', () => {
  if (!root) return;
  enableAndWireButtons();
});
