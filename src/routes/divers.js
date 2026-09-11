const express = require('express');
const { requete, transactionAvecUtilisateur } = require('../db');
const { exigerConnexion, exigerRole } = require('../auth');
const { gererErreur } = require('../erreurs');
const { lirePagination, reponsePaginee } = require('../pagination');
const { journaliser, resumerLigneAudit } = require('../audit');
const stockage = require('../stockage');

const routeur = express.Router();
routeur.use(exigerConnexion);

const BRANCHES_VALIDES = ['AUTO', 'IARD', 'VIE', 'SANTE', 'VOYAGE', 'CREDIT', 'AUTRE'];

// =====================================================================
// Compagnies
// =====================================================================

routeur.get('/compagnies', async (req, res) => {
  try {
    const resultat = await requete('select * from compagnies where supprime_le is null order by nom');
    res.json(resultat.rows);
  } catch (erreur) {
    gererErreur(res, erreur, 'compagnies.liste');
  }
});

routeur.post('/compagnies', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { code, nom } = req.body || {};
    if (!code || !nom) {
      return res.status(400).json({ erreur: 'Le code et le nom de la compagnie sont obligatoires.' });
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query('insert into compagnies (code, nom) values ($1, $2) returning *', [code, nom])
    );
    res.status(201).json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'compagnies.creation');
  }
});

routeur.put('/compagnies/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { code, nom } = req.body || {};
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        'update compagnies set code = $1, nom = $2 where id = $3 and supprime_le is null returning *',
        [code, nom, req.params.id]
      )
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Compagnie introuvable ou archivée.' });
    res.json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'compagnies.modification');
  }
});

routeur.delete('/compagnies/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const enUsage = await requete(
      "select count(*)::int as total from contrats where compagnie_id = $1 and supprime_le is null",
      [req.params.id]
    );
    if (enUsage.rows[0].total > 0) {
      return res.status(409).json({ erreur: `Cette compagnie porte ${enUsage.rows[0].total} contrat(s). Archivez d'abord ces contrats.` });
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        'update compagnies set supprime_le = now(), supprime_par = $1 where id = $2 and supprime_le is null returning id',
        [req.utilisateur.id, req.params.id]
      )
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Compagnie introuvable ou déjà archivée.' });
    res.json({ ok: true });
  } catch (erreur) {
    gererErreur(res, erreur, 'compagnies.archivage');
  }
});

routeur.post('/compagnies/:id/restaurer', exigerRole('admin'), async (req, res) => {
  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        'update compagnies set supprime_le = null, supprime_par = null where id = $1 and supprime_le is not null returning *',
        [req.params.id]
      )
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: "Cette compagnie n'est pas dans la corbeille." });
    res.json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'compagnies.restauration');
  }
});

// =====================================================================
// Produits
// =====================================================================

routeur.get('/produits', async (req, res) => {
  try {
    const resultat = await requete('select * from produits where supprime_le is null order by branche, nom');
    res.json(resultat.rows);
  } catch (erreur) {
    gererErreur(res, erreur, 'produits.liste');
  }
});

routeur.post('/produits', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { nom, branche } = req.body || {};
    if (!nom || !BRANCHES_VALIDES.includes(branche)) {
      return res.status(400).json({ erreur: 'Le nom du produit et une branche valide sont obligatoires.' });
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query('insert into produits (nom, branche) values ($1, $2) returning *', [nom, branche])
    );
    res.status(201).json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'produits.creation');
  }
});

routeur.put('/produits/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { nom, branche } = req.body || {};
    if (!BRANCHES_VALIDES.includes(branche)) {
      return res.status(400).json({ erreur: 'Branche invalide.' });
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        'update produits set nom = $1, branche = $2 where id = $3 and supprime_le is null returning *',
        [nom, branche, req.params.id]
      )
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Produit introuvable ou archivé.' });
    res.json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'produits.modification');
  }
});

routeur.delete('/produits/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const enUsage = await requete(
      "select count(*)::int as total from contrats where produit_id = $1 and supprime_le is null",
      [req.params.id]
    );
    if (enUsage.rows[0].total > 0) {
      return res.status(409).json({ erreur: `Ce produit porte ${enUsage.rows[0].total} contrat(s). Archivez d'abord ces contrats.` });
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        'update produits set supprime_le = now(), supprime_par = $1 where id = $2 and supprime_le is null returning id',
        [req.utilisateur.id, req.params.id]
      )
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Produit introuvable ou déjà archivé.' });
    res.json({ ok: true });
  } catch (erreur) {
    gererErreur(res, erreur, 'produits.archivage');
  }
});

