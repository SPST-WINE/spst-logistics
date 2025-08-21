// assets/esm/config.js
// Legge eventuale override passato da Webflow: window.BACK_OFFICE_CONFIG
const W = (typeof window !== 'undefined' && window.BACK_OFFICE_CONFIG) || {};

// Debug attivabile da Webflow (DEBUG: true/false)
export const DEBUG = (typeof W.DEBUG === 'boolean') ? W.DEBUG : true;

// Config Airtable/proxy; PROXY_BASE può essere sovrascritto da Webflow
export const AIRTABLE = {
  baseId: 'appwnx59j8NJ1x5ts',
  table: 'SPEDIZIONI',
  view: null,
  // Default sicuro: progetto proxy su Vercel
  proxyBase: W.PROXY_BASE || 'https://spst-airtable-proxy.vercel.app/api/airtable'
};

export const USE_PROXY = true;
export const FETCH_OPTS = {
  mode: 'cors',
  credentials: 'omit',
  cache: 'no-store',
  headers: { 'Accept': 'application/json' }
};

// (ripristinato) Paesi UE usati dalle regole etichette/documenti
export const EU_COUNTRIES = new Set([
  "Italia","Francia","Germania","Spagna","Portogallo","Belgio","Olanda","Paesi Bassi",
  "Austria","Svezia","Finlandia","Danimarca","Repubblica Ceca","Slovacchia","Polonia",
  "Ungheria","Irlanda","Lituania","Lettonia","Estonia","Grecia","Romania","Bulgaria",
  "Slovenia","Croazia","Lussemburgo","Malta","Cipro"
]);

// (ripristinato) Link template documenti
export const TEMPLATES = {
  "Fattura_Proforma": "https://example.com/templates/fattura-proforma.docx",
  "Fattura_Commerciale": "https://example.com/templates/fattura-commerciale.docx",
  "e-DAS": "https://example.com/templates/edas.pdf",
  "Lettera_di_Vettura": "https://example.com/templates/ldv.pdf",
  "FDA_Prior_Notice": "https://example.com/templates/fda-prior-notice.pdf",
  "COLA_Waiver": "https://example.com/templates/cola-waiver.pdf",
  "Dichiarazione_Esportazione": "https://example.com/templates/dichiarazione-esportazione.pdf",
  "CIQ": "https://example.com/templates/ciq.pdf",
  "Certificato_Sanitario": "https://example.com/templates/certificato-sanitario.pdf",
  "Certificato_di_Origine": "https://example.com/templates/certificato-origine.pdf"
};

// Lista corrieri (sovrascrivibile da Webflow)
export const CARRIERS = Array.isArray(W.CARRIERS) && W.CARRIERS.length
  ? W.CARRIERS
  : ['DHL','FedEx','UPS','TNT'];
