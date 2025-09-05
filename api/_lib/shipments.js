// api/_lib/shipments.js
import {
  TB_SPED_WEBAPP,
  listRecords,
  getRecord,
  updateRecord,
  pick,
  escFormulaStr,
} from "./airtable.js";

/**
 * Costruisce una filterByFormula per:
 * - q: testo che può essere ID Spedizione o email cliente
 * - stati: array di stati
 * - from/to: YYYY-MM-DD su "Ritiro - Data"
 * - email: filtro diretto su "Creato da"
 */
function buildShipmentFilter({ q, stati, from, to, email } = {}) {
  const parts = [];

  // Filtro testo: cerca su ID Spedizione e Creato da (case-insensitive)
  if (q) {
    const qs = escFormulaStr(String(q).toLowerCase());
    parts.push(
      `OR(` +
        `FIND('${qs}', LOWER({ID Spedizione}&''))>0,` +
        `FIND('${qs}', LOWER({Creato da}&''))>0` +
      `)`
    );
  }

  // Filtro email (preciso)
  if (email) {
    const e = escFormulaStr(String(email).toLowerCase());
    parts.push(`LOWER({Creato da})='${e}'`);
  }

  // Stati multipli: OR over equality
  if (Array.isArray(stati) && stati.length) {
    const ors = stati.map(s => `{Stato}='${escFormulaStr(s)}'`).join(",");
    parts.push(`OR(${ors})`);
  }

  // Date ritiro (date-only): from/to inclusivi
  const parse = (d) => `DATETIME_PARSE('${escFormulaStr(d)}','YYYY-MM-DD')`;

  if (from) {
    parts.push(
      `OR(` +
        `IS_SAME({Ritiro - Data}, ${parse(from)}, 'day'),` +
        `IS_AFTER({Ritiro - Data}, ${parse(from)})` +
      `)`
    );
  }
  if (to) {
    parts.push(
      `OR(` +
        `IS_SAME({Ritiro - Data}, ${parse(to)}, 'day'),` +
        `IS_BEFORE({Ritiro - Data}, ${parse(to)})` +
      `)`
    );
  }

  return parts.length ? `AND(${parts.join(",")})` : ""; // nessun filtro = tutti
}

/**
 * Normalizzazione record spedizione (SpedizioniWebApp) per Back Office
 */