routeur.post('/produits/:id/restaurer', exigerRole('admin'), async (req, res) => {
  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        'update produits set supprime_le = null, supprime_par = null where id = $1 and supprime_le is not null returning *',
        [req.params.id]
      )
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: "Ce produit n'est pas dans la corbeille." });
    res.json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'produits.restauration');
  }
});

// =====================================================================
// Corbeille (réservée à l'administrateur)
// =====================================================================

routeur.get('/corbeille', exigerRole('admin'), async (req, res) => {
  try {
    const resultat = await requete('select * from v_corbeille order by supprime_le desc');
    res.json(resultat.rows);
  } catch (erreur) {
    gererErreur(res, erreur, 'corbeille.liste');
  }
});

routeur.delete('/corbeille/:table/:id', exigerRole('admin'), async (req, res) => {
  const { table, id } = req.params;
  const tablesAutorisees = ['clients', 'contrats', 'compagnies', 'produits'];
  if (!tablesAutorisees.includes(table)) {
    return res.status(400).json({ erreur: 'Type de contenu invalide.' });
  }

  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      if (table === 'contrats') {
        const contrat = await client.query(
          'select * from contrats where id = $1 and supprime_le is not null for update',
          [id]
        );
        if (contrat.rowCount === 0) return { introuvable: true };

        const renouvellements = await client.query(
          'select count(*)::int as total from contrats where contrat_precedent = $1',
          [id]
        );
        if (renouvellements.rows[0].total > 0) {
          return { bloque: 'Ce contrat est lié à un renouvellement. Supprimez d’abord les contrats suivants.' };
        }

        const pieces = await client.query(
          'select nom_stockage from pieces_jointes_contrats where contrat_id = $1',
          [id]
        );

        await client.query(
          'delete from relances where echeance_id in (select id from echeances where contrat_id = $1)',
          [id]
        );
        await client.query(
          'delete from paiements where echeance_id in (select id from echeances where contrat_id = $1)',
          [id]
        );
        await client.query('delete from pieces_jointes_contrats where contrat_id = $1', [id]);
        await client.query('delete from echeances where contrat_id = $1', [id]);
        await journaliser(client, {
          utilisateurId: req.utilisateur.id,
          action: 'suppression',
          tableCible: 'contrats',
          ligneId: id,
          etatAvant: contrat.rows[0],
          etatApres: { suppression_definitive: true },
        });
        await client.query('delete from contrats where id = $1', [id]);
        return { clesStockage: pieces.rows.map((piece) => piece.nom_stockage) };
      }

      const references = table === 'clients'
        ? await client.query(
          `select count(*)::int as total from contrats
           where client_id = $1 or souscripteur_id = $1 or societe_leasing_id = $1 or payeur_id = $1`,
          [id]
        )
        : await client.query(
          `select count(*)::int as total from contrats
           where ${table === 'compagnies' ? 'compagnie_id' : 'produit_id'} = $1`,
          [id]
        );
      if (references.rows[0].total > 0) {
        return { bloque: `Suppression impossible : ${references.rows[0].total} contrat(s) utilisent encore cet élément.` };
      }

      const element = await client.query(
        `select * from ${table} where id = $1 and supprime_le is not null for update`,
        [id]
      );
      if (element.rowCount === 0) return { introuvable: true };

      await journaliser(client, {
        utilisateurId: req.utilisateur.id,
        action: 'suppression',
        tableCible: table,
        ligneId: id,
        etatAvant: element.rows[0],
        etatApres: { suppression_definitive: true },
      });
      await client.query(`delete from ${table} where id = $1`, [id]);
      return {};
    });

    if (resultat.introuvable) {
      return res.status(404).json({ erreur: "Cet élément n'est pas dans la corbeille." });
    }
    if (resultat.bloque) {
      return res.status(409).json({ erreur: resultat.bloque });
    }

    const suppressions = await Promise.allSettled(
      (resultat.clesStockage || []).map((cle) => stockage.supprimer(cle))
    );
    const fichiersNonSupprimes = suppressions.filter((operation) => operation.status === 'rejected').length;
    if (fichiersNonSupprimes > 0) {
      console.error(`[corbeille.suppression-fichiers] ${fichiersNonSupprimes} fichier(s) non supprimé(s)`);
    }
    res.json({ ok: true, fichiersNonSupprimes });
  } catch (erreur) {
    gererErreur(res, erreur, 'corbeille.suppression-definitive');
  }
});

