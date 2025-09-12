// api/tools/docs.js
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow','GET'); return res.status(405).send('Method Not Allowed'); }

  const html = `<!doctype html><html lang="it"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Utility Documenti</title>
<style>
:root{--bg:#0b1220;--card:#0f172a;--muted:#8ea0bd;--text:#e7ecf5;--accent:#ff9a1f;--accent2:#ffb54f;--line:rgba(255,255,255,.08);--r:18px;--rsm:12px;--gap:14px;--w:760px;}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;color:var(--text);background:radial-gradient(1200px 600px at 20% -10%, #11213f 0%, rgba(17,33,63,0) 60%), var(--bg);font:16px/1.45 system-ui,Segoe UI,Inter,Roboto,sans-serif;display:flex;align-items:flex-start;justify-content:center;padding:32px 16px 60px}
.wrap{width:min(var(--w),100%)}.page-title{font-size:clamp(26px,3.2vw,34px);font-weight:800;letter-spacing:.2px;margin:6px 0 6px}.page-sub{color:var(--muted);margin:0 0 18px;max-width:70ch}
.card{background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(255,255,255,.01)),var(--card);border:1px solid var(--line);border-radius:var(--r);padding:18px;box-shadow:0 10px 30px rgba(0,0,0,.35)}
.row{display:grid;grid-template-columns:1fr;gap:var(--gap)}@media(min-width:760px){.row.cols-2{grid-template-columns:1.2fr .8fr}}
.field{display:flex;flex-direction:column;gap:8px}label{color:var(--muted);font-weight:600;letter-spacing:.2px}
input,select{width:100%;border:1px solid var(--line);background:#0b1328;color:var(--text);border-radius:var(--rsm);padding:12px 14px;outline:none;transition:border-color .15s,box-shadow .15s}
input:focus,select:focus{border-color:rgba(255,154,31,.6);box-shadow:0 0 0 4px rgba(255,154,31,.15)}
.actions{margin-top:8px;display:flex;gap:10px}
.primary{border:0;cursor:pointer;width:100%;padding:14px 18px;border-radius:14px;color:#111;font-weight:800;letter-spacing:.3px;font-size:16px;background:radial-gradient(160% 220% at 0% 0%, #ffe9c4 0%, rgba(255,233,196,0) 50%), linear-gradient(180deg,var(--accent),var(--accent2));box-shadow:0 10px 24px rgba(255,154,31,.28), inset 0 1px 0 rgba(255,255,255,.35);transition:transform .05s,filter .15s,box-shadow .15s}
.primary:hover{filter:brightness(1.02)}.primary:active{transform:translateY(1px)}.primary[disabled]{opacity:.55;cursor:not-allowed;filter:grayscale(.2)}
.note{margin-top:12px;font-size:14px;color:var(--muted);padding:10px 12px;border:1px dashed var(--line);border-radius:12px}
.result{margin-top:14px;border-top:1px dashed var(--line);padding-top:14px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 2px}
.btn{display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:#0b1328;color:var(--text);font-weight:700;font-size:14px;letter-spacing:.2px;text-decoration:none;transition:transform .05s,filter .15s,border-color .15s}
.btn:hover{border-color:rgba(255,154,31,.4)}.btn:active{transform:translateY(1px)}
.log{margin-top:10px;min-height:42px;border-radius:12px;background:#0b1328;border:1px solid var(--line);padding:10px 12px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#cfe0ff;white-space:pre-wrap}
</style>
</head><body>
<div class="wrap">
  <div class="page-title">Utility Documenti</div>
  <div class="page-sub">Crea <b>Proforma</b>, <b>Fattura commerciale</b> e <b>DLE</b>. Il link generato è firmato.</div>
  <div class="card">
    <div class="row cols-2">
      <div class="field">
        <label for="idsped">ID Spedizione</label>
        <input id="idsped" placeholder="es. SP-2025-09-11-4599"/>
      </div>
      <div class="field">
        <label for="tipo">Tipo documento</label>
        <select id="tipo">
          <option value="proforma">Proforma</option>
          <option value="fattura">Fattura commerciale</option>
          <option value="dle">Dichiarazione libera esportazione</option>
        </select>
      </div>
    </div>
    <div class="actions"><button id="go" class="primary">Genera e allega</button></div>
    <div class="note">Nota: l’URL firmato scade in ~15 minuti. L’allegato (se configurato) viene salvato su Airtable.</div>
    <div class="result" id="result" style="display:none">
      <div class="btns">
        <a id="open"  class="btn" target="_blank" rel="noopener">Apri anteprima</a>
        <a id="print" class="btn" target="_blank" rel="noopener">Stampa / Salva PDF</a>
        <button id="copy" class="btn" type="button">Copia URL</button>
      </div>
      <div id="log" class="log"></div>
    </div>
  </div>
</div>
<script>
(function(){
  var $=s=>document.querySelector(s);
  var id=$('#idsped'), tp=$('#tipo'), go=$('#go'), box=$('#result'), aOpen=$('#open'), aPrint=$('#print'), btCopy=$('#copy'), log=$('#log');
  function show(x){ box.style.display = x ? '' : 'none'; }
  function say(t,ok){ log.textContent=t||''; log.style.borderColor = ok?'rgba(0,180,110,.35)':'rgba(255,120,120,.35)'; }
  function pretty(o){ try{return JSON.stringify(o,null,2);}catch{return String(o);} }
  function valid(){ go.disabled = !(id.value||'').trim(); return !go.disabled; }
  id.addEventListener('input',valid); valid();

  go.addEventListener('click', function(){
    if(!valid()) return;
    var idSped = id.value.trim();
    var type   = tp.value;
    go.disabled = true; show(true); say('Generazione in corso…');

    fetch('/api/docs/unified/generate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ idSpedizione:idSped, type })
    })
    .then(r=>r.text().then(t=>({ ok:r.ok, status:r.status, text:t })))
    .then(({ok,status,text})=>{
      var j=null; try{ j=JSON.parse(text); }catch{}
      if(!ok || (j && j.ok===false)){
        var msg=(j&&j.error)?j.error:('HTTP '+status);
        return say('Errore: '+msg+' \\n\\nDettagli:\\n'+(j?pretty(j):text), false);
      }
      var u=new URL(j.url, location.origin); u.searchParams.set('format','html'); u.searchParams.set('ship', idSped);
      var p=new URL(u.toString()); p.searchParams.set('print','1');
      aOpen.href = u.toString(); aPrint.href=p.toString();
      btCopy.onclick=function(){ navigator.clipboard.writeText(u.toString()).then(()=>say('URL copiato.\\n\\nDettagli:\\n'+pretty(j), true)); };
      say('Documento generato ✓\\n\\nDettagli:\\n'+pretty(j), true);
    })
    .catch(e=>{ say('Errore di rete: '+(e&&e.message?e.message:'operazione fallita'), false); })
    .finally(()=>{ go.disabled=false; });
  });
})();
</script>
</body></html>`;
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  return res.status(200).send(html);
}
