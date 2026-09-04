const express = require('express');
const multer = require('multer');
const { requete, transactionAvecUtilisateur } = require('../db');
const { exigerConnexion, exigerRole } = require('../auth');
const { gererErreur } = require('../erreurs');
const { lirePagination, reponsePaginee } = require('../pagination');
const { validerPeriodeContrat } = require('../validation-contrat');
const stockage = require('../stockage');

const routeur = express.Router();
routeur.use(exigerConnexion);

const TYPES_PIECES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const televerserPiece = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, fichier, callback) => {
    if (TYPES_PIECES.has(fichier.mimetype)) return callback(null, true);
    const erreur = new Error('Seuls les fichiers PDF, JPG et PNG sont acceptés.');
    erreur.code = 'TYPE_FICHIER_REFUSE';
    return callback(erreur);
  },
});

async function effacerFichierSiPresent(cleStockage) {
  try {
    await stockage.supprimer(cleStockage);
  } catch (erreur) {
    console.error('[pieces-jointes.suppression-fichier]', erreur);
  }
}

const TRIS_AUTORISES = {
  date_effet: 'c.date_effet',
  date_fin: 'c.date_fin',
  prime_totale: 'c.prime_totale',
  client_nom: 'cl.nom',
  numero_contrat: 'c.numero_contrat',
};

// Liste triable et filtrable du portefeuille.
routeur.get('/', async (req, res) => {
  try {
    const { statut, compagnie_id: compagnieId, produit_id: produitId, recherche } = req.query;
    const tri = TRIS_AUTORISES[req.query.tri] || 'c.date_effet';
    const ordre = req.query.ordre === 'asc' ? 'asc' : 'desc';
    const { page, limite, offset } = lirePagination(req);

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
      conditions.push(`(cl.nom ilike $${parametres.length} or s.nom ilike $${parametres.length}
        or sl.nom ilike $${parametres.length} or pa.nom ilike $${parametres.length}
        or c.numero_contrat ilike $${parametres.length})`);
    }

    parametres.push(limite, offset);
    const resultat = await requete(
      `select c.id, c.numero_contrat, c.statut, c.date_effet, c.date_fin, c.fractionnement,
              c.prime_totale,
              cl.id as client_id, cl.nom as client_nom, cl.telephone as client_telephone,
              s.id as souscripteur_id, s.nom as souscripteur_nom,
              sl.id as societe_leasing_id, coalesce(nullif(c.societe_leasing, ''), sl.nom) as societe_leasing_nom,
              pa.id as payeur_id, pa.nom as payeur_nom,
              cp.id as compagnie_id, cp.nom as compagnie_nom,
              pr.id as produit_id, pr.nom as produit_nom, pr.branche,
              count(*) over() as total_elements
       from contrats c
       join clients cl on cl.id = c.client_id
       left join clients s on s.id = c.souscripteur_id
       left join clients sl on sl.id = c.societe_leasing_id
       left join clients pa on pa.id = c.payeur_id
       join compagnies cp on cp.id = c.compagnie_id
       join produits pr on pr.id = c.produit_id
       where ${conditions.join(' and ')}
       order by ${tri} ${ordre}
       limit $${parametres.length - 1} offset $${parametres.length}`,
      parametres
    );

    res.json(reponsePaginee(resultat.rows, page, limite));
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.liste');
  }
});

// Fiche contrat : échéancier complet, paiements rattachés et historique des modifications.
routeur.get('/:id', async (req, res) => {
  try {
    const contrat = await requete(
      `select c.*, cl.nom as client_nom, cl.telephone as client_telephone,
              s.nom as souscripteur_nom,
              coalesce(nullif(c.societe_leasing, ''), sl.nom) as societe_leasing_nom,
              pa.nom as payeur_nom,
              cp.nom as compagnie_nom, pr.nom as produit_nom, pr.branche
       from contrats c
       join clients cl on cl.id = c.client_id
       left join clients s on s.id = c.souscripteur_id
       left join clients sl on sl.id = c.societe_leasing_id
       left join clients pa on pa.id = c.payeur_id
       join compagnies cp on cp.id = c.compagnie_id
       join produits pr on pr.id = c.produit_id
       where c.id = $1 and c.supprime_le is null`,
      [req.params.id]
    );
    if (contrat.rowCount === 0) {
      return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    }

    const echeances = await requete(
      `select e.*, coalesce(pmt.montant_regle, 0) as montant_regle
       from echeances e
       left join lateral (
         select sum(montant) as montant_regle from paiements
         where echeance_id = e.id and supprime_le is null
       ) pmt on true
       where e.contrat_id = $1 and e.supprime_le is null
       order by e.type_echeance desc, e.numero_terme`,
      [req.params.id]
    );

    const paiements = await requete(
      `select p.* from paiements p
       join echeances e on e.id = p.echeance_id
       where e.contrat_id = $1 and p.supprime_le is null
       order by p.date_paiement desc`,
      [req.params.id]
    );

    const historique = await requete(
      `select action, etat_avant, etat_apres, cree_le, utilisateur_id
       from journal_audit
       where table_cible = 'contrats' and ligne_id = $1
       order by cree_le desc
       limit 100`,
      [req.params.id]
    );

    const piecesJointes = await requete(
      `select id, nom_original, type_mime, taille_octets, ajoute_le
       from pieces_jointes_contrats
       where contrat_id = $1
       order by ajoute_le desc`,
      [req.params.id]
    );

    res.json({
      ...contrat.rows[0],
      echeances: echeances.rows,
      paiements: paiements.rows,
      historique: historique.rows,
      piecesJointes: piecesJointes.rows,
    });
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.fiche');
  }
});

