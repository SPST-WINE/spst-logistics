import { withCORS } from "../_lib/cors.js";
import {
  createRecord,
  createRecords,
  TB_PREVENTIVI,
  TB_OPZIONI
} from "../_lib/airtable.js";

function requireEnv() {
  const missing = [];
  if (!process.env.AIRTABLE_BASE_ID) missing.push("AIRTABLE_BASE_ID");
  if (!process.env.AIRTABLE_TOKEN)   missing.push("AIRTABLE_TOKEN");
  if (missing.length) {
    throw new Error("Missing env: " + missing.join(", "));
  }
}

// Mapping helper: adatta i nomi campo ai tuoi esatti header Airtable
function mapPreventivoFields(payload) {
  const { customer={}, shipment={}, meta={} } = payload;

  // shipment.sender / shipment.recipient come strutture annidate dal form
  const s = shipment.sender || {};
  const r = shipment.recipient || {};

  return {
    // --- Dati cliente ---
    "Email_cliente": customer.email || "",                 // <== rinomina se serve
    "Valuta": customer.currency || "EUR",
    "Validità_preventivo": customer.validUntil || null,    // campo data
    "Note_globali": customer.notes || "",

    // --- Mittente ---
    "Mittente_Nome": s.name || "",
    "Mittente_Paese": s.country || "",
    "Mittente_Città": s.city || "",
    "Mittente_CAP": s.zip || "",
    "Mittente_Indirizzo": s.address || "",
    "Mittente_Telefono": s.phone || "",
    "Mittente_PIVA_EORI": s.tax || "",

    // --- Destinatario ---
    "Destinatario_Nome": r.name || "",
    "Destinatario_Paese": r.country || "",
    "Destinatario_Città": r.city || "",
    "Destinatario_CAP": r.zip || "",
    "Destinatario_Indirizzo": r.address || "",
    "Destinatario_Telefono": r.phone || "",
    "Destinatario_TaxID_EORI": r.tax || "",

    // --- Meta (opzionale) ---
    "Scadenza_link": meta.expireAt || null,               // data/ora se lo hai configurato così
    "Visibilità_link": meta.visibility || "Subito"
  };
}

function mapOpzioneRecords(quoteId, options=[]) {
  return options.map((opt, idx) => ({
    fields: {
      "Preventivo": [quoteId],                      // campo Link a Preventivi
      "Etichetta": opt.label || `Opzione ${idx+1}`, // es. “OPZIONE 1”
      "Corriere": opt.carrier || "",
      "Servizio": opt.service || "",
      "Tempo_di_resa_previsto": opt.transit || "",
      "Incoterm": opt.incoterm || "",
      "Oneri_a_carico_di": opt.chargedTo || "",
      "Prezzo": typeof opt.price === "number" ? opt.price : null,
      "Valuta": opt.currency || "EUR",
      "Peso_reale_kg": typeof opt.weightKg === "number" ? opt.weightKg : null,
      "Note_operative": opt.notes || ""
    }
  }));
}

export default withCORS(async function handler(req, res) {
  try {
    requireEnv();

    if (req.method === "POST") {
      const payload = req.body || {};
      // 1) Crea record su Preventivi
      const pFields = mapPreventivoFields(payload);
      const pRec = await createRecord(TB_PREVENTIVI, pFields);
      const quoteId = pRec.id;

      // 2) Crea le Opzioni col link al Preventivo
      const optRecs = mapOpzioneRecords(quoteId, payload.options || []);
      if (optRecs.length) await createRecords(TB_OPZIONI, optRecs);

      res.status(201).json({ ok:true, id:quoteId });
      return;
    }

    res.status(405).json({ ok:false, error:"Method not allowed" });
  } catch (err) {
    res.status(500).json({ ok:false, error:String(err.message || err) });
  }
});