export function normalizeShipment(rec) {
  const f = rec.fields || {};

  const mitt = {
    ragioneSociale: pick(f, "Mittente - Ragione sociale"),
    referente:      pick(f, "Mittente - Referente"),
    paese:          pick(f, "Mittente - Paese"),
    citta:          pick(f, "Mittente - Città"),
    cap:            pick(f, "Mittente - CAP"),
    indirizzo:      pick(f, "Mittente - Indirizzo"),
    telefono:       pick(f, "Mittente - Telefono"),
    piva:           pick(f, "Mittente - P.IVA/CF"),
  };

  const dest = {
    ragioneSociale: pick(f, "Destinatario - Ragione sociale", "Destinatario"),
    referente:      pick(f, "Destinatario - Referente"),
    paese:          pick(f, "Destinatario - Paese", "Paese Destinatario"),
    citta:          pick(f, "Destinatario - Città", "Città Destinatario"),
    cap:            pick(f, "Destinatario - CAP", "CAP Destinatario"),
    indirizzo:      pick(f, "Destinatario - Indirizzo", "Indirizzo Destinatario"),
    telefono:       pick(f, "Destinatario - Telefono", "Telefono Destinatario"),
    abilitatoImport: !!pick(f, "Destinatario abilitato import"),
  };

  const fatt = {
    ragioneSociale: pick(f, "FATT - Ragione sociale", "Ragione Sociale Destinatario Fattura"),
    referente:      pick(f, "FATT - Referente"),
    paese:          pick(f, "FATT - Paese"),
    citta:          pick(f, "FATT - Città", "Città Destinatario Fattura"),
    cap:            pick(f, "FATT - CAP", "CAP Destinatario Fattura"),
    indirizzo:      pick(f, "FATT - Indirizzo", "Indirizzo Destinatario Fattura"),
    telefono:       pick(f, "FATT - Telefono", "Telefono Destinatario Fattura"),
    piva:           pick(f, "FATT - P.IVA/CF", "Tax ID Destinatario Fattura", "Codice EORI Destinatario Fattura"),
    delega:         !!pick(f, "Fattura - Delega a SPST"),
    sameAsDest:     !!pick(f, "FATT Uguale a Destinatario"),
  };

  // Allegati cliente vs SPST
  const attCliente = {
    fattura:  pick(f, "Fattura - Allegato Cliente") || [],
    packing:  pick(f, "Packing List - Allegato Cliente") || [],
  };
  const attSpst = {
    ldv:      pick(f, "Allegato LDV") || [],
    fattura:  pick(f, "Allegato Fattura") || [],
    dle:      pick(f, "Allegato DLE") || [],
    pl:       pick(f, "Allegato PL") || [],
    extra1:   pick(f, "Allegato 1") || [],
    extra2:   pick(f, "Allegato 2") || [],
    extra3:   pick(f, "Allegato 3") || [],
  };

  return {
    id: rec.id,
    idSpedizione: pick(f, "ID Spedizione"),
    creatoDa:     pick(f, "Creato da", "Mail Cliente"),
    tipo:         pick(f, "Tipo"),        // vino | altro
    sottotipo:    pick(f, "Sottotipo"),   // B2B | B2C | Sample
    formato:      pick(f, "Formato"),     // Pacco | Pallet
    contenuto:    pick(f, "Contenuto Colli"),
    stato:        pick(f, "Stato", "Stato Spedizione"),
    incoterm:     pick(f, "Incoterm"),
    valuta:       pick(f, "Valuta"),
    noteFatt:     pick(f, "Note Fattura"),

    ritiroData:   pick(f, "Ritiro - Data", "Data Ritiro"),
    ritiroNote:   pick(f, "Ritiro - Note", "Note Ritiro"),

    trackingNumber: pick(f, "Tracking Number"),
    trackingUrl:    pick(f, "Tracking URL"),

    mittente:     mitt,
    destinatario: dest,
    fatturazione: fatt,

    allegatiCliente: attCliente,
    allegatiSpst:    attSpst,

    // KPI/rollup se presenti
    kpi: {
      colli:             pick(f, "# Colli"),
      pesoRealeTot:      pick(f, "Peso reale tot"),
      pesoVolumetricoTot:pick(f, "Peso volumetrico tot"),
      pesoTariffatoTot:  pick(f, "Peso tariffato tot"),
    },

    createdTime: pick(f, "Created time"),
    lastModified: pick(f, "Last modified"),
  };
}

/**
 * Lista spedizioni per Back Office con filtri e ordinamenti:
 * - default sort: Ritiro - Data (desc), poi createdTime (desc)
 */
export async function listShipmentsBO({
  q,
  stati,          // array di stringhe
  from,           // YYYY-MM-DD
  to,             // YYYY-MM-DD
  email,          // filtro preciso su Creato da
  pageSize = 50,
  maxRecords,
  offset,
  fields,         // opzionale: limiti campi
} = {}) {
  const filterByFormula = buildShipmentFilter({ q, stati, from, to, email });

  const sort = [
    { field: "Ritiro - Data", direction: "desc" },
    { field: "Created time",  direction: "desc" },
  ];

  const json = await listRecords(TB_SPED_WEBAPP, {
    filterByFormula,
    sort,
    pageSize,
    maxRecords,
    fields,
    offset,
  });

  const rows = (json.records || []).map(normalizeShipment);
  return { rows, offset: json.offset || null };
}

export async function getShipmentBO(id) {
  const rec = await getRecord(TB_SPED_WEBAPP, id);
  return normalizeShipment(rec);
}

export async function updateShipmentStatus(id, newStatus) {
  return updateRecord(TB_SPED_WEBAPP, id, { "Stato": newStatus });
}