routeur.post('/:id/pieces-jointes', exigerRole('admin', 'agent'), (req, res) => {
  televerserPiece.single('fichier')(req, res, async (erreurTeleversement) => {
    if (erreurTeleversement) {
      const message = erreurTeleversement.code === 'LIMIT_FILE_SIZE'
        ? 'Le fichier dépasse la taille maximale de 10 Mo.'
        : erreurTeleversement.message;
      return res.status(400).json({ erreur: message });
    }
    if (!req.file) return res.status(400).json({ erreur: 'Sélectionnez un fichier à joindre.' });

    try {
      const contrat = await requete(
        'select id from contrats where id = $1 and supprime_le is null',
        [req.params.id]
      );
      if (contrat.rowCount === 0) {
        return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
      }

      const cleStockage = stockage.nouvelleCle({
        organisationId: req.utilisateur.organisationId,
        contratId: req.params.id,
        nomOriginal: req.file.originalname,
      });
      await stockage.enregistrer({
        cle: cleStockage,
        contenu: req.file.buffer,
        typeMime: req.file.mimetype,
      });

      let piece;
      try {
        piece = await requete(
          `insert into pieces_jointes_contrats
             (contrat_id, nom_original, nom_stockage, type_mime, taille_octets, ajoute_par)
           values ($1, $2, $3, $4, $5, $6)
           returning id, nom_original, type_mime, taille_octets, ajoute_le`,
          [req.params.id, req.file.originalname, cleStockage, req.file.mimetype, req.file.size, req.utilisateur.id]
        );
      } catch (erreur) {
        await effacerFichierSiPresent(cleStockage);
        throw erreur;
      }
      return res.status(201).json(piece.rows[0]);
    } catch (erreur) {
      return gererErreur(res, erreur, 'pieces-jointes.ajout');
    }
  });
});

routeur.get('/:id/pieces-jointes/:pieceId/telecharger', async (req, res) => {
  try {
    const resultat = await requete(
      `select p.nom_original, p.nom_stockage
       from pieces_jointes_contrats p
       join contrats c on c.id = p.contrat_id
       where p.id = $1 and p.contrat_id = $2 and c.supprime_le is null`,
      [req.params.pieceId, req.params.id]
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Pièce jointe introuvable.' });
    const piece = resultat.rows[0];
    const objet = await stockage.lire(piece.nom_stockage);
    res.attachment(piece.nom_original);
    if (objet.taille) res.setHeader('Content-Length', objet.taille);
    objet.flux.on('error', (erreur) => {
      console.error('[pieces-jointes.flux]', erreur);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(erreur);
    });
    return objet.flux.pipe(res);
  } catch (erreur) {
    return gererErreur(res, erreur, 'pieces-jointes.telechargement');
  }
});

routeur.delete('/:id/pieces-jointes/:pieceId', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const resultat = await requete(
      `delete from pieces_jointes_contrats
       where id = $1 and contrat_id = $2
       returning nom_stockage`,
      [req.params.pieceId, req.params.id]
    );
    if (resultat.rowCount === 0) return res.status(404).json({ erreur: 'Pièce jointe introuvable.' });
    await effacerFichierSiPresent(resultat.rows[0].nom_stockage);
    return res.json({ ok: true });
  } catch (erreur) {
    return gererErreur(res, erreur, 'pieces-jointes.suppression');
  }
});