// Journal transversal, réservé aux administrateurs de l'organisation courante.
routeur.get('/journal-audit', exigerRole('admin'), async (req, res) => {
  try {
    const { action, table: tableCible, recherche } = req.query;
    const { page, limite, offset } = lirePagination(req);
    const conditions = ['1 = 1'];
    const parametres = [];

    if (action === 'suppression_definitive') {
      conditions.push("j.action = 'suppression' and coalesce((j.etat_apres ->> 'suppression_definitive')::boolean, false)");
    } else if (action === 'suppression') {
      conditions.push("j.action = 'suppression' and not coalesce((j.etat_apres ->> 'suppression_definitive')::boolean, false)");
    } else if (action) {
      parametres.push(action);
      conditions.push(`j.action = $${parametres.length}`);
    }
    if (tableCible) {
      parametres.push(tableCible);
      conditions.push(`j.table_cible = $${parametres.length}`);
    }
    if (recherche) {
      parametres.push(`%${recherche}%`);
      conditions.push(`(
        coalesce(u.nom, '') ilike $${parametres.length}
        or coalesce(u.email, '') ilike $${parametres.length}
        or j.table_cible ilike $${parametres.length}
        or coalesce(j.etat_apres ->> 'nom', j.etat_avant ->> 'nom', '') ilike $${parametres.length}
        or coalesce(j.etat_apres ->> 'numero_contrat', j.etat_avant ->> 'numero_contrat', '') ilike $${parametres.length}
        or coalesce(j.etat_apres ->> 'nom_original', j.etat_avant ->> 'nom_original', '') ilike $${parametres.length}
        or coalesce(j.etat_apres ->> 'reference', j.etat_avant ->> 'reference', '') ilike $${parametres.length}
      )`);
    }

    parametres.push(limite, offset);
    const resultat = await requete(
      `select j.id, j.action, j.table_cible, j.ligne_id, j.etat_avant, j.etat_apres,
              j.cree_le, j.utilisateur_id, u.nom as utilisateur_nom, u.email as utilisateur_email,
              count(*) over() as total_elements
       from journal_audit j
       left join utilisateurs u on u.id = j.utilisateur_id and u.organisation_id = j.organisation_id
       where ${conditions.join(' and ')}
       order by j.cree_le desc
       limit $${parametres.length - 1} offset $${parametres.length}`,
      parametres
    );

    const reponse = reponsePaginee(resultat.rows, page, limite);
    reponse.donnees = reponse.donnees.map(resumerLigneAudit);
    res.json(reponse);
  } catch (erreur) {
    gererErreur(res, erreur, 'journal-audit.liste');
  }
});

// =====================================================================
// Tableau de bord
// =====================================================================

routeur.get('/tableau-de-bord', async (req, res) => {
  try {
    const [compteurs, parCompagnie, parBranche, encaissements, frise] = await Promise.all([
      requete(`
        select
          count(*)::int as total_contrats,
          count(*) filter (where c.statut = 'en_cours')::int as contrats_en_cours,
          coalesce(sum(c.prime_totale) filter (where c.statut = 'en_cours'), 0) as primes_emises
        from contrats c
        join clients cl on cl.id = c.client_id and cl.supprime_le is null
        where c.supprime_le is null
      `),
      requete(`
        select compagnie_nom, count(*)::int as nb_contrats, coalesce(sum(prime_totale), 0) as primes
        from v_portefeuille group by compagnie_nom order by primes desc
      `),
      requete(`
        select branche, count(*)::int as nb_contrats, coalesce(sum(prime_totale), 0) as primes
        from v_portefeuille group by branche order by primes desc
      `),
      requete(`
        select to_char(date_trunc('month', date_paiement), 'YYYY-MM') as mois, coalesce(sum(montant), 0) as total
        from paiements p
        join echeances e on e.id = p.echeance_id and e.supprime_le is null
        join contrats c on c.id = e.contrat_id and c.supprime_le is null
        join clients cl on cl.id = c.client_id and cl.supprime_le is null
        where p.supprime_le is null
          and p.date_paiement >= date_trunc('month', current_date) - interval '11 months'
          and p.date_paiement <= current_date
        group by 1 order by 1
      `),
      requete(`
        select echeance_id, contrat_id, type_echeance, date_echeance, niveau, jours_restants,
               client_nom, numero_contrat, compagnie_nom, montant_prime, montant_regle
        from v_echeances
        where statut <> 'payee' and type_echeance = 'terme'
          and date_echeance between current_date and current_date + 120
        order by date_echeance
      `),
    ]);

    const echeancesUrgence = await requete(`
      select
        count(*) filter (where niveau = 'en_retard')::int as en_retard,
        count(*) filter (where jours_restants <= 30 and niveau <> 'en_retard')::int as sous_30_jours
      from v_echeances where statut <> 'payee' and type_echeance = 'terme'
    `);

    res.json({
      ...compteurs.rows[0],
      ...echeancesUrgence.rows[0],
      parCompagnie: parCompagnie.rows,
      parBranche: parBranche.rows,
      encaissements12Mois: encaissements.rows,
      frise120Jours: frise.rows,
    });
  } catch (erreur) {
    gererErreur(res, erreur, 'tableauDeBord');
  }
});

