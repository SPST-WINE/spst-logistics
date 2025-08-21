// utils/weights.js
// Parser robusto per Lista Colli + utilità pesi
// Output colli: [{ L, W, H, kg }] con numeri

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

function hasDims(o) { return o && o.L > 0 && o.W > 0 && o.H > 0; }
function emptyCollo() { return { L: 0, W: 0, H: 0, kg: 0 }; }

/** Normalizza un oggetto (da JSON) in { L, W, H, kg } */
function normalizeColloFromObject(obj) {
  if (!obj || typeof obj !== 'object') return null;

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

  // Supporto opzionale campo "dims": "40x30x10"
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
 * Input:
 *  - JSON (array/oggetto) con chiavi L/W/H/kg (o sinonimi)
 *  - Testo libero (anche multi-riga): es. "40x30x10\n4 kg"
 * Comportamento:
 *  - Se dimensioni e peso sono su righe separate, vengono **uniti nello stesso collo**.
 */
export function parseListaColli(text) {
  if (text == null) return [];

  // JSON già in array
  if (Array.isArray(text)) {
    return text.map(normalizeColloFromObject).filter(Boolean);
  }

  // Stringa JSON
  if (typeof text === 'string' && isJsonLike(text)) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(normalizeColloFromObject).filter(Boolean);
      const single = normalizeColloFromObject(parsed);
      return single ? [single] : [];
    } catch {
      // fallback testo
    }
  }

  // Parser testuale
  const parts = String(text)
    .split(/[\n;|]+/g)
    .map(s => s.trim())
    .filter(Boolean);

  const results = [];
  let pending = null; // collo in costruzione che attende dims e/o kg

  const dimsRe = /(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)\s*[xX×]\s*(\d+(?:[.,]\d+)?)/;
  const kgRe = /(\d+(?:[.,]\d+)?)\s*(?:kg|kilo|chil?o)/i;

  for (const raw of parts) {
    const dm = raw.match(dimsRe);
    const km = raw.match(kgRe);
    const hasDm = !!dm;
    const hasKg = !!km;

    // Se iniziamo a lavorare e non c'è pending, crealo
    if (!pending && (hasDm || hasKg)) pending = emptyCollo();

    if (hasDm) {
      const L = toNumber(dm[1]);
      const W = toNumber(dm[2]);
      const H = toNumber(dm[3]);

      // Se abbiamo già un collo con dimensioni => quello era completo (o senza peso),
      // e questa è l'inizio di un nuovo collo. Pusha il precedente.
      if (pending && hasDims(pending)) {
        results.push(pending);
        pending = emptyCollo();
      } else if (!pending) {
        pending = emptyCollo();
      }

      pending.L = L;
      pending.W = W;
      pending.H = H;
    }

    if (hasKg) {
      const kg = toNumber(km[1]);
      if (!pending) pending = emptyCollo();
      // Se non c'è ancora peso sul collo in corso, assegna; altrimenti somma (raro ma sicuro)
      pending.kg = toNumber(pending.kg, 0) + kg;
    }

    // Se ora pending ha sia dims sia kg, è un collo completo → push e reset
    if (pending && hasDims(pending) && pending.kg > 0) {
      results.push(pending);
      pending = null;
    }
  }

  // Flush finale: se restano solo dimensioni o solo peso, pusha comunque
  if (pending && (hasDims(pending) || pending.kg > 0)) {
    results.push(pending);
    pending = null;
  }

  return results;
}

/** Somma i kg dei colli; se somma 0 → fallback a rec.peso_reale_kg */
export function totalPesoKg(rec) {
  if (!rec) return 0;
  const colli = Array.isArray(rec.colli) ? rec.colli : [];
  const sum = colli.reduce((acc, c) => acc + toNumber(c?.kg, 0), 0);
  if (sum > 0) return Number(sum.toFixed(3));
  return toNumber(rec.peso_reale_kg, 0);
}
