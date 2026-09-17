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
    return { feuilleCaisse: false, commissionNette: null, commissionNetteSaisie: null };
  }
  const commissionNetteSaisie = String(commissionNette ?? '').trim();
  const correspondance = commissionNetteSaisie.match(/-?\d[\d\s.,]*/);
  let valeurNormalisee = correspondance?.[0]?.replace(/\s/g, '') || '';
  const derniereVirgule = valeurNormalisee.lastIndexOf(',');
  const dernierPoint = valeurNormalisee.lastIndexOf('.');
  const separateurDecimal = Math.max(derniereVirgule, dernierPoint);
  if (separateurDecimal >= 0) {
    const entiers = valeurNormalisee.slice(0, separateurDecimal).replace(/[.,]/g, '');
    const decimales = valeurNormalisee.slice(separateurDecimal + 1).replace(/[.,]/g, '');
    valeurNormalisee = decimales ? `${entiers}.${decimales}` : entiers;
  }
  const valeurNumerique = Number(valeurNormalisee);
  if (!commissionNetteSaisie || !correspondance || !Number.isFinite(valeurNumerique) || valeurNumerique < 0) {
    throw erreurSaisie('La commission nette est obligatoire lorsque la feuille de caisse est disponible.');
  }
  return {
    feuilleCaisse: true,
    commissionNette: Math.round(valeurNumerique * 1000) / 1000,
    commissionNetteSaisie,
  };
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