routeur.post('/', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const {
      numeroContrat, clientId, souscripteurId, societeLeasing, payeurId,
      compagnieId, produitId, typeContrat, immatriculation,
      dateEffet, dureeMois, fractionnement, dateFin, primeTotale,
    } = req.body || {};

    if (!numeroContrat || !clientId || !compagnieId || !produitId || !dateEffet || !dureeMois || !fractionnement) {
      return res.status(400).json({ erreur: 'Merci de renseigner tous les champs obligatoires du contrat.' });
    }
    if (!Number.isFinite(Number(primeTotale)) || Number(primeTotale) < 0) {
      return res.status(400).json({ erreur: 'La prime doit être un montant positif ou nul.' });
    }
    const periode = validerPeriodeContrat({ dateEffet, dureeMois, fractionnement, dateFin });

    const contrat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const resultat = await client.query(
        `insert into contrats (
           numero_contrat, client_id, souscripteur_id, societe_leasing, payeur_id,
           compagnie_id, produit_id, type_contrat, immatriculation,
           date_effet, duree_mois, fractionnement, date_fin, prime_totale,
           cree_par, modifie_par
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
         returning *`,
        [
          numeroContrat, clientId, souscripteurId || clientId, String(societeLeasing || '').trim() || null,
          payeurId || souscripteurId || clientId,
          compagnieId, produitId, typeContrat || null, immatriculation || null,
          dateEffet, periode.dureeMois, fractionnement, periode.dateFin, Number(primeTotale), req.utilisateur.id,
        ]
      );
      await client.query('select generer_echeances($1)', [resultat.rows[0].id]);
      return resultat.rows[0];
    });

    res.status(201).json(contrat);
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.creation');
  }
});

routeur.put('/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const {
      numeroContrat, clientId, souscripteurId, societeLeasing, payeurId,
      compagnieId, produitId, typeContrat, immatriculation,
      dateEffet, dureeMois, fractionnement, dateFin, primeTotale, statut,
    } = req.body || {};

    if (!numeroContrat || !clientId || !compagnieId || !produitId || !dateEffet || !dureeMois || !fractionnement) {
      return res.status(400).json({ erreur: 'Merci de renseigner tous les champs obligatoires du contrat.' });
    }
    if (!Number.isFinite(Number(primeTotale)) || Number(primeTotale) < 0) {
      return res.status(400).json({ erreur: 'La prime doit être un montant positif ou nul.' });
    }
    const periode = validerPeriodeContrat({ dateEffet, dureeMois, fractionnement, dateFin });

    const contrat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const resultat = await client.query(
        `update contrats set
           numero_contrat = $1, client_id = $2, souscripteur_id = $3, societe_leasing = $4, payeur_id = $5,
           compagnie_id = $6, produit_id = $7, type_contrat = coalesce($8, type_contrat), immatriculation = $9,
           date_effet = $10, duree_mois = $11, fractionnement = $12, date_fin = $13,
           prime_totale = $14, statut = coalesce($15, statut), modifie_par = $16, modifie_le = now()
         where id = $17 and supprime_le is null
         returning *`,
        [
          numeroContrat, clientId, souscripteurId || clientId, String(societeLeasing || '').trim() || null,
          payeurId || souscripteurId || clientId, compagnieId, produitId,
          typeContrat || null, immatriculation || null, dateEffet, periode.dureeMois, fractionnement,
          periode.dateFin, Number(primeTotale), statut || null, req.utilisateur.id, req.params.id,
        ]
      );
      if (resultat.rowCount === 0) return null;
      // Régénère l'échéancier avec les nouveaux montants/dates ; les termes déjà
      // réglés ne sont jamais réécrits (voir generer_echeances côté SQL).
      await client.query('select generer_echeances($1)', [req.params.id]);
      return resultat.rows[0];
    });

    if (!contrat) {
      return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    }
    res.json(contrat);
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.modification');
  }
});

routeur.delete('/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `update contrats set supprime_le = now(), supprime_par = $1
         where id = $2 and supprime_le is null returning id`,
        [req.utilisateur.id, req.params.id]
      )
    );
    if (resultat.rowCount === 0) {
      return res.status(404).json({ erreur: 'Contrat introuvable ou déjà archivé.' });
    }
    res.json({ ok: true });
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.archivage');
  }
});

routeur.post('/:id/restaurer', exigerRole('admin'), async (req, res) => {
  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `update contrats set supprime_le = null, supprime_par = null
         where id = $1 and supprime_le is not null returning *`,
        [req.params.id]
      )
    );
    if (resultat.rowCount === 0) {
      return res.status(404).json({ erreur: "Ce contrat n'est pas dans la corbeille." });
    }
    res.json(resultat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.restauration');
  }
});

// Renouvellement en un clic : duplique le contrat sur la période suivante.
routeur.post('/:id/renouveler', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const nouveauId = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const resultat = await client.query('select renouveler_contrat($1, $2) as id', [req.params.id, req.utilisateur.id]);
      return resultat.rows[0].id;
    });

    const nouveauContrat = await requete('select * from contrats where id = $1', [nouveauId]);
    res.status(201).json(nouveauContrat.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.renouvellement');
  }
});

module.exports = routeur;
