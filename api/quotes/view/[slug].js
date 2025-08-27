<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Preventivo SPST</title>
  <style>
    :root{--bg:#0b1224;--card:#0e162b;--text:#e7ecf5;--muted:#9aa3b7;--brand:#f7911e;--accent:#6ea8ff}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial}
    .wrap{max-width:960px;margin:24px auto;padding:0 16px}
    .header{display:flex;justify-content:space-between;align-items:center;margin:8px 0 16px}
    .brand{display:flex;align-items:center;gap:10px}
    .logo{width:26px;height:26px}
    h1{margin:0;font-size:22px}
    .card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;margin:12px 0}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .k{font-size:12px;color:var(--muted)} .v{font-weight:600}
    .small{font-size:12px;color:var(--muted)}
    .opt{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin:10px 0;background:#0d152a}
    .opt.is-best{box-shadow:inset 0 0 0 1px rgba(110,168,255,.45), 0 6px 16px rgba(0,0,0,.25)}
    .opt-head{display:flex;gap:8px;align-items:center;margin-bottom:8px}
    .badge{display:inline-block;padding:3px 8px;border-radius:999px;border:1px solid var(--brand);color:var(--brand);background:rgba(247,145,30,.12);font-size:10px}
    .pill{display:inline-block;padding:4px 9px;border-radius:999px;background:rgba(110,168,255,.15);border:1px solid rgba(110,168,255,.4);font-size:11px}
    .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
    table{border-collapse:collapse;width:100%}
    th,td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,.1);text-align:left}
    @media (max-width:900px){.grid{grid-template-columns:1fr 1fr}.grid2{grid-template-columns:1fr}}
    .center{display:flex;justify-content:center;align-items:center;min-height:30vh}
  </style>
</head>
<body>
<div class="wrap" id="app">
  <div class="center small">Caricamento preventivo…</div>
</div>

