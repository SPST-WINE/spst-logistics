// api/quotes/index.js
export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN || process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  const TB_PREVENTIVI = process.env.TB_PREVENTIVI || 'Preventivi';
  const TB_OPZIONI = process.env.TB_OPZIONI || 'OpzioniPreventivo';

  if (!token || !baseId) {
    return res.status(500).json({ error: 'Missing Airtable configuration' });
  }

  const at = (table) =>
    `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  try {
    if (req.method === 'GET') {
      // opzionale: filtri ?email= o ?id=
      const url = new URL(at(TB_PREVENTIVI));
      if (req.query.email) {
        // cambia "Email_cliente" con il nome del tuo campo email in Airtable
        url.searchParams.set(
          'filterByFormula',
          `FIND(LOWER("${String(req.query.email).toLowerCase()}"), LOWER({Email_cliente}))`
        );
      }
      url.searchParams.set('pageSize', '10');
      const r = await fetch(url.toString(), { headers });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const body = req.body ?? {};
      const {
        cliente_email,
        valuta,
        validita_iso,          // YYYY-MM-DD
        note_globali,
        mittente = {},
        destinatario = {},
        note_spedizione,
        opzioni = [],          // array di opzioni
        termini = {},          // { versione, visibilita, scadenza_giorni }
      } = body;

      // calcolo scadenza link (se passato)
      let scadenzaISO = null;
      if (termini?.scadenza_giorni) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() + Number(termini.scadenza_giorni));
        scadenzaISO = d.toISOString();
      }

      // 1) Crea record su "Preventivi"
      // -----> CAMBIA i nomi dei campi in base alla tua tabella <-----
      const preventivoFields = {
        'Email_cliente': cliente_email || '',
        'Valuta': valuta || 'EUR',
        'Validita_preventivo': validita_iso || null, // field "date" in Airtable
        'Note_globali': note_globali || '',
        // Mittente
        'Mittente_Nome': mittente.sender_name || '',
        'Mittente_Paese': mittente.sender_country || '',
        'Mittente_Citta': mittente.sender_city || '',
        'Mittente_CAP': mittente.sender_zip || '',
        'Mittente_Indirizzo': mittente.sender_address || '',
        'Mittente_Telefono': mittente.sender_phone || '',
        'Mittente_Tax': mittente.sender_tax || '',
        // Destinatario
        'Destinatario_Nome': destinatario.name || '',
        'Destinatario_Paese': destinatario.country || '',
        'Destinatario_Citta': destinatario.city || '',
        'Destinatario_CAP': destinatario.zip || '',
        'Destinatario_Indirizzo': destinatario.address || '',
        'Destinatario_Telefono': destinatario.phone || '',
        'Destinatario_Tax': destinatario.tax || '',
        // Note
        'Note_spedizione': note_spedizione || '',
        // Termini & visibilità
        'Versione_termini': termini.versione || 'v1.0',
        'Visibilita_link': termini.visibilita || 'Subito',
        'Scadenza_link': scadenzaISO, // campo data/ora
      };

      const r1 = await fetch(at(TB_PREVENTIVI), {
        method: 'POST',
        headers,
        body: JSON.stringify({ records: [{ fields: preventivoFields }] }),
      });
      const created = await r1.json();

      if (!r1.ok) {
        return res.status(400).json({ error: 'Airtable create error', details: created });
      }

      const preventivoId = created?.records?.[0]?.id;
      if (!preventivoId) {
        return res.status(500).json({ error: 'Missing created record id' });
      }

      // 2) Crea opzioni col link al preventivo
      if (Array.isArray(opzioni) && opzioni.length) {
        // -----> CAMBIA i nomi dei campi in base alla tua tabella Opzioni <-----
        const optionRecords = opzioni.map((o) => ({
          fields: {
            'Preventivo': [preventivoId],               // campo "Link a Preventivi"
            'Etichetta': o.etichetta || '',            // "OPZIONE 1" ecc.
            'Corriere': o.corriere || '',
            'Servizio': o.servizio || '',
            'Tempo_resa_previsto': o.resa || '',
            'Incoterm': o.incoterm || '',
            'Oneri_a_carico_di': o.oneri || '',
            'Prezzo': typeof o.prezzo === 'number' ? o.prezzo : Number(o.prezzo || 0),
            'Valuta': o.valuta || 'EUR',
            'Peso_reale_kg': typeof o.peso === 'number' ? o.peso : Number(o.peso || 0),
            'Note_operative': o.note || '',
            'Consigliata': !!o.consigliata,
          },
        }));

        const r2 = await fetch(at(TB_OPZIONI), {
          method: 'POST',
          headers,
          body: JSON.stringify({ records: optionRecords }),
        });
        const createdOpts = await r2.json();
        if (!r2.ok) {
          return res.status(400).json({ error: 'Airtable options create error', details: createdOpts });
        }
      }

      return res.status(201).json({ ok: true, id: preventivoId });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Unexpected error', details: String(err) });
  }
}
