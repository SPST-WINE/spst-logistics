
import { parseListaColli } from '../utils/weights.js';

function firstAttachmentUrl(arr){ return (Array.isArray(arr) && arr.length && arr[0] && arr[0].url) ? arr[0].url : null; }

export function airtableRecordToRec(record){
  const f = record.fields || {};
  const docs = {};
  if(firstAttachmentUrl(f['Lettera di Vettura'])) docs.Lettera_di_Vettura = firstAttachmentUrl(f['Lettera di Vettura']);
  if(firstAttachmentUrl(f['Fattura Proforma'])) docs.Fattura_Proforma = firstAttachmentUrl(f['Fattura Proforma']);
  if(firstAttachmentUrl(f['Dichiarazione Esportazione'])) docs.Dichiarazione_Esportazione = firstAttachmentUrl(f['Dichiarazione Esportazione']);
  if(firstAttachmentUrl(f['Packing List'])) docs.Packing_List = firstAttachmentUrl(f['Packing List']);
  if(firstAttachmentUrl(f['Prior Notice'])) docs.FDA_Prior_Notice = firstAttachmentUrl(f['Prior Notice']);

  const tipoRaw = f['Tipo Spedizione'] || '';
  const tipo_spedizione = (tipoRaw === 'Sample') ? 'Campionatura' : (tipoRaw || 'B2B');
  const created = record.createdTime || '';

  const evasa = !!f['Stato Spedizione'];
  let stato = evasa ? 'Pronta alla spedizione' : 'In elaborazione';
  if(!evasa){ const ageH = (Date.now() - Date.parse(created||Date.now())) / 36e5; if(ageH <= 48) stato = 'Nuova'; }

  return {
    _recId: record.id,
    id: f['ID Spedizione'] || record.id,
    cliente: f['Destinatario'] || f['Mittente'] || '(sconosciuto)',
    email: f['Mail Cliente'] || '',
    mittente_paese: f['Paese Mittente'] || '',
    mittente_citta: f['Città Mittente'] || '',
    mittente_cap: f['CAP Mittente'] || '',
    mittente_indirizzo: f['Indirizzo Mittente'] || '',
    mittente_telefono: f['Telefono Mittente'] || '',
    piva_mittente: f['PIVA Mittente'] || '',
    mittente_eori: '',
    dest_paese: f['Paese Destinatario'] || '',
    dest_citta: f['Città Destinatario'] || '',
    dest_cap: f['CAP Destinatario'] || '',
    dest_indirizzo: f['Indirizzo Destinatario'] || '',
    dest_telefono: f['Telefono Destinatario'] || '',
    dest_eori: f['Codice EORI Destinatario Fattura'] || '',
    ritiro_data: f['Data Ritiro'] || (created ? created.substring(0,10) : ''),
    peso_reale_kg: Number(f['Peso Reale kg'] || 0),
    colli: parseListaColli(f['Lista Colli Ordinata'] || f['Lista Colli'] || ''),
    tipo_spedizione,
    incoterm: f['Incoterm'] || '',
    stato,
    docs,
    tracking_carrier: (function(){ const c=f['Corriere']; if(!c) return null; if(typeof c==='string') return c; if(typeof c==='object' && c.name) return c.name; return null; })(),
    tracking_number: f['Tracking Number'] || null
  };
}
