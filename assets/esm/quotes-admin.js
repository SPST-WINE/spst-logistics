// assets/esm/quotes-admin.js (estratto)
const root = document.querySelector('#quotes-admin');
if (root) {
  const btnCreate = root.querySelector('.qa-toolbar .btn.primary');
  btnCreate?.addEventListener('click', async (e) => {
    e.preventDefault();

    const email = root.querySelector('#customer-email')?.value?.trim();
    if (!email) return alert('Inserisci email cliente');

    // TODO: mappa tutti i campi reali
    const payload = {
      cliente_email: email,
      valuta: root.querySelector('select')?.value || 'EUR',
      validita_iso: root.querySelector('input[type="date"]')?.value || null,
      opzioni: [
        { etichetta: 'OPZIONE 1', corriere: 'DHL', servizio: 'Express', resa: '2–5 giorni', incoterm: 'DDP', oneri: 'Mittente', prezzo: 120, valuta: 'EUR', peso: 2.5, note: '' },
        { etichetta: 'OPZIONE 2', corriere: 'DHL', servizio: 'Economy', resa: '3–7 giorni', incoterm: 'DAP', oneri: 'Mittente', prezzo: 140, valuta: 'EUR', peso: 3.0, note: '' },
      ],
      termini: { versione: 'v1.0', visibilita: 'Subito', scadenza_giorni: 14 },
    };

    const r = await fetch('/api/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error(data);
      return alert('Errore creazione preventivo');
    }
    alert(`Preventivo creato: ${data.id}`);
  });
}
