// Espace super administrateur : gestion des comptes et tableau de bord comptable.
const express = require('express');
const { requete, transactionAvecUtilisateur } = require('../db');
const { exigerConnexion, hacherMotDePasse } = require('../auth');
const { gererErreur } = require('../erreurs');
const { lirePagination, reponsePaginee } = require('../pagination');

const routeur = express.Router();
routeur.use(exigerConnexion);

const ROLES = new Set(['admin', 'agent', 'lecture']);
const LONGUEUR_MIN_MOT_DE_PASSE = 8;
const FORMAT_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Le droit est relu en base à chaque appel : un retrait de droit ou une
// désactivation prend effet tout de suite, sans attendre l'expiration du jeton.
routeur.use(async (req, res, next) => {
  try {
    const resultat = await requete(
      `select 1 from utilisateurs
       where id = $1 and organisation_id = $2 and super_admin and supprime_le is null`,
      [req.utilisateur.id, req.utilisateur.organisationId]
    );
    if (resultat.rowCount === 0) {
      return res.status(403).json({ erreur: 'Cet espace est réservé au super administrateur.' });
    }
    return next();
  } catch (erreur) {
    return gererErreur(res, erreur, 'superadmin.droit');
  }
});

function erreurSaisie(message, status = 400) {
  const erreur = new Error(message);
  erreur.status = status;
  return erreur;
}

function lireMotDePasse(motDePasse) {
  const valeur = String(motDePasse || '');
  if (valeur.length < LONGUEUR_MIN_MOT_DE_PASSE) {
    throw erreurSaisie(`Le mot de passe doit contenir au moins ${LONGUEUR_MIN_MOT_DE_PASSE} caractères.`);
  }
  return valeur;
}

function lireSaisieUtilisateur(corps) {
  const nom = String(corps.nom || '').trim();
  const email = String(corps.email || '').trim().toLowerCase();
  if (!nom || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw erreurSaisie('Renseignez un nom et une adresse e-mail valide.');
  }
  if (!ROLES.has(corps.role)) throw erreurSaisie('Rôle invalide.');
  return { nom, email, role: corps.role, superAdmin: corps.superAdmin === true };
}

// Période d'analyse : par défaut du 1er janvier de l'année en cours à aujourd'hui.
function lirePeriode(query, aujourdhui = new Date().toISOString().slice(0, 10)) {
  const du = FORMAT_DATE.test(query.du || '') ? query.du : `${aujourdhui.slice(0, 4)}-01-01`;
  const au = FORMAT_DATE.test(query.au || '') ? query.au : aujourdhui;
  if (du > au) throw erreurSaisie('La date de début doit précéder la date de fin.');
  return { du, au };
}

const COLONNES_UTILISATEUR = `u.id, u.nom, u.email, u.role, u.super_admin, u.cree_le,
  u.supprime_le is null as actif`;

// =====================================================================
// Utilisateurs
// =====================================================================

routeur.get('/utilisateurs', async (req, res) => {
  try {
    const resultat = await requete(
      `select ${COLONNES_UTILISATEUR},
              (select max(j.cree_le) from journal_audit j
               where j.table_cible = 'utilisateurs' and j.ligne_id = u.id and j.action = 'connexion'
              ) as derniere_connexion
       from utilisateurs u
       where u.organisation_id = $1
       order by (u.supprime_le is not null), u.nom`,
      [req.utilisateur.organisationId]
    );
    res.json(resultat.rows);
  } catch (erreur) {
    gererErreur(res, erreur, 'superadmin.utilisateurs');
  }
});

routeur.post('/utilisateurs', async (req, res) => {
  try {
    const saisie = lireSaisieUtilisateur(req.body || {});
    const hache = await hacherMotDePasse(lireMotDePasse((req.body || {}).motDePasse));
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) => client.query(
      `insert into utilisateurs as u (organisation_id, nom, email, mot_de_passe_hache, role, super_admin)
       values ($1, $2, $3, $4, $5, $6)
       returning ${COLONNES_UTILISATEUR}`,
      [req.utilisateur.organisationId, saisie.nom, saisie.email, hache, saisie.role, saisie.superAdmin]
    ));
    res.status(201).json(resultat.rows[0]);
  } catch (erreur) {
    if (erreur.code === '23505') {
      return res.status(409).json({ erreur: 'Un compte existe déjà avec cette adresse e-mail.' });
    }
    return gererErreur(res, erreur, 'superadmin.utilisateur-creation');
  }
});