<script>
(function(){
  const $ = (sel, el=document) => el.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const fmtCurr = (n, c='EUR') => (typeof n === 'number') ? new Intl.NumberFormat('it-IT',{style:'currency',currency:c}).format(n) : '—';
  const fmtDate = v => { try { const d=new Date(v); return Number.isNaN(+d)?'—':d.toISOString().slice(0,10);} catch{ return '—'; } };
  const nf2 = n => (typeof n === 'number' && Number.isFinite(n)) ? n.toFixed(2) : '0.00';

  function slugFromPath(){
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[parts.length-1] || '';
  }

  async function getQuoteData(slug){
    // 1) percorso consigliato
    try{
      const r = await fetch(`/api/quotes/${encodeURIComponent(slug)}`, {cache:'no-store'});
      if (r.ok) return await r.json();
    }catch{}
    // 2) fallback: se (per ora) l'API risponde su /quote/<slug> con JSON puro
    try{
      const r2 = await fetch(location.pathname, {cache:'no-store'});
      const ct = r2.headers.get('content-type') || '';
      if (ct.includes('application/json')) return await r2.json();
    }catch{}
    throw new Error('Impossibile recuperare i dati del preventivo');
  }

  function render({ok, quote, options=[], packages=[], totals={}}){
    if (!ok) throw new Error('Risposta non valida');

    const bestIdx = (() => {
      const priced = options.filter(o => typeof o.price === 'number').sort((a,b)=>a.price-b.price);
      const best = options.find(o => !!o.recommended);
      return best?.index ?? priced[0]?.index ?? options[0]?.index ?? null;
    })();

    const pkgPieces = Number(totals.pieces || packages.reduce((s,p)=>s+(Number(p.qty)||0),0)) || 0;
    const pkgWeight = Number(totals.weightKg || packages.reduce((s,p)=> s + (Number(p.kg||p.weight||0) * (Number(p.qty)||0||1)), 0)) || 0;

    const pkgRows = packages.map(p=>{
      const qty = Number(p.qty)||1;
      const l = Number(p.l ?? p.length ?? 0);
      const w = Number(p.w ?? p.width  ?? 0);
      const h = Number(p.h ?? p.height ?? 0);
      const kg = Number(p.kg ?? p.weight ?? 0);
      const dims = [l,w,h].map(n => (Number.isFinite(n)?n:0).toFixed(1)).join(' × ');
      return '<tr><td>'+qty+'</td><td>'+dims+'</td><td>'+nf2(kg)+'</td></tr>';
    }).join('');

    const pkgTable = packages.length
      ? '<div style="overflow:auto"><table><thead><tr>'
        + '<th class="k">Quantità</th><th class="k">L × W × H (cm)</th><th class="k">Peso (kg)</th>'
        + '</tr></thead><tbody>'+pkgRows+'</tbody></table></div>'
      : '<div class="small">Nessun collo.</div>';

    const optBlocks = options.length
      ? options.map(o => (
          '<div class="opt '+(o.index===bestIdx?'is-best':'')+'">'
            +'<div class="opt-head"><div class="badge">OPZIONE '+esc(o.index??'')+'</div>'
            +(o.index===bestIdx?'<span class="pill">Consigliata</span>':'')+'</div>'
            +'<div class="grid">'
              +'<div><div class="k">Corriere</div><div class="v">'+esc(o.carrier||'—')+'</div></div>'
              +'<div><div class="k">Servizio</div><div class="v">'+esc(o.service||'—')+'</div></div>'
              +'<div><div class="k">Tempo di resa previsto</div><div class="v">'+esc(o.transit||'—')+'</div></div>'
              +'<div><div class="k">Incoterm</div><div class="v">'+esc(o.incoterm||'—')+'</div></div>'
              +'<div><div class="k">Oneri a carico di</div><div class="v">'+esc(o.payer||'—')+'</div></div>'
              +'<div><div class="k">Prezzo</div><div class="v">'+fmtCurr(o.price, o.currency||quote.currency||'EUR')+'</div></div>'
            +'</div>'
            +(o.notes?'<div class="small" style="margin-top:6px"><strong>Note operative:</strong> '+esc(o.notes)+'</div>':'')
          +'</div>'
        )).join('')
      : '<div class="small">Nessuna opzione.</div>';

    const senderAddr = [quote?.sender?.address,quote?.sender?.zip,quote?.sender?.city,quote?.sender?.country].filter(Boolean).join(', ');
    const rcptAddr   = [quote?.recipient?.address,quote?.recipient?.zip,quote?.recipient?.city,quote?.recipient?.country].filter(Boolean).join(', ');

    const taxLineSender = quote?.sender?.tax ? ('<div class="small">P. IVA / EORI: '+esc(quote.sender.tax)+'</div>') : '';
    const taxLineRcpt   = quote?.recipient?.tax ? ('<div class="small">Tax ID / EORI: '+esc(quote.recipient.tax)+'</div>') : '';

    const parts = [];
    parts.push(
      '<div class="header"><div class="brand">',
      '<img class="logo" src="https://cdn.prod.website-files.com/6800cc3b5f399f3e2b7f2ffa/68079e968300482f70a36a4a_output-onlinepngtools%20(1).png" alt="SPST logo"/>',
      '<h1>Preventivo SPST</h1>',
      '</div><div class="small">Valido fino al <strong>', esc(fmtDate(quote?.validUntil)), '</strong></div></div>'
    );

    // card cliente / valuta (+ note globali)
    parts.push(
      '<div class="card"><div class="grid2">',
      '<div><div class="k">Cliente</div><div class="v">', esc(quote?.customerEmail||'—'), '</div></div>',
      '<div><div class="k">Valuta</div><div class="v">', esc(quote?.currency||'EUR'), '</div></div>',
      '</div>',
      quote?.notes ? '<div style="margin-top:10px"><div class="k">Note</div><div class="v">'+esc(quote.notes)+'</div></div>' : '',
      '</div>'
    );

    // card indirizzi
    parts.push(
      '<div class="card"><div class="grid2">',
        '<div>',
          '<div class="k">Mittente</div><div class="v">', esc(quote?.sender?.name||'—'), '</div>',
          '<div class="small">', esc(senderAddr), '</div>',
          taxLineSender,
        '</div>',
        '<div>',
          '<div class="k">Destinatario</div><div class="v">', esc(quote?.recipient?.name||'—'), '</div>',
          '<div class="small">', esc(rcptAddr), '</div>',
          taxLineRcpt,
        '</div>',
      '</div></div>'
    );

    // card note spedizione (se presenti)
    if (quote?.shipmentNotes) {
      parts.push(
        '<div class="card">',
          '<div class="k">Note generiche sulla spedizione</div>',
          '<div class="v" style="margin-top:6px">', esc(quote.shipmentNotes), '</div>',
        '</div>'
      );
    }

    // card colli
    parts.push(
      '<div class="card">',
        '<div class="k" style="margin-bottom:6px">Colli</div>',
        '<div class="small" style="margin-bottom:8px">',
          'Totale colli: <strong>', String(pkgPieces), '</strong> · ',
          'Peso reale totale: <strong>', nf2(pkgWeight), ' kg</strong>',
        '</div>',
        pkgTable,
      '</div>'
    );

    // card opzioni
    parts.push(
      '<div class="card">',
        '<div class="k" style="margin-bottom:6px">Opzioni di spedizione</div>',
        optBlocks,
      '</div>'
    );

    // footer
    parts.push(
      '<div class="small" style="margin-top:8px">',
      'Anteprima non vincolante. Eventuali costi accessori potrebbero essere applicati dal corriere ed addebitati al cliente. ',
      'Per maggiori informazioni consulta i ',
      '<a style="color:#9ec1ff" href="https://www.spst.it/termini-di-utilizzo" target="_blank" rel="noopener">Termini di utilizzo</a>.',
      '</div>'
    );

    const app = $('#app'); app.innerHTML = '<div class="wrap">'+parts.join('')+'</div>';
    // (qui sopra app è già .wrap; per semplicità re-inserisco .wrap)
    app.innerHTML = parts.join('');
  }

  (async function init(){
    const slug = slugFromPath();
    try{
      const data = await getQuoteData(slug);
      if (!data || data.ok === false) throw new Error('Quote non trovata');
      if (new URLSearchParams(location.search).get('debug') === '1') console.log('[public quote]', data);
      render(data);
    }catch(err){
      $('#app').innerHTML = '<div class="center small">Errore: '+esc(err.message||err)+'<\/div>';
      console.error('[quote page] load error:', err);
    }
  })();
})();
</script>
</body>
</html>
