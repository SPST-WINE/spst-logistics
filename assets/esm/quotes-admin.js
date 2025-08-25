// assets/esm/quotes-admin.js
(function () {
  const cfg = window.BACK_OFFICE_CONFIG || {};
  const CARRIERS  = cfg.CARRIERS  || ['DHL','FedEx','UPS','TNT','Privato'];
  const INCOTERMS = cfg.INCOTERMS || ['EXW','DAP','DDP'];

  const root = document.getElementById('quotes-admin');
  if (!root) return;

  const $  = (sel, el = root) => el.querySelector(sel);
  const $$ = (sel, el = root) => Array.from(el.querySelectorAll(sel));

  // Toast semplice
  function toast(msg) {
    const t = document.getElementById('toast');
    if (!t) { console.log('[toast]', msg); return; }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  const setText = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };

  function optionHTML(items, placeholder) {
    const ph = `<option value="" disabled selected>${placeholder}</option>`;
    return ph + items.map(v => `<option value="${v}">${v}</option>`).join('');
  }

  // Popola carrier/incoterm su tutte le opzioni presenti
  function hydrateSelects() {
    $$('.qa-option select.qa-carrier').forEach(sel => {
      sel.innerHTML = optionHTML(CARRIERS, 'Seleziona corriere');
      if (!sel.value) sel.value = 'DHL';
    });
    $$('.qa-option select.qa-incoterm').forEach(sel => {
      sel.innerHTML = optionHTML(INCOTERMS, 'Seleziona incoterm');
    });
  }

  function refreshSummary() {
    const email    = $('#customer-email')?.value?.trim();
    const validity = $('#quote-validity')?.value || '';
    const currency = $('#quote-currency')?.value || 'EUR';

    setText('#sum-customer', email || '—');
    setText('#sum-validity', validity || '—');
    setText('#sum-currency', currency || 'EUR');

    const opts = $$('.qa-option');
    setText('#sum-options', `${opts.length} bozza`);
  }

  function isValid() {
    const email = $('#customer-email')?.value?.trim();
    if (!email || !email.includes('@')) return false;

    // almeno una opzione completa
    const okOption = $$('.qa-option').some(box => {
      const carrier = $('.qa-carrier', box)?.value;
      const incot   = $('.qa-incoterm', box)?.value;
      const price   = parseFloat($('.qa-price', box)?.value || '');
      return !!carrier && !!incot && !isNaN(price) && price > 0;
    });
    return okOption;
  }

  function updateButtonsState() {
    const enable = isValid();
    ['#btn-create', '.qa-header .btn.primary', '#btn-preview', '.qa-header .btn.ghost']
      .map(sel => $(sel))
      .filter(Boolean)
      .forEach((b, i) => b.disabled = !enable);
  }

  function collectPayload() {
    return {
      customer: {
        email: $('#customer-email')?.value?.trim(),
        currency: $('#quote-currency')?.value || 'EUR',
        valid_until: $('#quote-validity')?.value || null,
        notes: $('#quote-notes')?.value?.trim() || ''
      },
      shipment: {
        sender: {
          name:   $('[data-field="sender_name"]')?.value || '',
          country:$('[data-field="sender_country"]')?.value || '',
          city:   $('[data-field="sender_city"]')?.value || '',
          zip:    $('[data-field="sender_zip"]')?.value || '',
          address:$('[data-field="sender_address"]')?.value || '',
          phone:  $('[data-field="sender_phone"]')?.value || '',
          tax:    $('[data-field="sender_tax"]')?.value || ''
        },
        recipient: {
          name:   $('[data-field="rcpt_name"]')?.value || '',
          country:$('[data-field="rcpt_country"]')?.value || '',
          city:   $('[data-field="rcpt_city"]')?.value || '',
          zip:    $('[data-field="rcpt_zip"]')?.value || '',
          address:$('[data-field="rcpt_address"]')?.value || '',
          phone:  $('[data-field="rcpt_phone"]')?.value || '',
          tax:    $('[data-field="rcpt_tax"]')?.value || ''
        },
        notes: $('#shipment-notes')?.value || ''
      },
      options: $$('.qa-option').map(box => ({
        carrier: $('.qa-carrier', box)?.value || '',
        service: $('.qa-service', box)?.value?.trim() || '',
        transit_time: $('.qa-transit', box)?.value?.trim() || '',
        incoterm: $('.qa-incoterm', box)?.value || '',
        payer: $('.qa-payer', box)?.value || '',
        price: parseFloat($('.qa-price', box)?.value || '0') || 0,
        currency: $('.qa-currency', box)?.value || 'EUR',
        weight: parseFloat($('.qa-weight', box)?.value || '0') || 0,
        notes: $('.qa-notes', box)?.value?.trim() || ''
      })),
      meta: {
        terms_version: $('#terms-version')?.value || 'v1.0',
        link_visibility: $('#link-visibility')?.value || 'Subito',
        link_expiry_days: parseInt($('#link-expiry')?.value || '14', 10) || 14
      }
    };
  }

  function bindAutoUI() {
    root.addEventListener('input',  () => { refreshSummary(); updateButtonsState(); }, true);
    root.addEventListener('change', () => { refreshSummary(); updateButtonsState(); }, true);
  }

  async function handleCreate() {
    const payload = collectPayload();
    console.log('[quotes] payload', payload);
    toast('Anteprima invio (mock). Vedi console per il payload.');
  }

  function initButtons() {
    const createBtns  = ['#btn-create', '.qa-header .btn.primary'].map(sel => $(sel)).filter(Boolean);
    const previewBtns = ['#btn-preview', '.qa-header .btn.ghost'].map(sel => $(sel)).filter(Boolean);
    createBtns.forEach(b => b.addEventListener('click', handleCreate));
    previewBtns.forEach(b => b.addEventListener('click', () => {
      console.log('[quotes] anteprima', collectPayload());
      toast('Anteprima cliente (mock).');
    }));
  }

  hydrateSelects();
  bindAutoUI();
  refreshSummary();
  updateButtonsState();
  initButtons();
})();
