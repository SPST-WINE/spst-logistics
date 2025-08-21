// assets/esm/config.js
const W = (typeof window !== 'undefined' && window.BACK_OFFICE_CONFIG) || {};

export const DEBUG = (typeof W.DEBUG === 'boolean') ? W.DEBUG : true;

export const AIRTABLE = {
  baseId: 'appwnx59j8NJ1x5ts',
  table: 'SPEDIZIONI',
  view: null,
  // Usa SEMPRE l’override passato da Webflow (se presente).
  proxyBase: W.PROXY_BASE || 'https://spst-airtable-proxy.vercel.app/api/airtable'
};

export const CARRIERS = Array.isArray(W.CARRIERS) && W.CARRIERS.length
  ? W.CARRIERS
  : ['DHL','FedEx','UPS','TNT'];

export const USE_PROXY = true;
export const FETCH_OPTS = {
  mode: 'cors',
  credentials: 'omit',
  cache: 'no-store',
  headers: { 'Accept': 'application/json' }
};
