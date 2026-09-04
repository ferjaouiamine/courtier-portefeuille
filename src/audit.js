'use strict';

const CHAMPS_VISIBLES = {
  utilisateurs: ['nom', 'email', 'role', 'actif'],
  compagnies: ['code', 'nom'],
  produits: ['nom', 'branche'],
  clients: ['type_client', 'nom', 'cin_ou_matricule', 'telephone', 'code_client_finasure', 'date_naissance'],
  contrats: [
    'numero_contrat', 'societe_leasing', 'immatriculation', 'date_effet', 'duree_mois',
    'fractionnement', 'date_fin', 'prime_totale', 'statut',
  ],
  echeances: ['type_echeance', 'numero_terme', 'date_echeance', 'montant_prime', 'statut'],
  paiements: ['montant', 'mode_paiement', 'reference', 'date_paiement'],
  relances: ['type_relance', 'note', 'effectuee_le'],
  pieces_jointes_contrats: ['nom_original', 'type_mime', 'taille_octets'],
};

const LIBELLES_CHAMPS = {
  type_client: 'Type de client',
  nom: 'Nom',
  email: 'E-mail',
  role: 'Rôle',
  actif: 'Actif',
  code: 'Code',
  branche: 'Branche',
  cin_ou_matricule: 'CIN / matricule',
  telephone: 'Téléphone',
  code_client_finasure: 'Code Finasure',
  date_naissance: 'Date de naissance',
  numero_contrat: 'N° de contrat',
  societe_leasing: 'Société de leasing',
  immatriculation: 'Immatriculation',
  date_effet: "Date d'effet",
  duree_mois: 'Durée (mois)',
  fractionnement: 'Fréquence de paiement',
  date_fin: 'Date de fin',
  prime_totale: 'Prime totale',
  statut: 'Statut',
  type_echeance: "Type d'échéance",
  numero_terme: 'N° de terme',
  date_echeance: "Date d'échéance",
  montant_prime: 'Montant de la prime',
  montant: 'Montant',
  mode_paiement: 'Mode de paiement',
  reference: 'Référence',
  date_paiement: 'Date de paiement',
  type_relance: 'Type de relance',
  note: 'Note',
  effectuee_le: 'Date de relance',
  nom_original: 'Fichier',
  type_mime: 'Type de fichier',
  taille_octets: 'Taille',
};

function memeValeur(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function libelleElement(table, etat) {
  if (!etat) return 'Élément supprimé';
  if (table === 'contrats') return etat.numero_contrat || 'Contrat';
  if (table === 'clients' || table === 'compagnies' || table === 'produits' || table === 'utilisateurs') {
    return etat.nom || etat.email || 'Élément';
  }
  if (table === 'echeances') return etat.date_echeance ? `Échéance du ${etat.date_echeance}` : 'Échéance';
  if (table === 'paiements') return etat.montant !== undefined ? `Encaissement de ${etat.montant} DT` : 'Encaissement';
  if (table === 'relances') return etat.type_relance ? `Relance ${etat.type_relance}` : 'Relance';
  if (table === 'pieces_jointes_contrats') return etat.nom_original || 'Pièce jointe';
  return 'Élément';
}

function resumerLigneAudit(ligne) {
  const avant = ligne.etat_avant || {};
  const apres = ligne.etat_apres || {};
  const suppressionDefinitive = Boolean(apres.suppression_definitive);
  const etat = suppressionDefinitive ? avant : (Object.keys(apres).length ? apres : avant);
  const champs = CHAMPS_VISIBLES[ligne.table_cible] || [];
  const modifications = [];

  if (ligne.action === 'modification') {
    for (const champ of champs) {
      if (!memeValeur(avant[champ], apres[champ])) {
        modifications.push({
          champ: LIBELLES_CHAMPS[champ] || champ,
          avant: avant[champ] ?? null,
          apres: apres[champ] ?? null,
        });
      }
    }
  } else if (ligne.action === 'creation') {
    for (const champ of champs) {
      if (apres[champ] !== null && apres[champ] !== undefined && apres[champ] !== '') {
        modifications.push({ champ: LIBELLES_CHAMPS[champ] || champ, avant: null, apres: apres[champ] });
      }
    }
  }

  return {
    id: ligne.id,
    action: suppressionDefinitive ? 'suppression_definitive' : ligne.action,
    table_cible: ligne.table_cible,
    ligne_id: ligne.ligne_id,
    cree_le: ligne.cree_le,
    utilisateur_nom: ligne.utilisateur_nom
      || (ligne.utilisateur_id ? 'Utilisateur supprimé' : 'Système'),
    utilisateur_email: ligne.utilisateur_email || null,
    element: libelleElement(ligne.table_cible, etat),
    modifications,
  };
}

async function journaliser(client, { utilisateurId, action, tableCible, ligneId, etatAvant, etatApres }) {
  await client.query(
    `insert into journal_audit (utilisateur_id, action, table_cible, ligne_id, etat_avant, etat_apres)
     values ($1, $2, $3, $4, $5, $6)`,
    [utilisateurId || null, action, tableCible, ligneId || null, etatAvant || null, etatApres || null]
  );
}

module.exports = { journaliser, resumerLigneAudit };