// =====================================================================
// Export CSV (UTF-8 avec BOM, séparateur ';', pour Excel en français)
// =====================================================================

function formaterMontantCsv(valeur) {
  return String(valeur).replace('.', ',');
}

function formaterDateCsv(valeur) {
  if (!valeur) return '';
  const d = new Date(valeur);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function echapperCsv(valeur) {
  const texte = valeur === null || valeur === undefined ? '' : String(valeur);
  return /[;"\n]/.test(texte) ? `"${texte.replace(/"/g, '""')}"` : texte;
}

routeur.get('/export/portefeuille.csv', async (req, res) => {
  try {
    const { statut, compagnie_id: compagnieId, produit_id: produitId, recherche } = req.query;
    const conditions = ['c.supprime_le is null'];
    const parametres = [];

    if (statut) {
      parametres.push(statut);
      conditions.push(`c.statut = $${parametres.length}`);
    }
    if (compagnieId) {
      parametres.push(compagnieId);
      conditions.push(`c.compagnie_id = $${parametres.length}`);
    }
    if (produitId) {
      parametres.push(produitId);
      conditions.push(`c.produit_id = $${parametres.length}`);
    }
    if (recherche) {
      parametres.push(`%${recherche}%`);
      conditions.push(`(cl.nom ilike $${parametres.length} or c.numero_contrat ilike $${parametres.length})`);
    }

    const resultat = await requete(
      `select c.numero_contrat, cl.nom as client_nom, cp.nom as compagnie_nom, pr.nom as produit_nom,
              c.statut, c.date_effet, c.date_fin, c.fractionnement,
              case when c.fractionnement = 'prime_unique' then 'ferme' else 'rtr' end as type_duree,
              c.prime_totale
       from contrats c
       join clients cl on cl.id = c.client_id
       join compagnies cp on cp.id = c.compagnie_id
       join produits pr on pr.id = c.produit_id
       where ${conditions.join(' and ')}
       order by c.date_effet desc`,
      parametres
    );

    const entetes = [
      'Numéro de contrat', 'Client', 'Compagnie', 'Produit', 'Statut',
      "Date d'effet", 'Date de fin (durée ferme)', 'Durée du contrat', 'Fréquence de paiement',
      'Prime totale',
    ];

    const lignes = [entetes.join(';')];
    for (const ligne of resultat.rows) {
      lignes.push([
        echapperCsv(ligne.numero_contrat),
        echapperCsv(ligne.client_nom),
        echapperCsv(ligne.compagnie_nom),
        echapperCsv(ligne.produit_nom),
        echapperCsv(ligne.statut),
        formaterDateCsv(ligne.date_effet),
        ligne.type_duree === 'ferme' ? formaterDateCsv(ligne.date_fin) : '',
        echapperCsv(ligne.type_duree === 'ferme'
          ? 'Durée ferme'
          : 'Renouvelable par tacite reconduction (RTR)'),
        echapperCsv(ligne.fractionnement),
        formaterMontantCsv(ligne.prime_totale),
      ].join(';'));
    }

    const contenu = '﻿' + lignes.join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="portefeuille.csv"');
    res.send(contenu);
  } catch (erreur) {
    gererErreur(res, erreur, 'export.portefeuille');
  }
});

module.exports = routeur;
