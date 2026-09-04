const express = require('express');
const { requete, transactionAvecUtilisateur } = require('../db');
const { exigerConnexion, exigerRole } = require('../auth');
const { gererErreur } = require('../erreurs');
const { lirePagination, reponsePaginee } = require('../pagination');
const { resumerLigneAudit } = require('../audit');

const routeur = express.Router();
routeur.use(exigerConnexion);

// Liste avec recherche libre par nom, CIN/matricule ou téléphone.
routeur.get('/', async (req, res) => {
  try {
    const recherche = (req.query.recherche || '').trim();
    const { page, limite, offset } = lirePagination(req);
    const parametres = [];
    let conditionRecherche = '';
    if (recherche) {
      parametres.push(recherche);
      conditionRecherche = `and (nom ilike '%' || $1 || '%' or cin_ou_matricule ilike '%' || $1 || '%'
        or telephone ilike '%' || $1 || '%')`;
    }
    parametres.push(limite, offset);
    const resultat = await requete(
      `select id, type_client, nom, cin_ou_matricule, telephone, code_client_finasure, date_naissance,
              count(*) over() as total_elements
       from clients
       where supprime_le is null ${conditionRecherche}
       order by nom
       limit $${parametres.length - 1} offset $${parametres.length}`,
      parametres
    );
    res.json(reponsePaginee(resultat.rows, page, limite));
  } catch (erreur) {
    gererErreur(res, erreur, 'clients.liste');
  }
});

// Fiche client : coordonnées + contrats + cumul des primes.
routeur.get('/:id', async (req, res) => {
  try {
    const client = await requete('select * from clients where id = $1 and supprime_le is null', [req.params.id]);
    if (client.rowCount === 0) {
      return res.status(404).json({ erreur: 'Client introuvable ou archivé.' });
    }

    const contrats = await requete(
      `select vp.contrat_id as id, vp.numero_contrat, vp.statut, vp.date_effet, vp.date_fin,
              vp.prime_totale, vp.compagnie_nom, vp.produit_nom,
              (select count(*)::int from pieces_jointes_contrats p where p.contrat_id = vp.contrat_id) as nombre_pieces
       from v_portefeuille vp
       where vp.client_id = $1 or vp.souscripteur_id = $1 or vp.societe_leasing_id = $1 or vp.payeur_id = $1
       order by date_effet desc`,
      [req.params.id]
    );

    const cumul = contrats.rows.reduce((acc, c) => acc + Number(c.prime_totale), 0);

    const historique = await requete(
      `select j.id, j.action, j.table_cible, j.ligne_id, j.etat_avant, j.etat_apres,
              j.cree_le, j.utilisateur_id, u.nom as utilisateur_nom, u.email as utilisateur_email
       from journal_audit j
       left join utilisateurs u on u.id = j.utilisateur_id and u.organisation_id = j.organisation_id
       where j.table_cible = 'clients' and j.ligne_id = $1
       order by j.cree_le desc
       limit 100`,
      [req.params.id]
    );

    res.json({
      ...client.rows[0],
      contrats: contrats.rows,
      cumulPrimes: cumul,
      historique: historique.rows.map(resumerLigneAudit),
    });
  } catch (erreur) {
    gererErreur(res, erreur, 'clients.fiche');
  }
});

routeur.post('/', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { typeClient, nom, cinOuMatricule, telephone, codeClientFinasure, dateNaissance } = req.body || {};
    if (!typeClient || !nom) {
      return res.status(400).json({ erreur: 'Le type de client et le nom sont obligatoires.' });
    }
    if (dateNaissance && dateNaissance > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ erreur: 'La date de naissance ne peut pas être dans le futur.' });
    }

    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `insert into clients (type_client, nom, cin_ou_matricule, telephone, code_client_finasure, date_naissance)
         values ($1, $2, $3, $4, $5, $6) returning *`,
        [typeClient, nom, cinOuMatricule || null, telephone || null, codeClientFinasure || null,
          typeClient === 'personne_physique' ? dateNaissance || null : null]
      )
    );

    res.status(201).json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'clients.creation');
  }
});

routeur.put('/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { typeClient, nom, cinOuMatricule, telephone, codeClientFinasure, dateNaissance } = req.body || {};
    if (dateNaissance && dateNaissance > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ erreur: 'La date de naissance ne peut pas être dans le futur.' });
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `update clients
         set type_client = $1, nom = $2, cin_ou_matricule = $3, telephone = $4,
             code_client_finasure = $5, date_naissance = $6, modifie_le = now()
         where id = $7 and supprime_le is null
         returning *`,
        [typeClient, nom, cinOuMatricule || null, telephone || null, codeClientFinasure || null,
          typeClient === 'personne_physique' ? dateNaissance || null : null, req.params.id]
      )
    );

    if (resultat.rowCount === 0) {
      return res.status(404).json({ erreur: 'Client introuvable ou archivé.' });
    }
    res.json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'clients.modification');
  }
});

// Archivage (suppression logique) : refusé tant qu'un contrat est en cours.
routeur.delete('/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const enCours = await requete(
      `select count(*)::int as total from contrats
       where (client_id = $1 or souscripteur_id = $1 or societe_leasing_id = $1 or payeur_id = $1)
         and statut = 'en_cours' and supprime_le is null`,
      [req.params.id]
    );
    if (enCours.rows[0].total > 0) {
      return res.status(409).json({
        erreur: `Ce client a ${enCours.rows[0].total} contrat(s) en cours. Résiliez ou archivez d'abord ses contrats.`,
      });
    }

    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `update clients set supprime_le = now(), supprime_par = $1
         where id = $2 and supprime_le is null returning id`,
        [req.utilisateur.id, req.params.id]
      )
    );

    if (resultat.rowCount === 0) {
      return res.status(404).json({ erreur: 'Client introuvable ou déjà archivé.' });
    }
    res.json({ ok: true });
  } catch (erreur) {
    gererErreur(res, erreur, 'clients.archivage');
  }
});

routeur.post('/:id/restaurer', exigerRole('admin'), async (req, res) => {
  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `update clients set supprime_le = null, supprime_par = null
         where id = $1 and supprime_le is not null returning *`,
        [req.params.id]
      )
    );

    if (resultat.rowCount === 0) {
      return res.status(404).json({ erreur: "Ce client n'est pas dans la corbeille." });
    }
    res.json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'clients.restauration');
  }
});

module.exports = routeur;
