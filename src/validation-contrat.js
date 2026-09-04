'use strict';

const FREQUENCES_MOIS = Object.freeze({
  trimestriel: 3,
  semestriel: 6,
  annuel: 12,
});

const FRACTIONNEMENTS = new Set([...Object.keys(FREQUENCES_MOIS), 'prime_unique']);

function erreurValidation(message) {
  const erreur = new Error(message);
  erreur.status = 400;
  return erreur;
}

function lireDateISO(valeur) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(valeur || ''))) return null;
  const [annee, mois, jour] = valeur.split('-').map(Number);
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  if (
    date.getUTCFullYear() !== annee
    || date.getUTCMonth() !== mois - 1
    || date.getUTCDate() !== jour
  ) return null;
  return { annee, mois, jour };
}

function formaterDateISO(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function ajouterMois(dateISO, nombreMois) {
  const date = lireDateISO(dateISO);
  if (!date || !Number.isInteger(nombreMois)) return null;

  const indexCible = date.mois - 1 + nombreMois;
  const anneeCible = date.annee + Math.floor(indexCible / 12);
  const moisCible = ((indexCible % 12) + 12) % 12;
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anneeCible, moisCible, Math.min(date.jour, dernierJour)));
}

function calculerDateFin(dateEffet, dureeMois) {
  const borneSuivante = ajouterMois(dateEffet, dureeMois);
  if (!borneSuivante) return null;
  borneSuivante.setUTCDate(borneSuivante.getUTCDate() - 1);
  return formaterDateISO(borneSuivante);
}

function validerPeriodeContrat({ dateEffet, dureeMois, fractionnement, dateFin }) {
  if (!lireDateISO(dateEffet)) {
    throw erreurValidation("La date d'effet est invalide.");
  }

  const duree = Number(dureeMois);
  if (!Number.isInteger(duree) || duree < 1 || duree > 120) {
    throw erreurValidation('La durée du contrat doit être un nombre entier compris entre 1 et 120 mois.');
  }
  if (!FRACTIONNEMENTS.has(fractionnement)) {
    throw erreurValidation('La fréquence de paiement est invalide.');
  }

  const minimum = FREQUENCES_MOIS[fractionnement];
  if (minimum && duree < minimum) {
    throw erreurValidation(`Une fréquence de ${minimum} mois nécessite un contrat d'au moins ${minimum} mois.`);
  }

  const dateFinCalculee = calculerDateFin(dateEffet, duree);
  if (dateFin && dateFin !== dateFinCalculee) {
    throw erreurValidation(
      `La date de fin doit être le ${dateFinCalculee} pour une durée de ${duree} mois à partir du ${dateEffet}.`
    );
  }

  return { dureeMois: duree, dateFin: dateFinCalculee };
}

module.exports = { FREQUENCES_MOIS, ajouterMois, calculerDateFin, validerPeriodeContrat };
