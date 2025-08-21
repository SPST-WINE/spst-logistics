import { EU_COUNTRIES } from '../config.js';

export const toKg = x => `${Number(x||0).toFixed(1)} kg`;
export const isEU = c => EU_COUNTRIES.has(c);
export const areaOf = c => isEU(c) ? 'UE' : 'ExtraUE';
export const dateTs = d => { if(!d) return -Infinity; const t = Date.parse(d); return isNaN(t) ? -Infinity : t; };

export function trackingUrl(carrier, num){
  if(!carrier || !num) return null;
  const c = String(carrier).toLowerCase();
  if(c.includes('dhl')) return `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${encodeURIComponent(num)}`;
  if(c.includes('ups')) return `https://www.ups.com/track?loc=it_IT&tracknum=${encodeURIComponent(num)}`;
  if(c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`;
  if(c.includes('gls')) return `https://gls-group.com/track?match=${encodeURIComponent(num)}`;
  if(c.includes('dpd')) return `https://www.dpd.com/it/it/track/?parcelNumber=${encodeURIComponent(num)}`;
  if(c.includes('tnt')) return `https://www.tnt.com/express/it_it/site/tracking.html?cons=${encodeURIComponent(num)}`;
  if(c.includes('poste')) return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${encodeURIComponent(num)}`;
  return `#`;
}

export function normalizeCarrier(input){
  if (input == null) return '';
  let s = input;
  if (typeof s === 'object' && s.name) s = s.name;
  s = String(s).trim();
  if (!s) return '';
  const k = s.toLowerCase().replace(/[\s-]/g,'');
  const map = {
    dhl:'DHL', dhlexpress:'DHL',
    fedex:'FedEx', fedexexpress:'FedEx', fx:'FedEx', fedexground:'FedEx',
    ups:'UPS', unitedparcelservice:'UPS',
    tnt:'TNT', tntexpress:'TNT',
    gls:'GLS', dpd:'DPD',
    poste:'Poste', posteitaliane:'Poste',
    altro:'Altro', other:'Altro'
  };
  return map[k] || s;
}

export function flash(el){ if(!el) return; el.classList.add('flash'); setTimeout(()=>el.classList.remove('flash'), 1200); }