routeur.put('/utilisateurs/:id', async (req, res) => {
  try {
    const saisie = lireSaisieUtilisateur(req.body || {});
    if (req.params.id === req.utilisateur.id && !saisie.superAdmin) {
      throw erreurSaisie('Vous ne pouvez pas retirer votre propre droit de super administrateur.');
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) => client.query(
      `update utilisateurs u set nom = $1, email = $2, role = $3, super_admin = $4
       where u.id = $5 and u.organisation_id = $6
       returning ${COLONNES_UTILISATEUR}`,
      [saisie.nom, saisie.email, saisie.role, saisie.superAdmin, req.params.id, req.utilisateur.organisationId]
    ));
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
    return res.json(resultat.rows[0]);
  } catch (erreur) {
    if (erreur.code === '23505') {
      return res.status(409).json({ erreur: 'Un compte existe déjà avec cette adresse e-mail.' });
    }
    return gererErreur(res, erreur, 'superadmin.utilisateur-modification');
  }
});

// Les mots de passe sont hachés et ne peuvent pas être relus : le super
// administrateur en définit un nouveau à la place.
routeur.put('/utilisateurs/:id/mot-de-passe', async (req, res) => {
  try {
    const hache = await hacherMotDePasse(lireMotDePasse((req.body || {}).motDePasse));
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) => client.query(
      `update utilisateurs set mot_de_passe_hache = $1
       where id = $2 and organisation_id = $3 returning id`,
      [hache, req.params.id, req.utilisateur.organisationId]
    ));
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
    return res.json({ ok: true });
  } catch (erreur) {
    return gererErreur(res, erreur, 'superadmin.utilisateur-mot-de-passe');
  }
});

routeur.delete('/utilisateurs/:id', async (req, res) => {
  try {
    if (req.params.id === req.utilisateur.id) {
      throw erreurSaisie('Vous ne pouvez pas désactiver votre propre compte.');
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) => client.query(
      `update utilisateurs set supprime_le = now(), supprime_par = $1
       where id = $2 and organisation_id = $3 and supprime_le is null returning id`,
      [req.utilisateur.id, req.params.id, req.utilisateur.organisationId]
    ));
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Utilisateur introuvable ou déjà désactivé.' });
    return res.json({ ok: true });
  } catch (erreur) {
    return gererErreur(res, erreur, 'superadmin.utilisateur-desactivation');
  }
});

routeur.post('/utilisateurs/:id/restaurer', async (req, res) => {
  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) => client.query(
      `update utilisateurs set supprime_le = null, supprime_par = null
       where id = $1 and organisation_id = $2 and supprime_le is not null returning id`,
      [req.params.id, req.utilisateur.organisationId]
    ));
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: "Ce compte n'est pas désactivé." });
    return res.json({ ok: true });
  } catch (erreur) {
    return gererErreur(res, erreur, 'superadmin.utilisateur-restauration');
  }
});

// =====================================================================
// Comptabilité
//
// Une commission est souvent versée par lot : elle est alors saisie sur un seul
// dossier, et les autres dossiers du lot portent une commission à 0 avec une
// remarque qui indique où la trouver. Seule une commission à 0 sans remarque
// est donc signalée comme anomalie.
//
// Tous les totaux sont agrégés par PostgreSQL en une seule requête : le
// serveur ne charge jamais les paiements en mémoire. Le résultat est gardé
// une minute pour éviter de recalculer à chaque affichage.
// =====================================================================

const DUREE_CACHE_MS = 60 * 1000;
const TAILLE_MAX_CACHE = 50;
const cacheComptabilite = new Map();

const PAIEMENTS = `
  from paiements p
  join echeances e on e.id = p.echeance_id and e.supprime_le is null
  join contrats c on c.id = e.contrat_id and c.supprime_le is null
  join clients cl on cl.id = c.client_id and cl.supprime_le is null`;
const FILTRE_PERIODE = 'p.supprime_le is null and p.date_paiement between $1::date and $2::date';

