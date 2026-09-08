'use strict';

function erreurSaisie(message) {
  const erreur = new Error(message);
  erreur.status = 400;
  return erreur;
}

function parserDateIso(valeur) {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valeur || ''));
  if (!correspondance) throw erreurSaisie("La date d'effet est invalide.");
  const [, anneeTexte, moisTexte, jourTexte] = correspondance;
  const annee = Number(anneeTexte);
  const mois = Number(moisTexte);
  const jour = Number(jourTexte);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  if (date.getUTCFullYear() !== annee || date.getUTCMonth() !== mois - 1 || date.getUTCDate() !== jour) {
    throw erreurSaisie("La date d'effet est invalide.");
  }
  return { annee, mois, jour };
}

function calculerDateFin(dateEffet, dureeMois) {
  const duree = Number(dureeMois);
  if (!Number.isInteger(duree) || duree <= 0 || duree > 1200) {
    throw erreurSaisie('La durée du contrat doit être un nombre entier compris entre 1 et 1200 mois.');
  }

  const { annee, mois, jour } = parserDateIso(dateEffet);
  const indexCible = mois - 1 + duree;
  const anneeCible = annee + Math.floor(indexCible / 12);
  const moisCible = ((indexCible % 12) + 12) % 12;
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate();
  return `${anneeCible}-${String(moisCible + 1).padStart(2, '0')}-${String(Math.min(jour, dernierJour)).padStart(2, '0')}`;
}

module.exports = { calculerDateFin };
