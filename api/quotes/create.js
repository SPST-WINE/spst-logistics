// api/quotes/create.js
// Node runtime (Next/Vercel API). Crea un Preventivo e le Opzioni collegate su Airtable.

// api/quotes/create.js
const allowlist = (process.env.ORIGIN_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const allowed = allowlist.includes(origin);
  const headers = {
    'Access-Control-Allow-Origin': allowed ? origin : '*',
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
  Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (setCors(req, res)) return;

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' }); return;
  }

  try {
    const payload = req.body || {};
    // TODO: crea record in "Preventivi" + "OpzioniPreventivo" su Airtable
    res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
}


export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).send('ok');
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      AIRTABLE_TOKEN,
      AIRTABLE_BASE_ID,
      TB_PREVENTIVI,
      TB_OPZIONI,
    } = process.env;

    if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID || !TB_PREVENTIVI || !TB_OPZIONI) {
      return res.status(500).json({ error: 'Missing Airtable env vars' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // --- VALIDAZIONE MINIMA ---
    const email = body?.cliente?.email || '';
    const opzioni = Array.isArray(body?.opzioni) ? body.opzioni : [];
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Email cliente non valida' });
    }
    const opzioniValid = opzioni.filter(
      (o) => o && o.corriere && o.servizio && o.incoterm && o.prezzo
    );
    if (opzioniValid.length < 1) {
      return res.status(400).json({ error: 'Almeno 1 opzione completa è richiesta' });
    }

    // --- HELPER: chiamata Airtable REST ---
    const AT = async (table, payload) => {
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(table)}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Airtable ${table} ${r.status}: ${t}`);
      }
      return r.json();
    };

    // --- MAPPATURA CAMPI (adattali ai nomi reali in base) ---
    const m = {
      preventivo: {
        email: 'Email cliente',
        valuta: 'Valuta',
        validita: 'Validità preventivo',
        note: 'Note globali',
        stato: 'Stato',
        visibilita: 'Visibilità link pubblico',
        scadenzaGiorni: 'Scadenza link (giorni)',

        // Mittente
        s_ragione: 'Mittente - Ragione/Nome',
        s_paese: 'Mittente - Paese',
        s_citta: 'Mittente - Città',
        s_cap: 'Mittente - CAP',
        s_indirizzo: 'Mittente - Indirizzo',
        s_tel: 'Mittente - Telefono',
        s_tax: 'Mittente - P.IVA/EORI',

        // Destinatario
        d_ragione: 'Destinatario - Ragione/Nome',
        d_paese: 'Destinatario - Paese',
        d_citta: 'Destinatario - Città',
        d_zip: 'Destinatario - CAP/ZIP',
        d_indirizzo: 'Destinatario - Indirizzo',
        d_tel: 'Destinatario - Telefono',
        d_tax: 'Destinatario - Tax ID/EORI',

        // Altri
        noteSped: 'Note spedizione',
        slug: 'Slug',                 // opzionale (se la colonna non esiste Airtable lo ignora)
        publicUrl: 'Link pubblico',   // opzionale
      },
      opzione: {
        link: 'Preventivo',                // field "Link to Preventivi"
        corriere: 'Corriere',
        servizio: 'Servizio',
        transit: 'Tempo di resa',
        incoterm: 'Incoterm',
        payer: 'Oneri a carico di',
        prezzo: 'Prezzo',
        valuta: 'Valuta',
        peso: 'Peso (kg)',
        note: 'Note operative',
        consigliata: 'Consigliata',        // checkbox opzionale
      },
    };

    // --- Costruzione record Preventivo ---
    const termini = body?.termini || {};
    const stato =
      termini?.visibilita === 'Subito' ? 'Inviato' : 'Bozza';

    const slug = (Math.random().toString(36).slice(2, 8) + Date.now().toString(36)).toLowerCase();
    const publicUrl =
      termini?.visibilita === 'Subito'
        ? `https://spst-logistics.vercel.app/q/${slug}`
        : '';

    const pFields = {
      [m.preventivo.email]: email,
      [m.preventivo.valuta]: body?.cliente?.valuta || 'EUR',
      [m.preventivo.validita]: body?.cliente?.validita || null,
      [m.preventivo.note]: body?.cliente?.note || '',
      [m.preventivo.stato]: stato,
      [m.preventivo.visibilita]: termini?.visibilita || 'Subito',
      [m.preventivo.scadenzaGiorni]: Number(termini?.scadenzaGiorni || 14),

      [m.preventivo.s_ragione]: body?.mittente?.ragioneSociale || '',
      [m.preventivo.s_paese]: body?.mittente?.paese || '',
      [m.preventivo.s_citta]: body?.mittente?.citta || '',
      [m.preventivo.s_cap]: body?.mittente?.cap || '',
      [m.preventivo.s_indirizzo]: body?.mittente?.indirizzo || '',
      [m.preventivo.s_tel]: body?.mittente?.telefono || '',
      [m.preventivo.s_tax]: body?.mittente?.pivaEori || '',

      [m.preventivo.d_ragione]: body?.destinatario?.ragioneSociale || '',
      [m.preventivo.d_paese]: body?.destinatario?.paese || '',
      [m.preventivo.d_citta]: body?.destinatario?.citta || '',
      [m.preventivo.d_zip]: body?.destinatario?.zip || '',
      [m.preventivo.d_indirizzo]: body?.destinatario?.indirizzo || '',
      [m.preventivo.d_tel]: body?.destinatario?.telefono || '',
      [m.preventivo.d_tax]: body?.destinatario?.taxIdEori || '',

      [m.preventivo.noteSped]: body?.noteSpedizione || '',
      [m.preventivo.slug]: slug,
      [m.preventivo.publicUrl]: publicUrl,
    };

    const createdPrev = await AT(TB_PREVENTIVI, { fields: pFields });
    const prevId = createdPrev?.id;
    if (!prevId) throw new Error('Impossibile creare il record Preventivo');

    // --- Creazione Opzioni collegate ---
    const records = opzioniValid.map((opt) => ({
      fields: {
        [m.opzione.link]: [prevId],
        [m.opzione.corriere]: opt.corriere,
        [m.opzione.servizio]: opt.servizio,
        [m.opzione.transit]: opt.transitTime || '',
        [m.opzione.incoterm]: opt.incoterm,
        [m.opzione.payer]: opt.onericario || '',
        [m.opzione.prezzo]: Number(opt.prezzo),
        [m.opzione.valuta]: opt.valuta || 'EUR',
        [m.opzione.peso]: Number(opt.pesoRealeKg || 0),
        [m.opzione.note]: opt.note || '',
        [m.opzione.consigliata]: !!opt.consigliata,
      },
    }));

    const createdOpts = await AT(TB_OPZIONI, { records });

    return res.status(201).json({
      ok: true,
      quoteId: prevId,
      optionIds: (createdOpts?.records || []).map((r) => r.id),
      publicUrl: publicUrl || null,
      slug,
    });
  } catch (err) {
    console.error('[quotes/create] error', err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}

// /api/quotes/create.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, TB_PREVENTIVI, TB_OPZIONI } = process.env;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error:'Method not allowed' });
  try {
    const { quote, options } = req.body || {};
    if (!quote?.Email_Cliente) return res.status(400).json({ error:'Email_Cliente mancante' });

    // 1) CREA PREVENTIVO
    const r1 = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TB_PREVENTIVI!)}`,{
      method:'POST',
      headers:{ 'Authorization':`Bearer ${AIRTABLE_TOKEN}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ fields: quote })
    });
    const j1 = await r1.json();
    if (!r1.ok) return res.status(r1.status).json(j1);
    const quoteId = j1.id as string;

    // 2) CREA OPZIONI (se presenti)
    const opts = Array.isArray(options) ? options.filter(Boolean) : [];
    if (opts.length) {
      const payload = {
        records: opts.map(o => ({
          fields: { ...o, Preventivo: [quoteId] }
        }))
      };
      const r2 = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TB_OPZIONI!)}`,{
        method:'POST',
        headers:{ 'Authorization':`Bearer ${AIRTABLE_TOKEN}`, 'Content-Type':'application/json' },
        body: JSON.stringify(payload)
      });
      const j2 = await r2.json();
      if (!r2.ok) return res.status(r2.status).json(j2);
    }

    return res.status(200).json({ id: quoteId });
  } catch (e:any) {
    return res.status(500).json({ error: e?.message || 'create failed' });
  }
}