routeur.get('/comptabilite', async (req, res) => {
  try {
    const { du, au } = lirePeriode(req.query);
    const cle = `${req.utilisateur.organisationId}|${du}|${au}`;
    // « frais=1 » force le recalcul juste après la modification d'un paiement.
    const enCache = req.query.frais ? null : cacheComptabilite.get(cle);
    if (enCache && Date.now() - enCache.le < DUREE_CACHE_MS) return res.json(enCache.donnees);

    const resultat = await requete(
      `with base as materialized (
         select p.montant, p.feuille_caisse, coalesce(p.com_nette, 0) as com_nette,
                p.date_paiement, p.saisi_par, c.compagnie_id, c.produit_id,
                nullif(trim(p.remarque), '') is not null as a_remarque
         ${PAIEMENTS}
         where ${FILTRE_PERIODE}
       )
       select
         (select jsonb_build_object(
            'encaisse', coalesce(sum(montant), 0),
            'commission_nette', coalesce(sum(com_nette), 0),
            'nb_paiements', count(*),
            'nb_sans_feuille', count(*) filter (where not feuille_caisse),
            'nb_commission_lot', count(*) filter (where feuille_caisse and com_nette = 0 and a_remarque),
            'nb_commission_nulle', count(*) filter (where feuille_caisse and com_nette = 0 and not a_remarque),
            'encaisse_sans_feuille', coalesce(sum(montant) filter (where not feuille_caisse), 0)
          ) from base) as totaux,
         (select coalesce(jsonb_agg(x order by x.mois), '[]'::jsonb) from (
            select to_char(date_trunc('month', date_paiement), 'YYYY-MM') as mois,
                   count(*) as nb_paiements, sum(montant) as encaisse, sum(com_nette) as commission_nette,
                   count(*) filter (where not feuille_caisse) as nb_sans_feuille,
                   count(*) filter (where feuille_caisse and com_nette = 0 and a_remarque) as nb_commission_lot,
                   count(*) filter (where feuille_caisse and com_nette = 0 and not a_remarque) as nb_commission_nulle
            from base group by 1) x) as par_mois,
         (select coalesce(jsonb_agg(x order by x.commission_nette desc), '[]'::jsonb) from (
            select cp.nom, sum(b.montant) as encaisse, sum(b.com_nette) as commission_nette
            from base b join compagnies cp on cp.id = b.compagnie_id group by cp.nom) x) as par_compagnie,
         (select coalesce(jsonb_agg(x order by x.commission_nette desc), '[]'::jsonb) from (
            select pr.branche as nom, sum(b.montant) as encaisse, sum(b.com_nette) as commission_nette
            from base b join produits pr on pr.id = b.produit_id group by pr.branche) x) as par_branche,
         (select coalesce(jsonb_agg(x order by x.commission_nette desc), '[]'::jsonb) from (
            select coalesce(u.nom, 'Non renseigné') as nom, count(*) as nb_paiements,
                   sum(b.montant) as encaisse, sum(b.com_nette) as commission_nette
            from base b left join utilisateurs u on u.id = b.saisi_par group by 1) x) as par_utilisateur`,
      [du, au]
    );
    const donnees = { du, au, ...resultat.rows[0] };
    if (cacheComptabilite.size >= TAILLE_MAX_CACHE) cacheComptabilite.clear();
    cacheComptabilite.set(cle, { le: Date.now(), donnees });
    return res.json(donnees);
  } catch (erreur) {
    return gererErreur(res, erreur, 'superadmin.comptabilite');
  }
});

// Filtres du détail, alignés sur les cartes du tableau de bord.
const FILTRES_PAIEMENTS = {
  sans_feuille: 'not p.feuille_caisse',
  commission_lot: "p.feuille_caisse and p.com_nette = 0 and nullif(trim(p.remarque), '') is not null",
  commission_nulle: "p.feuille_caisse and p.com_nette = 0 and nullif(trim(p.remarque), '') is null",
};

// Détail paginé des encaissements de la période (50 lignes par page).
routeur.get('/comptabilite/paiements', async (req, res) => {
  try {
    const { du, au } = lirePeriode(req.query);
    const filtre = FILTRES_PAIEMENTS[req.query.filtre];
    const { page, limite, offset } = lirePagination(req);
    const resultat = await requete(
      `select p.id, p.echeance_id, p.date_paiement, p.montant, p.mode_paiement, p.reference,
              p.remarque, p.feuille_caisse, p.date_feuille_caisse, p.com_nette, p.com_nette_saisie,
              c.id as contrat_id, c.numero_contrat,
              cl.nom as client_nom, cp.nom as compagnie_nom, u.nom as saisi_par_nom,
              count(*) over() as total_elements
       ${PAIEMENTS}
       join compagnies cp on cp.id = c.compagnie_id
       left join utilisateurs u on u.id = p.saisi_par
       where ${FILTRE_PERIODE}${filtre ? ` and ${filtre}` : ''}
       order by p.date_paiement desc, p.cree_le desc
       limit $3 offset $4`,
      [du, au, limite, offset]
    );
    res.json(reponsePaginee(resultat.rows, page, limite));
  } catch (erreur) {
    gererErreur(res, erreur, 'superadmin.comptabilite-paiements');
  }
});

module.exports = routeur;
module.exports.lirePeriode = lirePeriode;
module.exports.lireSaisieUtilisateur = lireSaisieUtilisateur;
