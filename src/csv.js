'use strict';

function echapperCsv(valeur) {
  const texte = valeur === null || valeur === undefined ? '' : String(valeur);
  return /[;"\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

function formaterNumeroContratCsv(valeur) {
  const texte = valeur === null || valeur === undefined ? '' : String(valeur);
  if (!texte) return '';
  // Force Excel à conserver les chiffres, les zéros initiaux et les identifiants longs.
  return echapperCsv(`="${texte.replace(/"/g, '""')}"`);
}

module.exports = { echapperCsv, formaterNumeroContratCsv };
