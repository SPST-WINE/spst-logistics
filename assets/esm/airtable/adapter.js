// assets/esm/airtable/adapter.js
// Adatta un record Airtable (nuovo: SpedizioniWebApp, legacy: SPEDIZIONI) alla shape usata dal BO.

import { parseListaColli } from '../utils/weights.js';

function firstAttachmentUrl(v) {
  if (Array.isArray(v) && v.length && v[0] && v[0].url) return v[0].url;
  if (typeof v === 'string' && v) return v;
  return null;
}

function pick(fields, ...names) {
  for (const n of names) {
    if (n in fields && fields[n] != null && fields[n] !== '') return fields[n];
  }
  return undefined;
}

function mapDocs(fields) {
  // Nuovi attachment operativi SPST (WebApp)
  const NEW = {
    Lettera_di_Vettura: 'Allegato LDV',
    Fattura_Commerciale: 'Allegato Fattura',
    Dichiarazione_Esportazione: 'Allegato DLE',
    Packing_List: 'Allegato PL',
    FDA_Prior_Notice: 'Prior Notice',
    // Allegati caricati dal cliente
    Fattura_Client: 'Fattura - Allegato Cliente',
    Packing_Client: 'Packing List - Allegato Cliente',
  };
  // Legacy attachment (vecchia tabella)
  const LEGACY = {
    Lettera_di_Vettura: 'Lettera di Vettura',
    Fattura_Proforma: 'Fattura Proforma',
    Dichiarazione_Esportazione: 'Dichiarazione Esportazione',
    Packing_List: 'Packing List',
  };
  const out = {};
  // Nuovi prima
  Object.entries(NEW).forEach(([uiKey, atKey]) => {
    out[uiKey] = firstAttachmentUrl(fields[atKey]) || null;
  });
  // Legacy/fallback
  Object.entries(LEGACY).forEach(([uiKey, atKey]) => {
    if (!out[uiKey]) out[uiKey] = firstAttachmentUrl(fields[atKey]) || null;
  });
  return out;
}

function computeStato(fields, createdTime) {
  const statoNew = pick(fields, 'Stato');              // single select (Nuova, Evasa, In transito, Consegnata, Annullata)
  const legacyEv = !!pick(fields, 'Stato Spedizione'); // vecchia checkbox
  if (statoNew) return String(statoNew);
  if (legacyEv) return 'Pronta alla spedizione';
  // Heuristica legacy “Nuova/In elaborazione”
  const created = createdTime ? Date.parse(createdTime) : Date.now();
  const ageH = (Date.now() - created) / 36e5;
  return ageH <= 48 ? 'Nuova' : 'In elaborazione';
}

function mapTipoSpedizione(fields) {
  // Nuovo: 'Sottotipo' (B2B | B2C | Sample) – la UI chiama 'Campionatura' la voce Sample
  const s = pick(fields, 'Sottotipo', 'Tipo Spedizione') || '';
  if (String(s) === 'Sample') return 'Campionatura';
  return String(s || 'B2B');
}

function mapColli(fields) {
  // Se in futuro leggi i colli da SPED_COLLI, questa funzione potrà essere bypassata.
  const s = pick(fields, 'Lista Colli Ordinata', 'Lista Colli', 'Contenuto Colli') || '';
  if (!s) return [];
  // parseListaColli gestisce "Lista Colli Ordinata"/"Lista Colli" legacy
  const fromLegacy = parseListaColli(s);
  if (Array.isArray(fromLegacy) && fromLegacy.length) return fromLegacy;
  // fallback grezzo da testo libero "LxWxH ... Kg"
  return String(s).split(/[;|\n]+/).map((row) => {
    const m = String(row).match(/(\d+)\D+(\d+)\D+(\d+).+?(\d+(?:[\.,]\d+)?)/);
    if (!m) return { L: '-', W: '-', H: '-', kg: 0 };
    return { L: m[1], W: m[2], H: m[3], kg: Number(String(m[4]).replace(',', '.')) || 0 };
    });
}

export function airtableRecordToRec(record) {
  const f = record?.fields || {};
  const created = record?.createdTime || '';

  // Identificativi
  const idUmano = pick(f, 'ID Spedizione') || record.id;
  const email = pick(f, 'Creato da', 'Mail Cliente');

  // Mittente (nuovo prefisso "Mittente - ...", fallback legacy)
  const mitt_paese = pick(f, 'Mittente - Paese', 'Paese Mittente');
  const mitt_citta = pick(f, 'Mittente - Città', 'Città Mittente');
  const mitt_cap = pick(f, 'Mittente - CAP', 'CAP Mittente');
  const mitt_indirizzo = pick(f, 'Mittente - Indirizzo', 'Indirizzo Mittente');
  const mitt_telefono = pick(f, 'Mittente - Telefono', 'Telefono Mittente');
  const piva_mittente = pick(f, 'Mittente - P.IVA/CF', 'PIVA Mittente');
  const mitt_rs = pick(f, 'Mittente - Ragione sociale', 'Mittente');

  // Destinatario
  const dest_paese = pick(f, 'Destinatario - Paese', 'Paese Destinatario');
  const dest_citta = pick(f, 'Destinatario - Città', 'Città Destinatario');
  const dest_cap = pick(f, 'Destinatario - CAP', 'CAP Destinatario');
  const dest_indirizzo = pick(f, 'Destinatario - Indirizzo', 'Indirizzo Destinatario');
  const dest_telefono = pick(f, 'Destinatario - Telefono', 'Telefono Destinatario');
  const dest_rs = pick(f, 'Destinatario - Ragione sociale', 'Destinatario');

  // Altri campi principali
  const ritiro_data = pick(f, 'Ritiro - Data', 'Data Ritiro') || (created ? created.substring(0,10) : '');
  const incoterm = pick(f, 'Incoterm') || '';
  const tipo_spedizione = mapTipoSpedizione(f);
  const stato = computeStato(f, created);

  // Tracking
  const tracking_carrier = (function(){
    const c = pick(f, 'Corriere');
    if (!c) return null;
    if (typeof c === 'string') return c;
    if (typeof c === 'object' && c.name) return c.name;
    return null;
  })();
  const tracking_number = pick(f, 'Tracking Number') || null;

  // Documenti
  const docs = mapDocs(f);

  // Colli (fallback da testo se non strutturati)
  const colli = mapColli(f);

  return {
    _recId: record.id,            // usato da PATCH/upload
    id: idUmano,                  // id “umano” mostrato in UI
    cliente: dest_rs || mitt_rs || '(sconosciuto)',
    email,

    // mittente
    mittente_paese: mitt_paese || '',
    mittente_citta: mitt_citta || '',
    mittente_cap: mitt_cap || '',
    mittente_indirizzo: mitt_indirizzo || '',
    mittente_telefono: mitt_telefono || '',
    piva_mittente: piva_mittente || '',
    mittente_eori: pick(f, 'Mittente EORI') || '',

    // destinatario
    dest_paese: dest_paese || '',
    dest_citta: dest_citta || '',
    dest_cap: dest_cap || '',
    dest_indirizzo: dest_indirizzo || '',
    dest_telefono: dest_telefono || '',
    dest_eori: pick(f, 'Codice EORI Destinatario Fattura', 'Destinatario EORI') || '',

    // altri
    ritiro_data,
    peso_reale_kg: Number(pick(f, 'Peso reale tot', 'Peso Reale kg') || 0),
    colli,
    tipo_spedizione,
    incoterm,
    stato,
    docs,

    // tracking
    tracking_carrier,
    tracking_number
  };
}
