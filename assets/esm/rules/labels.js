import { areaOf } from '../utils/misc.js';

const LABEL_RULES = [
  { when:{country:'USA', tipo:'B2B'}, must:['Lingua: Inglese','Titolo alcolometrico % vol','Importer statement (US)','Government Warning'], extra:['COLA necessario (o COLA Waiver se applicabile)'] },
  { when:{country:'USA', tipo:'Campionatura'}, must:['Lingua: Inglese','Titolo alcolometrico % vol'], extra:['Possibile COLA Waiver per campioni'] },
  { when:{country:'UK'}, must:['Lingua: Inglese','Allergeni','Titolo alcolometrico % vol','Importer/Responsible Person (UK)'] },
  { when:{country:'Canada'}, must:['Lingua: Inglese o Francese','Titolo alcolometrico % vol'] },
  { when:{country:'Cina'}, must:['Lingua: Cinese','Dati importatore in cinese'], extra:['Possibile etichetta CIQ'] },
  { when:{country:'Taiwan'}, must:['Lingua: Cinese','Titolo alcolometrico % vol','Allergeni'] },
  { when:{country:'Corea del Sud'}, must:['Lingua: Coreano','Titolo alcolometrico % vol','Allergeni'] },
  { when:{area:'UE'}, must:['Lingua: del Paese di destinazione','Allergeni','Volume nominale (ml)','Titolo alcolometrico % vol'] },
  { when:{}, must:['Titolo alcolometrico % vol'] }
];

export function labelInfoFor(rec){
  const country = rec.dest_paese || rec.paese || '';
  const tipo = rec.tipo_spedizione || '';
  const area = areaOf(country);
  const must = new Set(); const extra = new Set();
  for(const r of LABEL_RULES){
    const okCountry = !r.when.country || r.when.country === country;
    const okTipo = !r.when.tipo || r.when.tipo === tipo;
    const okArea = !r.when.area || r.when.area === area;
    if (okCountry && okTipo && okArea){ (r.must||[]).forEach(x=>must.add(x)); (r.extra||[]).forEach(x=>extra.add(x)); }
  }
  const title = `Regole etichetta — ${tipo||'Spedizione'} • ${country||area}`;
  return {title, must:[...must], extra:[...extra], country, tipo, area};
}

