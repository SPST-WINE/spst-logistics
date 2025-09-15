// assets/esm/rules/docs.js

// Paesi UE per derivare l'area (UE/ExtraUE)
const EU_COUNTRIES = new Set([
  "Italia","Francia","Germania","Spagna","Portogallo","Belgio","Olanda","Paesi Bassi","Austria",
  "Svezia","Finlandia","Danimarca","Repubblica Ceca","Slovacchia","Polonia","Ungheria","Irlanda",
  "Lituania","Lettonia","Estonia","Grecia","Romania","Bulgaria","Slovenia","Croazia","Lussemburgo",
  "Malta","Cipro"
]);
const isEU = c => EU_COUNTRIES.has(c);
const areaOf = c => isEU(c) ? 'UE' : 'ExtraUE';

// Regole documentali per destinazione/tipo
const RULES = [
  { when: {country:'USA', tipo:'Campionatura'}, require: ['Lettera_di_Vettura','Fattura_Proforma','FDA_Prior_Notice','Dichiarazione_Esportazione'], note: 'Etichette conformi FDA. COLA Waiver talvolta richiesto per campioni.' },
  { when: {country:'USA', tipo:'B2B'},         require: ['Lettera_di_Vettura','Fattura_Commerciale','FDA_Prior_Notice','Dichiarazione_Esportazione'] },
  { when: {country:'USA', tipo:'B2C'},         require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'] },
  { when: {country:'Canada', tipo:'Campionatura'}, require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'] },
  { when: {country:'Canada', tipo:'B2B'},          require: ['Lettera_di_Vettura','Fattura_Commerciale','Dichiarazione_Esportazione'] },
  { when: {country:'UK', tipo:'Campionatura'},     require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'] },
  { when: {country:'UK', tipo:'B2B'},              require: ['Lettera_di_Vettura','Fattura_Commerciale','Dichiarazione_Esportazione'] },
  { when: {country:'Svizzera', tipo:'Campionatura'}, require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'] },
  { when: {country:'Svizzera', tipo:'B2B'},          require: ['Lettera_di_Vettura','Fattura_Commerciale','Dichiarazione_Esportazione'] },
  { when: {country:'Hong Kong', tipo:'Campionatura'}, require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'], note:'Nessuna accisa sul vino.' },
  { when: {country:'Hong Kong', tipo:'B2B'},          require: ['Lettera_di_Vettura','Fattura_Commerciale','Dichiarazione_Esportazione'] },
  { when: {country:'Singapore', tipo:'Campionatura'}, require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'] },
  { when: {country:'Singapore', tipo:'B2B'},          require: ['Lettera_di_Vettura','Fattura_Commerciale','Dichiarazione_Esportazione'] },
  { when: {country:'Taiwan', tipo:'Campionatura'},    require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'] },
  { when: {country:'Taiwan', tipo:'B2B'},             require: ['Lettera_di_Vettura','Fattura_Commerciale','Certificato_di_Origine','Dichiarazione_Esportazione'], note:'Etichettatura in cinese obbligatoria.' },
  { when: {country:'Cina', tipo:'Campionatura'},      require: ['Lettera_di_Vettura','Fattura_Proforma','CIQ','Dichiarazione_Esportazione'] },
  { when: {country:'Cina', tipo:'B2B'},               require: ['Lettera_di_Vettura','Fattura_Commerciale','CIQ','Certificato_di_Origine','Dichiarazione_Esportazione'] },
  { when: {country:'Corea del Sud', tipo:'Campionatura'}, require: ['Lettera_di_Vettura','Fattura_Proforma','Certificato_Sanitario','Dichiarazione_Esportazione'] },
  { when: {country:'Corea del Sud', tipo:'B2B'},          require: ['Lettera_di_Vettura','Fattura_Commerciale','Certificato_Sanitario','Certificato_di_Origine','Dichiarazione_Esportazione'] },
  { when: {area:'UE', tipo:'B2B'},   require: ['Lettera_di_Vettura','Fattura_Commerciale','e-DAS'] },
  { when: {area:'UE', tipo:'B2C'},   require: ['Lettera_di_Vettura','Fattura_Proforma'] },
  { when: {area:'UE', tipo:'Campionatura'}, require: ['Lettera_di_Vettura'] },
  { when: {area:'ExtraUE', tipo:'B2B'},   require: ['Lettera_di_Vettura','Fattura_Commerciale','Dichiarazione_Esportazione'] },
  { when: {area:'ExtraUE', tipo:'Campionatura'}, require: ['Lettera_di_Vettura','Fattura_Proforma','Dichiarazione_Esportazione'] },
  { when: {}, require: ['Lettera_di_Vettura'] }
];

export function matchRules(rec){
  const country = rec.dest_paese || rec.paese || '';
  const tipo = rec.tipo_spedizione || '';
  const area = areaOf(country);
  const required = new Set(['Lettera_di_Vettura']);
  const notes = [];
  for (const r of RULES){
    const okCountry = !r.when.country || r.when.country === country;
    const okTipo    = !r.when.tipo    || r.when.tipo    === tipo;
    const okArea    = !r.when.area    || r.when.area    === area;
    if (okCountry && okTipo && okArea){
      (r.require||[]).forEach(d => required.add(d));
      if (r.note) notes.push(r.note);
    }
  }
  return { country, tipo, area, required: Array.from(required), notes };
}

export function computeRequiredDocs(rec){
  const {required, notes, country, tipo} = matchRules(rec);
  const have = Object.entries(rec.docs||{})
    .filter(([_,v]) => Boolean(v))
    .map(([k]) => k);
  const missing = required.filter(d => !have.includes(d));
  return { required, missing, notes, country, tipo };
}
