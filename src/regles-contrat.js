'use strict';

const TYPES_DUREE = new Set(['ferme', 'rtr']);
const FRACTIONNEMENTS_RTR = new Set(['annuel', 'semestriel', 'trimestriel']);
const MOIS_PAR_FRACTIONNEMENT = Object.freeze({ annuel: 12, semestriel: 6, trimestriel: 3 });

function erreurSaisie(message) {
  const erreur = new Error(message);
  erreur.status = 400;
  return erreur;
}

function typeDureeDepuisFractionnement(fractionnement) {
  return fractionnement === 'prime_unique' ? 'ferme' : 'rtr';
}

function moisDuFractionnement(fractionnement) {
  return MOIS_PAR_FRACTIONNEMENT[fractionnement] || null;
}

function normaliserFeuilleCaisse(feuilleCaisse, commissionNette) {
  if (feuilleCaisse !== true) {
    return { feuilleCaisse: false, commissionNette: null };
  }
  if (commissionNette === '' || commissionNette === null || commissionNette === undefined
      || !Number.isFinite(Number(commissionNette)) || Number(commissionNette) < 0) {
    throw erreurSaisie('La commission nette est obligatoire lorsque la feuille de caisse est disponible.');
  }
  return { feuilleCaisse: true, commissionNette: Number(commissionNette) };
}

function normaliserDureeEtFractionnement(typeDuree, fractionnement) {
  const typeNormalise = typeDuree || typeDureeDepuisFractionnement(fractionnement);
  if (!TYPES_DUREE.has(typeNormalise)) {
    throw erreurSaisie('La durée doit être ferme ou renouvelable par tacite reconduction (RTR).');
  }

  if (typeNormalise === 'ferme') {
    return { typeDuree: 'ferme', fractionnement: 'prime_unique' };
  }
  if (!FRACTIONNEMENTS_RTR.has(fractionnement)) {
    throw erreurSaisie('Un contrat RTR doit avoir une fréquence annuelle, semestrielle ou trimestrielle.');
  }
  return { typeDuree: 'rtr', fractionnement };
}

module.exports = {
  FRACTIONNEMENTS_RTR,
  moisDuFractionnement,
  normaliserFeuilleCaisse,
  normaliserDureeEtFractionnement,
  typeDureeDepuisFractionnement,
};
