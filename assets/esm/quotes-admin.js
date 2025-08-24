// quotes-admin.js
const ROOT = document.getElementById('quotes-admin');
if (ROOT) {
  const emailInput = ROOT.querySelector('#customer-email');

  // ---- Helper API
  async function fetchSenderByEmail(email) {
    const res = await fetch(`/api/quotes/lookup?email=${encodeURIComponent(email)}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    if (res.status === 204) return null;
    return res.json();
  }
  function fillSender(data) {
    if (!data) return;
    for (const [k, v] of Object.entries(data)) {
      const el = ROOT.querySelector(`[data-field="${k}"]`);
      if (el && !el.value) el.value = v;
    }
  }

  // ---- Autofill al change/blur
  const handler = async () => {
    const email = emailInput?.value.trim();
    if (!email) return;
    const data = await fetchSenderByEmail(email);
    fillSender(data);
  };
  if (emailInput) {
    emailInput.addEventListener('change', handler);
    emailInput.addEventListener('blur', handler);
  }

  // ---- (Prossimo step) Creazione preventivo
  async function createQuote(payload) {
    const res = await fetch('/api/quotes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Create failed');
    return res.json(); // { quoteId, publicSlug }
  }
  // TODO: bind al click del bottone quando usciamo dal mock.
}
