'use strict';

const TYPES_DUREE = new Set(['ferme', 'rtr']);
const FRACTIONNEMENTS_RTR = new Set(['annuel', 'semestriel', 'trimestriel']);

function erreurSaisie(message) {
  const erreur = new Error(message);
  erreur.status = 400;
  return erreur;
}

function typeDureeDepuisFractionnement(fractionnement) {
  return fractionnement === 'prime_unique' ? 'ferme' : 'rtr';
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
  normaliserDureeEtFractionnement,
  typeDureeDepuisFractionnement,
};
