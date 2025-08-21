export function coerceItalianNumber(raw){
  if (raw == null) return 0;
  let s = String(raw).trim();
  if (/^\d+,\d+$/.test(s)) s = s.replace(',', '.');
  return Number(s) || 0;
}

export function parseListaColli(text){
  const out = [];
  if (typeof text!=='string') return out;
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for (const line of lines){
    const m = line.match(/(\d+)\s*x\s*(\d+)\s*x\s*(\d+).*?(\d+(?:[.,]\d+)?)/i);
    if (!m) continue;
    const L = Number(m[1]), W = Number(m[2]), H = Number(m[3]);
    const kg = coerceItalianNumber(m[4]);
    out.push({ L, W, H, kg });
  }
  return out;
}

export function totalPesoKg(rec){
  try{
    const sum = (Array.isArray(rec?.colli) ? rec.colli : [])
      .reduce((a,c)=> a + (Number(c.kg)||0), 0);
    const fallback = Number(rec?.peso_reale_kg || 0);
    return sum > 0 ? sum : fallback;
  }catch(_){ return Number(rec?.peso_reale_kg || 0); }
}

