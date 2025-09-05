// GET /api/airtable/spedizioni/:id/colli
// Ritorna { ok:true, rows:[{lunghezza_cm,larghezza_cm,altezza_cm,peso_kg,quantita}] }

export default async function handler(req, res){
  if (req.method === 'OPTIONS') return sendCORS(req, res);
  sendCORS(req, res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  try{
    const id = (req.query.id || '').toString();
    if(!id) return res.status(400).json({ error:'Missing record id' });

    const pat    = process.env.AIRTABLE_PAT;
    const baseId = process.env.AIRTABLE_BASE_ID;
    // nome tabella colli (compat): prima prova con env specifici, poi fallback comuni
    const table  = process.env.AIRTABLE_TABLE_COLLI
                || process.env.AIRTABLE_TABLE_SPED_COLLI
                || process.env.TB_COLLI
                || 'SPED_COLLI';
    const linkField = process.env.AIRTABLE_COLLI_LINK_FIELD || 'Spedizione';
    assertEnv({ pat, baseId, table });

    const apiBase = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`;
    // Nota: usiamo ARRAYJOIN su linked IDs. È ok per questa semplice API.
    const formula = `FIND("${id}", ARRAYJOIN({${linkField}} & ""))`;
    const url = `${apiBase}?${new URLSearchParams({ filterByFormula: formula, pageSize:'100' }).toString()}`;

    const r = await fetch(url, { headers: { Authorization: `Bearer ${pat}` } });
    if (!r.ok){
      const t = await r.text().catch(()=> '');
      return res.status(r.status).json({ error:'Airtable error', details:t });
    }
    const json = await r.json();
    const rows = (json.records||[]).map(rec => {
      const f = rec.fields || {};
      const num = (v)=> (v==null||v==='') ? null : Number(String(v).replace(',','.')) || null;
      return {
        lunghezza_cm: num(f['L_cm'] || f['Lunghezza'] || f['L'] || f['Lunghezza (cm)']),
        larghezza_cm: num(f['W_cm'] || f['Larghezza'] || f['W'] || f['Larghezza (cm)']),
        altezza_cm:   num(f['H_cm'] || f['Altezza']   || f['H'] || f['Altezza (cm)']),
        peso_kg:      num(f['Peso'] || f['Peso_Kg']   || f['Kg'] || f['Peso (kg)']) || 0,
        quantita:     Number(f['Quantita'] || f['Quantità'] || f['Qty'] || 1) || 1,
      };
    });

    return res.status(200).json({ ok:true, rows });
  }catch(e){
    console.error('[GET colli] error', e);
    return res.status(502).json({ error:'Upstream error', details:String(e?.message||e) });
  }
}

/* ───── helpers ───── */
function sendCORS(req,res){
  const origin = req.headers.origin || '';
  const list = (process.env.ORIGIN_ALLOWLIST || '*').split(',').map(s=>s.trim()).filter(Boolean);
  const allowed = list.includes('*') || (!origin) || list.some(p => safeWildcardMatch(origin, p));
  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age','600');
  if (req.method === 'OPTIONS') return res.status(204).end();
}
function safeWildcardMatch(input, pattern){
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input);
}
function escapeRegex(str){ return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }
function assertEnv({ pat, baseId, table }){ if(!pat) throw new Error('AIRTABLE_PAT missing'); if(!baseId) throw new Error('AIRTABLE_BASE_ID missing'); if(!table) throw new Error('AIRTABLE_TABLE missing'); }
