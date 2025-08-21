import { EU_COUNTRIES } from '../config.js';

export const toKg = x => `${Number(x || 0).toFixed(1)} kg`;
export const isEU = c => EU_COUNTRIES.has(c);
export const areaOf = c => isEU(c) ? 'UE' : 'ExtraUE';
export const dateTs = d => {
  if (!d) return -Infinity;
  const t = Date.parse(d);
  return isNaN(t) ? -Infinity : t;
};

/** Normalizza stringa numerica (virgola o punto) → Number */
function toNumber(v, def = 0) {
  if (v == null) return def;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).trim();
  if (!s) return def;
  const m = s.match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return def;
  const n = parseFloat(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : def;
}

/** Rileva se una stringa sembra JSON */
function isJsonLike(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  return (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'));
}

/**
 * Parser robusto per "Lista Colli".
 * Supporta:
 *  - JSON: [{l,w,h,kg}] o sinonimi
 *  - Testo: "17x9x30 cm peso 2 kg"
 */
export function parseListaColli(text) {
  if (!text) return [];

  // JSON già in array
  if (Array.isArray(text)) {
    return text.map(normalizeColloFromObject).filter(Boolean);
  }
  if (typeof text === 'string' && isJsonLike(text)) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeColloFromObject).filter(Boolean);
      }
      const single = normalizeColloFromObject(parsed);
      return single ? [single] : [];
    } catch {
      // fallback su testo libero
    }
  }

  // Parsing testo libero
  const parts = String(text)
    .split(/[\n;|]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];
  const dimsRe = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/;
  const kgRe = /(\d+(?:[.,]\d+)?)\s*(?:kg|kilo|chil?o)/i;

  for (const raw of parts) {
    const dm = raw.match(dimsRe);
    const km = raw.match(kgRe);

    if (dm) {
      const l = toNumber(dm[1]);
      const w = toNumber(dm[2]);
      const h = toNumber(dm[3]);
      const kg = km ? toNumber(km[1]) : 0;
      if (l > 0 && w > 0 && h > 0) {
        results.push({ l, w, h, kg });
        continue;
      }
    }
    if (!dm && km) {
      results.push({ l: 0, w: 0, h: 0, kg: toNumber(km[1]) });
    }
  }
  return results;

  // helper interno
  function normalizeColloFromObject(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const l = toNumber(obj.l ?? obj.length ?? obj.Lunghezza ?? obj.lato1);
    const w = toNumber(obj.w ?? obj.width ?? obj.Larghezza ?? obj.lato2);
    const h = toNumber(obj.h ?? obj.height ?? obj.Altezza ?? obj.lato3);
    const kg = toNumber(obj.kg ?? obj.weight ?? obj.peso ?? obj.Peso);
    if (l || w || h || kg) return { l, w, h, kg };
    return null;
  }
}

/** Somma i pesi dei colli; se 0 → fallback a rec.peso_reale_kg */
export function totalPesoKg(rec) {
  if (!rec) return 0;
  const colli = Array.isArray(rec.colli) ? rec.colli : [];
  const sum = colli.reduce((acc, c) => acc + toNumber(c?.kg, 0), 0);
  if (sum > 0) return Number(sum.toFixed(3));
  return toNumber(rec.peso_reale_kg, 0);
}

export function trackingUrl(carrier, num) {
  if (!carrier || !num) return null;
  const c = String(carrier).toLowerCase();
  if (c.includes('dhl')) return `https://www.dhl.com/it-it/home/tracking.html?tracking-id=${encodeURIComponent(num)}`;
  if (c.includes('ups')) return `https://www.ups.com/track?loc=it_IT&tracknum=${encodeURIComponent(num)}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(num)}`;
  if (c.includes('gls')) return `https://gls-group.com/track?match=${encodeURIComponent(num)}`;
  if (c.includes('dpd')) return `https://www.dpd.com/it/it/track/?parcelNumber=${encodeURIComponent(num)}`;
  if (c.includes('tnt')) return `https://www.tnt.com/express/it_it/site/tracking.html?cons=${encodeURIComponent(num)}`;
  if (c.includes('poste')) return `https://www.poste.it/cerca/index.html#/risultati-spedizioni/${encodeURIComponent(num)}`;
  return `#`;
}

export function normalizeCarrier(input) {
  if (input == null) return '';
  let s = input;
  if (typeof s === 'object' && s.name) s = s.name;
  s = String(s).trim();
  if (!s) return '';
  const k = s.toLowerCase().replace(/[\s-]/g, '');
  const map = {
    dhl: 'DHL', dhlexpress: 'DHL',
    fedex: 'FedEx', fedexexpress: 'FedEx', fx: 'FedEx', fedexground: 'FedEx',
    ups: 'UPS', unitedparcelservice: 'UPS',
    tnt: 'TNT', tntexpress: 'TNT',
    gls: 'GLS', dpd: 'DPD',
    poste: 'Poste', posteitaliane: 'Poste',
    altro: 'Altro', other: 'Altro'
  };
  return map[k] || s;
}

export function flash(el) {
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1200);
}
