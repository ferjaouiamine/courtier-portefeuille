'use strict';

const { synchroniserProchaineEcheance } = require('./echeancier');

const CHAMPS_AVENANT = [
  ['souscripteur_id', 'Souscripteur'],
  ['societe_leasing', 'Société de leasing'],
  ['payeur_id', 'Payeur'],
  ['compagnie_id', 'Compagnie'],
  ['produit_id', 'Produit'],
  ['type_contrat', 'Type de contrat'],
  ['immatriculation', 'Immatriculation'],
  ['date_fin_contrat', 'Date de fin du contrat'],
  ['duree_mois', 'Durée'],
  ['fractionnement', 'Fréquence de paiement'],
  ['prime_totale', 'Prime totale'],
  ['retour_feuille_caisse', 'Retour feuille de caisse'],
  ['remarque', 'Remarque'],
  ['statut', 'Statut'],
];

function valeurComparable(champ, valeur) {
  if (valeur === undefined || valeur === '' || valeur === null) return null;
  if (['prime_totale', 'duree_mois'].includes(champ)) return Number(valeur);
  return valeur;
}

function calculerModifications(ancienneVersion, nouvelleVersion) {
  return CHAMPS_AVENANT.flatMap(([champ, libelle]) => {
    const avant = valeurComparable(champ, ancienneVersion[champ]);
    const apres = valeurComparable(champ, nouvelleVersion[champ]);
    return String(avant ?? '') === String(apres ?? '')
      ? []
      : [{ champ, libelle, avant, apres }];
  });
}

async function creerVersionInitiale(client, contrat) {
  await client.query(
    `insert into avenants_contrats (
       organisation_id, contrat_id, numero_version, date_effet, souscripteur_id,
       societe_leasing, payeur_id, compagnie_id, produit_id, type_contrat,
       immatriculation, date_fin_contrat, duree_mois, fractionnement, prime_totale,
       retour_feuille_caisse, remarque, statut, modifications, cree_par, cree_le, applique_le
     ) values (
       $1, $2, 1, $3, $4, $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14, $15, $16, $17, '[]'::jsonb, $18, $19, $19
     ) on conflict (contrat_id, numero_version) do nothing`,
    [
      contrat.organisation_id, contrat.id, contrat.date_effet, contrat.souscripteur_id,
      contrat.societe_leasing, contrat.payeur_id, contrat.compagnie_id, contrat.produit_id,
      contrat.type_contrat, contrat.immatriculation, contrat.date_fin, contrat.duree_mois,
      contrat.fractionnement, contrat.prime_totale, contrat.retour_feuille_caisse,
      contrat.remarque, contrat.statut, contrat.cree_par, contrat.cree_le,
    ]
  );
}

// La prime saisie sur un avenant s'ajoute à la prime de la version précédente.
function calculerPrimeTotale(primePrecedente, primeAvenant) {
  return Math.round((Number(primePrecedente) + Number(primeAvenant)) * 1000) / 1000;
}

// Recopie sur le contrat la version en vigueur aujourd'hui. Sert aussi à revenir
// à la version précédente après la suppression ou le report d'un avenant.
async function appliquerVersionCourante(client, contratId, utilisateurId = null) {
  const version = await client.query(
    `select * from avenants_contrats
     where contrat_id = $1 and date_effet <= current_date
     order by date_effet desc, numero_version desc limit 1`,
    [contratId]
  );
  if (!version.rows[0]) return null;
  const v = version.rows[0];
  const resultat = await client.query(
    `update contrats set
       souscripteur_id = $2, societe_leasing = $3, payeur_id = $4,
       compagnie_id = $5, produit_id = $6, type_contrat = $7, immatriculation = $8,
       date_fin = $9, duree_mois = $10, fractionnement = $11, prime_totale = $12,
       retour_feuille_caisse = $13, remarque = $14, statut = $15,
       modifie_par = coalesce($16, modifie_par), modifie_le = now()
     where id = $1 and supprime_le is null returning *`,
    [
      contratId, v.souscripteur_id, v.societe_leasing, v.payeur_id,
      v.compagnie_id, v.produit_id, v.type_contrat, v.immatriculation,
      v.date_fin_contrat, v.duree_mois, v.fractionnement, v.prime_totale,
      v.retour_feuille_caisse, v.remarque, v.statut, utilisateurId,
    ]
  );
  await client.query(
    `update avenants_contrats set applique_le = now()
     where contrat_id = $1 and date_effet <= current_date and applique_le is null`,
    [contratId]
  );
  if (resultat.rows[0]) await synchroniserProchaineEcheance(client, resultat.rows[0]);
  return resultat.rows[0] || null;
}

async function appliquerAvenantsDus(client, utilisateurId = null) {
  const contrats = await client.query(
    `select distinct contrat_id
     from avenants_contrats
     where numero_version > 1 and applique_le is null and date_effet <= current_date`
  );
  for (const { contrat_id: contratId } of contrats.rows) {
    await appliquerVersionCourante(client, contratId, utilisateurId);
  }
  return contrats.rowCount;
}

module.exports = {
  appliquerAvenantsDus,
  appliquerVersionCourante,
  calculerModifications,
  calculerPrimeTotale,
  creerVersionInitiale,
};
