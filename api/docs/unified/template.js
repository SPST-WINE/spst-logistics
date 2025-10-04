// api/docs/unified/template.js

// Rende l'HTML del documento unificato (Proforma/Commercial).
export function renderUnifiedHTML({ mode = "proforma", sender, consignee, shipment, lines, total }) {
  const title = mode === "commercial" ? "Commercial Invoice" : "Proforma Invoice";
  const watermark = mode === "commercial" ? "COMMERCIAL" : "PROFORMA";

  const css = `
  *{box-sizing:border-box;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}
  html,body{margin:0;color:#111}
  .page{width:210mm;min-height:297mm;margin:0 auto;padding:18mm 16mm;position:relative}
  .watermark{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .watermark span{opacity:.06;font-size:120px;letter-spacing:.2em;transform:rotate(-24deg);font-weight:800;color:#0f172a}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  .brand{max-width:60%}
  .tag{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#374151;background:#f3f4f6;border:1px solid #e5e7eb;padding:2px 6px;border-radius:6px;margin-bottom:6px}
  .logo{font-size:26px;font-weight:800;letter-spacing:.02em;color:#111827}
  .meta{margin-top:6px;font-size:12px;color:#6b7280}
  .doc-meta{text-align:right;font-size:12px}
  .title{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#0ea5e9;font-weight:700}
  .kv div{margin:2px 0}
  hr.sep{border:none;border-top:1px solid #e5e7eb;margin:14px 0 18px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .card{border:1px solid #e5e7eb;border-radius:10px;padding:10px}
  .card h3{margin:0 0 8px;font-size:12px;color:#374151;text-transform:uppercase;letter-spacing:.08em}
  .small{font-size:12px;color:#374151}
  .muted{color:#6b7280}
  table.items{width:100%;border-collapse:collapse;font-size:12px;margin-top:14px}
  table.items th,table.items td{border-bottom:1px solid #e5e7eb;padding:8px 6px;vertical-align:top}
  table.items thead th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#374151;text-align:left}
  table.items td.num,table.items th.num{text-align:right}
  table.items tbody tr:nth-child(odd){background:#fafafa}
  .totals{margin-top:10px;display:flex;justify-content:flex-end}
  .totals table{font-size:12px;border-collapse:collapse;min-width:260px}
  .totals td{padding:6px 8px;border-bottom:1px solid #e5e7eb}
  .totals tr:last-child td{border-top:1px solid #d1d5db;border-bottom:none;font-weight:700}
  footer{margin-top:20px;font-size:11px;color:#374151}
  .legal{margin-top:10px}
  .sign{margin-top:20px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px}
  .sign .box{height:60px;border:1px dashed #d1d5db;border-radius:8px;width:260px}
  .sign .sig{display:flex;flex-direction:column;align-items:flex-start}
  .sign .label{font-size:11px;color:#374151;margin-bottom:6px}
  `;

  const rows = (lines || []).map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>
        <strong>${esc(r.description || "Goods")}</strong><br/>
        <span class="muted">HS: ${esc(r.hs || "-")} · Origin: ${esc(r.origin || "-")} · Est. weight: ${num(r.weightKg)} kg</span>
      </td>
      <td class="num">${num(r.qty)}</td>
      <td class="num">${money(r.unitPrice, shipment.currency)}</td>
      <td class="num">${money((r.qty || 0) * (r.unitPrice || 0), shipment.currency)}</td>
    </tr>
  `).join("");

  return `
  <!doctype html><html><head><meta charset="utf-8"/>
  <title>${title}</title><style>${css}</style></head><body>
  <div class="page">
    <div class="watermark"><span>${esc(watermark)}</span></div>
    <header>
      <div class="brand">
        <div class="tag">Sender</div>
        <div class="logo">${esc(sender.name)}</div>
        <div class="meta">${esc(sender.address)} · VAT ${esc(sender.vat)}<br/>${esc(sender.email)} · ${esc(sender.phone)}</div>
      </div>
      <div class="doc-meta">
        <div class="title">${esc(title)}</div>
        <div class="kv">
          <div><strong>No.:</strong> ${esc(shipment.number)}</div>
          <div><strong>Date:</strong> ${esc(shipment.issueDate)}</div>
          <div><strong>Shipment ID:</strong> ${esc(shipment.id)}</div>
        </div>
      </div>
    </header>

    <hr class="sep"/>

    <section class="grid">
      <div class="card">
        <h3>Consignee</h3>
        <div class="small"><strong>${esc(consignee.name)}</strong></div>
        <div class="small">${esc(consignee.address)}</div>
        <div class="small">Tax ID: ${esc(consignee.taxId || "-")}</div>
        <div class="small">Email: ${esc(consignee.email || "-")} · Tel: ${esc(consignee.phone || "-")}</div>
      </div>
      <div class="card">
        <h3>Shipment Details</h3>
        <div class="small">Pickup date: ${esc(shipment.pickupDate || "-")}</div>
        <div class="small">Incoterm: ${esc(shipment.incoterm)} · Currency: ${esc(shipment.currency)}</div>
      </div>
    </section>

    <table class="items" aria-label="Goods details">
      <thead><tr>
        <th style="width:28px">#</th>
        <th>Description</th>
        <th style="width:80px" class="num">Qty</th>
        <th style="width:110px" class="num">Unit Price</th>
        <th style="width:120px" class="num">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="totals">
      <table>
        <tr><td style="text-align:right">Subtotal</td>
            <td style="text-align:right;width:120px"><strong>${money(total, shipment.currency)}</strong></td></tr>
      </table>
    </div>

    <footer>
      <div class="legal"><strong>Declaration:</strong> This ${esc(title.toLowerCase())} is issued for customs purposes only and does not constitute a tax invoice. The values shown are intended solely for determining customs value in accordance with applicable regulations.</div>
      <div class="sign">
        <div>
          <div class="small"><strong>Place & date:</strong> ${esc(sender.city)}, ${esc(shipment.issueDate)}</div>
          <div class="small">Email: ${esc(sender.email)} · Tel: ${esc(sender.phone)}</div>
        </div>
        <div class="sig"><div class="label">Signature</div><div class="box"></div></div>
      </div>
    </footer>
  </div></body></html>`;
}

function esc(s){ return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function num(n){ return Number(n || 0).toString(); }
function money(n, cur="EUR"){ try{ return new Intl.NumberFormat("en-GB",{style:"currency",currency:cur}).format(Number(n||0)); }catch{ return `€ ${Number(n||0).toFixed(2)}`; } }
