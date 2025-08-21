// utils/weights.js
// Parser robusto per Lista Colli + utilità pesi
// Ritorna sempre colli nel formato { L, W, H, kg } (numeri)

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

function isJsonLike(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim();
  return (t.startsWith('[') && t.endsWith(']')) || (t.startsWith('{') && t.endsWith('}'));
}

/**
 * Normalizza un oggetto (da JSON) in { L, W, H, kg }
 * Accetta sinonimi: l/len/length/Lunghezza/lato1, w/width/Larghezza/lato2, h/height/Altezza/lato3, kg/weight/peso
 */
function normalizeColloFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

  // Accetta sia maiuscole che minuscole e alcuni alias comuni
  const L = toNumber(
    obj.L ?? obj.l ?? obj.len ?? obj.length ?? obj.Lunghezza ?? obj.lato1 ?? obj.Lato1
  );
  const W = toNumber(
    obj.W ?? obj.w ?? obj.wid ?? obj.width ?? obj.Larghezza ?? obj.lato2 ?? obj.Lato2
  );
  const H = toNumber(
    obj.H ?? obj.h ?? obj.ht ?? obj.height ?? obj.Altezza ?? obj.lato3 ?? obj.Lato3
  );
  const kg = toNumber(
    obj.kg ?? obj.Kg ?? obj.KG ?? obj.weight ?? obj.Weight ?? obj.peso ?? obj.Peso ?? obj.peso_kg ?? obj.PesoKg
  );

  // Supporto opzionale campo "dims": "17x9x30"
  if ((!L || !W || !H) && typeof obj.dims === 'string') {
    const m = obj.dims.match(/(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/);
    if (m) {
      const l2 = toNumber(m[1]);
      const w2 = toNumber(m[2]);
      const h2 = toNumber(m[3]);
      return { L: L || l2, W: W || w2, H: H || h2, kg };
    }
  }

  if (L || W || H || kg) return { L, W, H, kg };
  return null;
}

/**
 * Parser per "Lista Colli Ordinata" o "Lista Colli".
 * Input può essere:
 *  - JSON (array/oggetto) con chiavi L/W/H/kg o sinonimi
 *  - Testo libero: "17x9x30 cm peso 2 kg", "17 x 9 x 30; 2,0kg", ecc.
 * Output: Array<{ L, W, H, kg }>
 */
export function parseListaColli(text) {
  if (text == null) return [];

  // Se è già un array JSON (oggetti)
  if (Array.isArray(text)) {
    return text.map(normalizeColloFromObject).filter(Boolean);
  }

  // Se sembra JSON in stringa, prova a fare il parse
  if (typeof text === 'string' && isJsonLike(text)) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed.map(normalizeColloFromObject).filter(Boolean);
      }
      const single = normalizeColloFromObject(parsed);
      return single ? [single] : [];
    } catch {
      // fallback al parser testuale
    }
  }

  // Parser testuale riga-per-riga (separatore: newline, ;, |)
  const parts = String(text)
    .split(/[\n;|]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];

  // Cattura dimensioni complete, inclusi decimali con virgola o punto
  const dimsRe = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/;
  // Cattura peso in kg ovunque nella riga
  const kgRe = /(\d+(?:[.,]\d+)?)\s*(?:kg|kilo|chil?o)/i;

  for (const raw of parts) {
    const dm = raw.match(dimsRe);
    const km = raw.match(kgRe);

    if (dm) {
      const L = toNumber(dm[1]);
      const W = toNumber(dm[2]);
      const H = toNumber(dm[3]); // <-- niente troncamenti: prende tutte le cifre (es. "30")
      const kg = km ? toNumber(km[1]) : 0;
      if (L > 0 && W > 0 && H > 0) {
        results.push({ L, W, H, kg });
        continue;
      }
    }

    // Riga con solo peso
    if (!dm && km) {
      results.push({ L: 0, W: 0, H: 0, kg: toNumber(km[1]) });
    }
  }

  return results;
}

/**
 * Somma i kg dei colli; se la somma è 0, usa rec.peso_reale_kg come fallback.
 * Ritorna un Number >= 0.
 */
export function totalPesoKg(rec) {
  if (!rec) return 0;
  const colli = Array.isArray(rec.colli) ? rec.colli : [];
  const sum = colli.reduce((acc, c) => acc + toNumber(c?.kg, 0), 0);
  if (sum > 0) return Number(sum.toFixed(3));
  // fallback su campo aggregato Airtable (già mappato in adapter.js)
  return toNumber(rec.peso_reale_kg, 0);
}
