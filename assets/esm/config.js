export const DEBUG = true;

export const AIRTABLE = {
  baseId: 'appwnx59j8NJ1x5ts',
  table: 'SPEDIZIONI',
  view: null,
  proxyBase: 'https://spst-logistics.vercel.app/api/airtable'
};

export const USE_PROXY = true;
export const FETCH_OPTS = { mode:'cors', credentials:'omit', cache:'no-store', headers:{ 'Accept':'application/json' } };

export const EU_COUNTRIES = new Set(["Italia","Francia","Germania","Spagna","Portogallo","Belgio","Olanda","Paesi Bassi","Austria","Svezia","Finlandia","Danimarca","Repubblica Ceca","Slovacchia","Polonia","Ungheria","Irlanda","Lituania","Lettonia","Estonia","Grecia","Romania","Bulgaria","Slovenia","Croazia","Lussemburgo","Malta","Cipro"]);

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

export const CARRIERS = ['DHL','FedEx','UPS','TNT'];

