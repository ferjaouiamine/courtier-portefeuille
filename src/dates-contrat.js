'use strict';

function erreurSaisie(message) {
  const erreur = new Error(message);
  erreur.status = 400;
  return erreur;
}

function parserDateIso(valeur, libelle = "La date d'effet") {
  const correspondance = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valeur || ''));
  if (!correspondance) throw erreurSaisie(`${libelle} est invalide.`);
  const [, anneeTexte, moisTexte, jourTexte] = correspondance;
  const annee = Number(anneeTexte);
  const mois = Number(moisTexte);
  const jour = Number(jourTexte);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  if (date.getUTCFullYear() !== annee || date.getUTCMonth() !== mois - 1 || date.getUTCDate() !== jour) {
    throw erreurSaisie(`${libelle} est invalide.`);
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

function validerDateFinFerme(dateEffet, dateFin) {
  parserDateIso(dateEffet);
  parserDateIso(dateFin, 'La date de fin');
  if (dateFin <= dateEffet) {
    throw erreurSaisie("La date de fin doit être postérieure à la date d'effet.");
  }
  return dateFin;
}

function calculerDureeMoisEntreDates(dateEffet, dateFin) {
  const debut = parserDateIso(dateEffet);
  const fin = parserDateIso(dateFin, 'La date de fin');
  if (dateFin <= dateEffet) {
    throw erreurSaisie("La date de fin doit être postérieure à la date d'effet.");
  }
  const duree = (fin.annee - debut.annee) * 12 + fin.mois - debut.mois;
  if (duree <= 0 || duree > 1200) {
    throw erreurSaisie('La durée du contrat doit être comprise entre 1 et 1200 mois.');
  }
  return duree;
}

// Un contrat à durée ferme (DF) a une date de fin saisie. Un contrat RTR se
// renouvelle par tacite reconduction : il n'a pas de date de fin, seulement une
// période (12 mois par défaut) qui borne son échéancier jusqu'au renouvellement.
function calculerPeriodeContrat({ ferme, dateEffet, dateFin, dureeMois }) {
  if (ferme) {
    const fin = dateFin
      ? validerDateFinFerme(dateEffet, dateFin)
      : calculerDateFin(dateEffet, dureeMois ?? 12);
    return { dateFin: fin, dureeMois: calculerDureeMoisEntreDates(dateEffet, fin) };
  }
  const duree = Number(dureeMois);
  const periode = Number.isInteger(duree) && duree >= 1 && duree <= 1200 ? duree : 12;
  parserDateIso(dateEffet);
  return { dateFin: null, dureeMois: periode };
}

// Fin de la période en cours : la date de fin d'un DF, ou la prochaine date de
// renouvellement d'un RTR (calculée, jamais enregistrée).
function finDePeriode(contrat) {
  return contrat.date_fin || calculerDateFin(contrat.date_effet, contrat.duree_mois);
}

module.exports = {
  calculerDateFin,
  calculerDureeMoisEntreDates,
  calculerPeriodeContrat,
  finDePeriode,
  validerDateFinFerme,
};
