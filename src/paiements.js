'use strict';

async function synchroniserResumePaiementsContrat(client, contratId, utilisateurId) {
  const dernierPaiement = await client.query(
    `select p.feuille_caisse, p.com_nette, p.com_nette_saisie, p.remarque,
            coalesce(p.date_feuille_caisse, p.date_paiement) as date_mise_a_jour
     from paiements p
     join echeances e on e.id = p.echeance_id and e.supprime_le is null
     where e.contrat_id = $1 and p.supprime_le is null
     order by p.date_paiement desc, p.cree_le desc
     limit 1`,
    [contratId]
  );
  const paiement = dernierPaiement.rows[0];
  await client.query(
    `update contrats set
       feuille_caisse = $2,
       com_nette = $3,
       com_nette_saisie = $4,
       feuille_caisse_maj_le = $5,
       remarque = $6,
       modifie_par = $7,
       modifie_le = now()
     where id = $1 and supprime_le is null`,
    [
      contratId,
      Boolean(paiement?.feuille_caisse),
      paiement?.feuille_caisse ? paiement.com_nette : null,
      paiement?.feuille_caisse ? paiement.com_nette_saisie : null,
      paiement?.date_mise_a_jour || null,
      paiement?.remarque || null,
      utilisateurId,
    ]
  );
}

module.exports = { synchroniserResumePaiementsContrat };
