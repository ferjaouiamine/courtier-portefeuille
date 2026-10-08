const express = require('express');
const multer = require('multer');
const { requete, transactionAvecUtilisateur } = require('../db');
const { exigerConnexion, exigerRole, peutVoirHistorique } = require('../auth');
const { gererErreur } = require('../erreurs');
const { lirePagination, reponsePaginee } = require('../pagination');
const { journaliser, resumerLigneAudit } = require('../audit');
const stockage = require('../stockage');
const { calculerDateFin, calculerPeriodeContrat } = require('../dates-contrat');
const {
  normaliserDureeEtFractionnement,
  typeDureeDepuisFractionnement,
} = require('../regles-contrat');
const { enregistrerPaiementInitial, synchroniserProchaineEcheance } = require('../echeancier');
const {
  appliquerAvenantsDus,
  appliquerVersionCourante,
  calculerModifications,
  calculerPrimeTotale,
  creerVersionInitiale,
} = require('../avenants');

const routeur = express.Router();
routeur.use(exigerConnexion);

const TYPES_PIECES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const TAILLE_MAX_PIECE = 4 * 1024 * 1024;
const MODES_PAIEMENT = new Set(['especes', 'cheque', 'virement', 'carte', 'autre']);

const televerserPiece = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAILLE_MAX_PIECE, files: 1 },
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
  type_duree: "case when c.fractionnement = 'prime_unique' then 0 else 1 end",
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
    // Une seule connexion pour appliquer les avenants arrivés à échéance puis lire la page.
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      await appliquerAvenantsDus(client, req.utilisateur.id);
      return client.query(
      `select c.id, c.numero_contrat, c.statut, c.date_effet, c.date_fin, c.duree_mois, c.fractionnement,
              case when c.fractionnement = 'prime_unique' then 'ferme' else 'rtr' end as type_duree,
              c.prime_totale,
              case when c.feuille_caisse and exists (
                select 1 from echeances ef
                where ef.contrat_id = c.id and ef.supprime_le is null and ef.statut <> 'payee'
                  and ef.date_echeance <= current_date
                  and ef.date_echeance > coalesce(c.feuille_caisse_maj_le, c.date_effet)
              ) then false else c.feuille_caisse end as feuille_caisse,
              c.retour_feuille_caisse, c.remarque, c.com_nette, c.com_nette_saisie,
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
    });

    res.json(reponsePaginee(resultat.rows, page, limite));
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.liste');
  }
});

// Fiche contrat : échéancier complet, paiements rattachés et avenants.
// Tout est lu sur une seule connexion pour limiter les allers-retours avec la base.
// L'historique d'audit est réservé aux comptes désignés (voir src/auth.js).
routeur.get('/:id', async (req, res) => {
  try {
    const voitHistorique = peutVoirHistorique(req.utilisateur);
    const fiche = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      await appliquerAvenantsDus(client, req.utilisateur.id);
      const contrat = await client.query(
        `select c.*,
                case when c.feuille_caisse and exists (
                  select 1 from echeances ef
                  where ef.contrat_id = c.id and ef.supprime_le is null and ef.statut <> 'payee'
                    and ef.date_echeance <= current_date
                    and ef.date_echeance > coalesce(c.feuille_caisse_maj_le, c.date_effet)
                ) then false else c.feuille_caisse end as feuille_caisse,
                case when c.fractionnement = 'prime_unique' then 'ferme' else 'rtr' end as type_duree,
                cl.nom as client_nom, cl.telephone as client_telephone,
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
      if (contrat.rowCount === 0) return null;

      const echeances = await client.query(
        `select e.*, coalesce(pmt.montant_regle, 0) as montant_regle
         from echeances e
         left join lateral (
           select sum(montant) as montant_regle from paiements
           where echeance_id = e.id and supprime_le is null
         ) pmt on true
         where e.contrat_id = $1 and e.supprime_le is null
         order by e.date_echeance, e.numero_terme`,
        [req.params.id]
      );

      const paiements = await client.query(
        `select p.* from paiements p
         join echeances e on e.id = p.echeance_id
         where e.contrat_id = $1 and p.supprime_le is null
         order by p.date_paiement desc`,
        [req.params.id]
      );

      const historique = !voitHistorique ? { rows: [] } : await client.query(
        `select j.id, j.action, j.table_cible, j.ligne_id, j.etat_avant, j.etat_apres,
                j.cree_le, j.utilisateur_id, u.nom as utilisateur_nom, u.email as utilisateur_email
         from journal_audit j
         left join utilisateurs u on u.id = j.utilisateur_id and u.organisation_id = j.organisation_id
         where j.table_cible = 'contrats' and j.ligne_id = $1
         order by j.cree_le desc
         limit 100`,
        [req.params.id]
      );

      const piecesJointes = await client.query(
        `select id, nom_original, type_mime, taille_octets, ajoute_le
         from pieces_jointes_contrats
         where contrat_id = $1
         order by ajoute_le desc`,
        [req.params.id]
      );

      const avenants = await client.query(
        `select a.*, u.nom as auteur_nom,
                (a.date_effet <= current_date and (a.date_fin_validite is null or a.date_fin_validite >= current_date)) as est_version_active,
                cp.nom as compagnie_nom, pr.nom as produit_nom,
                s.nom as souscripteur_nom, pa.nom as payeur_nom
         from avenants_contrats a
         left join utilisateurs u on u.id = a.cree_par and u.organisation_id = a.organisation_id
         left join compagnies cp on cp.id = a.compagnie_id
         left join produits pr on pr.id = a.produit_id
         left join clients s on s.id = a.souscripteur_id
         left join clients pa on pa.id = a.payeur_id
         where a.contrat_id = $1
         order by a.numero_version desc`,
        [req.params.id]
      );

      const idsClients = [...new Set(avenants.rows.flatMap((version) => (version.modifications || [])
        .filter((modification) => ['souscripteur_id', 'payeur_id'].includes(modification.champ))
        .flatMap((modification) => [modification.avant, modification.apres])
        .filter(Boolean)))];
      const nomsClients = idsClients.length
        ? await client.query('select id, nom from clients where id = any($1::uuid[])', [idsClients])
        : { rows: [] };

      return {
        ...contrat.rows[0],
        echeances: echeances.rows,
        paiements: paiements.rows,
        ...(voitHistorique ? { historique: historique.rows.map(resumerLigneAudit) } : {}),
        avenants: avenants.rows,
        nomsClients: Object.fromEntries(nomsClients.rows.map((ligne) => [ligne.id, ligne.nom])),
        piecesJointes: piecesJointes.rows,
      };
    });
    if (!fiche) return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    return res.json(fiche);
  } catch (erreur) {
    return gererErreur(res, erreur, 'contrats.fiche');
  }
});

routeur.post('/:id/pieces-jointes', exigerRole('admin', 'agent'), (req, res) => {
  televerserPiece.single('fichier')(req, res, async (erreurTeleversement) => {
    if (erreurTeleversement) {
      const message = erreurTeleversement.code === 'LIMIT_FILE_SIZE'
        ? 'Le fichier dépasse la taille maximale de 4 Mo.'
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
        piece = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
          const resultat = await client.query(
            `insert into pieces_jointes_contrats
               (contrat_id, nom_original, nom_stockage, type_mime, taille_octets, ajoute_par)
             values ($1, $2, $3, $4, $5, $6)
             returning *`,
            [req.params.id, req.file.originalname, cleStockage, req.file.mimetype, req.file.size, req.utilisateur.id]
          );
          await journaliser(client, {
            utilisateurId: req.utilisateur.id,
            action: 'creation',
            tableCible: 'pieces_jointes_contrats',
            ligneId: resultat.rows[0].id,
            etatApres: resultat.rows[0],
          });
          return resultat;
        });
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
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const piece = await client.query(
        `delete from pieces_jointes_contrats
         where id = $1 and contrat_id = $2
         returning *`,
        [req.params.pieceId, req.params.id]
      );
      if (piece.rowCount > 0) {
        await journaliser(client, {
          utilisateurId: req.utilisateur.id,
          action: 'suppression',
          tableCible: 'pieces_jointes_contrats',
          ligneId: piece.rows[0].id,
          etatAvant: piece.rows[0],
        });
      }
      return piece;
    });
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
      dateEffet, dateFin, dureeMois, fractionnement, primeTotale,
      modePaiementInitial, referencePaiementInitial, retourFeuilleCaisse, remarque,
    } = req.body || {};

    if (!numeroContrat || !clientId || !compagnieId || !produitId || !dateEffet || !fractionnement) {
      return res.status(400).json({ erreur: 'Merci de renseigner tous les champs obligatoires du contrat.' });
    }
    if (!Number.isFinite(Number(primeTotale)) || Number(primeTotale) <= 0) {
      return res.status(400).json({ erreur: 'La prime doit être supérieure à zéro.' });
    }
    if (modePaiementInitial && !MODES_PAIEMENT.has(modePaiementInitial)) {
      return res.status(400).json({ erreur: 'Mode de paiement initial invalide.' });
    }
    const remarqueNormalisee = String(remarque || '').trim();
    if (remarqueNormalisee.length > 2000) {
      return res.status(400).json({ erreur: 'La remarque ne doit pas dépasser 2 000 caractères.' });
    }
    const regles = normaliserDureeEtFractionnement(req.body.typeDuree, fractionnement);
    const { dateFin: dateFinEnregistree, dureeMois: dureeTechnique } = calculerPeriodeContrat({
      ferme: regles.typeDuree === 'ferme', dateEffet, dateFin, dureeMois,
    });

    const contrat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const resultat = await client.query(
        `insert into contrats (
           numero_contrat, client_id, souscripteur_id, societe_leasing, payeur_id,
           compagnie_id, produit_id, type_contrat, immatriculation,
           date_effet, duree_mois, fractionnement, date_fin, prime_totale,
           feuille_caisse, retour_feuille_caisse, remarque, com_nette,
           cree_par, modifie_par
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, false, $15, $16, null, $17, $17)
         returning *`,
        [
          numeroContrat, clientId, souscripteurId || clientId, String(societeLeasing || '').trim() || null,
          payeurId || souscripteurId || clientId,
          compagnieId, produitId, typeContrat || null, immatriculation || null,
          dateEffet, Number(dureeTechnique), regles.fractionnement, dateFinEnregistree,
          Number(primeTotale), retourFeuilleCaisse === true, remarqueNormalisee || null,
          req.utilisateur.id,
        ]
      );
      await enregistrerPaiementInitial(client, resultat.rows[0], req.utilisateur.id, {
        modePaiement: modePaiementInitial || 'autre',
        reference: String(referencePaiementInitial || '').trim() || null,
        remarque: remarqueNormalisee || null,
        feuilleCaisse: false,
        commissionNette: null,
      });
      await synchroniserProchaineEcheance(client, resultat.rows[0]);
      await creerVersionInitiale(client, resultat.rows[0]);
      return resultat.rows[0];
    });

    res.status(201).json({ ...contrat, type_duree: regles.typeDuree });
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.creation');
  }
});

routeur.put('/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const {
      numeroContrat, clientId, souscripteurId, societeLeasing, payeurId,
      compagnieId, produitId, typeContrat, immatriculation,
      dateEffet, dateFin, dureeMois, fractionnement, primeTotale, statut,
      retourFeuilleCaisse, remarque,
    } = req.body || {};

    if (!Number.isFinite(Number(primeTotale)) || Number(primeTotale) < 0) {
      return res.status(400).json({ erreur: 'La prime doit être un montant positif ou nul.' });
    }
    const remarqueNormalisee = String(remarque || '').trim();
    if (remarqueNormalisee.length > 2000) {
      return res.status(400).json({ erreur: 'La remarque ne doit pas dépasser 2 000 caractères.' });
    }
    const regles = normaliserDureeEtFractionnement(req.body.typeDuree, fractionnement);
    const { dateFin: dateFinEnregistree, dureeMois: dureeTechnique } = calculerPeriodeContrat({
      ferme: regles.typeDuree === 'ferme', dateEffet, dateFin, dureeMois,
    });

    const contrat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const resultat = await client.query(
        `update contrats set
           numero_contrat = $1, client_id = $2, souscripteur_id = $3, societe_leasing = $4, payeur_id = $5,
           compagnie_id = $6, produit_id = $7, type_contrat = coalesce($8, type_contrat), immatriculation = $9,
           date_effet = $10, duree_mois = $11, fractionnement = $12, date_fin = $13,
           prime_totale = $14, retour_feuille_caisse = coalesce($15, retour_feuille_caisse), remarque = $16,
           statut = coalesce($17, statut), modifie_par = $18, modifie_le = now()
         where id = $19 and supprime_le is null
         returning *`,
        [
          numeroContrat, clientId, souscripteurId || clientId, String(societeLeasing || '').trim() || null,
          payeurId || souscripteurId || clientId, compagnieId, produitId,
          typeContrat || null, immatriculation || null, dateEffet, Number(dureeTechnique), regles.fractionnement,
          dateFinEnregistree, Number(primeTotale), typeof retourFeuilleCaisse === 'boolean' ? retourFeuilleCaisse : null,
          remarqueNormalisee || null, statut || null, req.utilisateur.id, req.params.id,
        ]
      );
      if (resultat.rowCount === 0) return null;
      await synchroniserProchaineEcheance(client, resultat.rows[0]);
      await creerVersionInitiale(client, resultat.rows[0]);
      await client.query(
        `update avenants_contrats set
           souscripteur_id = $2, societe_leasing = $3, payeur_id = $4,
           compagnie_id = $5, produit_id = $6, type_contrat = $7, immatriculation = $8,
           date_fin_contrat = $9, duree_mois = $10, fractionnement = $11,
           prime_totale = $12, retour_feuille_caisse = $13, remarque = $14, statut = $15,
           prime_avenant = case when numero_version = 1 then 0 else $12::numeric - coalesce((
             select p.prime_totale from avenants_contrats p
             where p.contrat_id = $1 and p.numero_version = avenants_contrats.numero_version - 1
           ), $12::numeric) end
         where id = (
           select id from avenants_contrats
           where contrat_id = $1 and date_effet <= current_date
           order by date_effet desc, numero_version desc limit 1
         )`,
        [
          resultat.rows[0].id, resultat.rows[0].souscripteur_id, resultat.rows[0].societe_leasing,
          resultat.rows[0].payeur_id, resultat.rows[0].compagnie_id, resultat.rows[0].produit_id,
          resultat.rows[0].type_contrat, resultat.rows[0].immatriculation, resultat.rows[0].date_fin,
          resultat.rows[0].duree_mois, resultat.rows[0].fractionnement, resultat.rows[0].prime_totale,
          resultat.rows[0].retour_feuille_caisse, resultat.rows[0].remarque, resultat.rows[0].statut,
        ]
      );
      return resultat.rows[0];
    });

    if (!contrat) {
      return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    }
    res.json({ ...contrat, type_duree: regles.typeDuree });
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.modification');
  }
});

function erreurAvenant(message, status = 400) {
  const erreur = new Error(message);
  erreur.status = status;
  return erreur;
}

// Valide la saisie commune à la création et à la modification d'un avenant.
function lireSaisieAvenant(corps) {
  const { dateEffetAvenant, compagnieId, produitId, fractionnement, primeAvenant } = corps;
  if (!dateEffetAvenant || !compagnieId || !produitId || !fractionnement) {
    throw erreurAvenant("La date d'effet et les données obligatoires de l'avenant sont requises.");
  }
  if (primeAvenant === null || primeAvenant === undefined || primeAvenant === ''
      || !Number.isFinite(Number(primeAvenant))) {
    throw erreurAvenant("Saisissez la prime de l'avenant (0 si la prime ne change pas).");
  }
  const remarque = String(corps.remarque || '').trim();
  if (remarque.length > 2000) {
    throw erreurAvenant('La remarque ne doit pas dépasser 2 000 caractères.');
  }
  return {
    ...corps,
    primeAvenant: Number(primeAvenant),
    remarque,
    regles: normaliserDureeEtFractionnement(corps.typeDuree, fractionnement),
  };
}

// Construit la version issue d'un avenant : la prime saisie s'ajoute à celle
// de la version précédente pour donner la nouvelle prime totale.
function construireVersionAvenant(contrat, precedente, saisie, statutParDefaut) {
  if (saisie.dateEffetAvenant <= precedente.date_effet) {
    throw erreurAvenant("La date d'effet doit être postérieure à celle de la version précédente.");
  }
  const primeTotale = calculerPrimeTotale(precedente.prime_totale, saisie.primeAvenant);
  if (primeTotale < 0) {
    throw erreurAvenant('La prime totale après avenant ne peut pas être négative.');
  }
  const ferme = saisie.regles.typeDuree === 'ferme';
  // Passage d'un DF à un RTR : la période repart sur 12 mois.
  const periode = calculerPeriodeContrat({
    ferme,
    dateEffet: contrat.date_effet,
    dateFin: saisie.dateFin,
    dureeMois: ferme || precedente.fractionnement !== 'prime_unique' ? saisie.dureeMois : 12,
  });
  if (ferme && periode.dateFin <= saisie.dateEffetAvenant) {
    throw erreurAvenant("La date de fin doit être postérieure à la date d'effet de l'avenant.");
  }
  const version = {
    date_effet: saisie.dateEffetAvenant,
    souscripteur_id: saisie.souscripteurId || contrat.client_id,
    societe_leasing: String(saisie.societeLeasing || '').trim() || null,
    payeur_id: saisie.payeurId || saisie.souscripteurId || contrat.client_id,
    compagnie_id: saisie.compagnieId,
    produit_id: saisie.produitId,
    type_contrat: saisie.typeContrat || null,
    immatriculation: String(saisie.immatriculation || '').trim() || null,
    date_fin_contrat: periode.dateFin,
    duree_mois: periode.dureeMois,
    fractionnement: saisie.regles.fractionnement,
    prime_totale: primeTotale,
    prime_avenant: saisie.primeAvenant,
    retour_feuille_caisse: saisie.retourFeuilleCaisse === true,
    remarque: saisie.remarque || null,
    statut: saisie.statut || statutParDefaut,
  };
  const modifications = calculerModifications(precedente, version);
  if (!modifications.length) {
    throw erreurAvenant("Modifiez au moins un champ avant d'enregistrer l'avenant.");
  }
  return { version, modifications };
}

// Seul le dernier avenant peut être modifié ou supprimé : les versions
// suivantes sont calculées à partir de lui.
async function chargerDernierAvenant(client, contratId, avenantId) {
  const versions = await client.query(
    `select * from avenants_contrats where contrat_id = $1
     order by numero_version desc limit 2 for update`,
    [contratId]
  );
  const [dernier, precedente] = versions.rows;
  if (dernier?.id !== avenantId) {
    const cible = await client.query(
      'select numero_version from avenants_contrats where id = $1 and contrat_id = $2',
      [avenantId, contratId]
    );
    if (!cible.rows[0]) throw erreurAvenant('Avenant introuvable.', 404);
    if (cible.rows[0].numero_version > 1) {
      throw erreurAvenant('Seul le dernier avenant du contrat peut être modifié ou supprimé.');
    }
  }
  if (!precedente || dernier.id !== avenantId) {
    throw erreurAvenant('La version initiale se corrige avec le bouton « Modifier » du contrat.');
  }
  return { avenant: dernier, precedente };
}

routeur.post('/:id/avenants', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const saisie = lireSaisieAvenant(req.body || {});
    const avenant = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      await appliquerAvenantsDus(client, req.utilisateur.id);
      const contratResultat = await client.query(
        'select * from contrats where id = $1 and supprime_le is null for update',
        [req.params.id]
      );
      const contrat = contratResultat.rows[0];
      if (!contrat) return null;
      await creerVersionInitiale(client, contrat);

      const derniereVersion = await client.query(
        `select * from avenants_contrats where contrat_id = $1
         order by date_effet desc, numero_version desc limit 1 for update`,
        [contrat.id]
      );
      const precedente = derniereVersion.rows[0];
      if (precedente.date_effet > new Date().toISOString().slice(0, 10)) {
        throw erreurAvenant('Un avenant futur existe déjà pour ce contrat : modifiez-le ou supprimez-le.');
      }
      const { version, modifications } = construireVersionAvenant(contrat, precedente, saisie, contrat.statut);
      await client.query(
        `update avenants_contrats set date_fin_validite = ($2::date - 1)
         where id = $1`,
        [precedente.id, version.date_effet]
      );
      const resultat = await client.query(
        `insert into avenants_contrats (
           contrat_id, numero_version, date_effet, souscripteur_id, societe_leasing,
           payeur_id, compagnie_id, produit_id, type_contrat, immatriculation,
           date_fin_contrat, duree_mois, fractionnement, prime_totale, prime_avenant,
           retour_feuille_caisse, remarque, statut, modifications, cree_par
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20
         ) returning *`,
        [
          contrat.id, precedente.numero_version + 1, version.date_effet,
          version.souscripteur_id, version.societe_leasing,
          version.payeur_id, version.compagnie_id, version.produit_id,
          version.type_contrat, version.immatriculation,
          version.date_fin_contrat, version.duree_mois,
          version.fractionnement, version.prime_totale, version.prime_avenant,
          version.retour_feuille_caisse, version.remarque,
          version.statut, JSON.stringify(modifications), req.utilisateur.id,
        ]
      );
      await journaliser(client, {
        utilisateurId: req.utilisateur.id,
        action: 'creation',
        tableCible: 'avenants_contrats',
        ligneId: resultat.rows[0].id,
        etatApres: resultat.rows[0],
      });
      // Un avenant daté d'aujourd'hui s'applique tout de suite ; un avenant futur reste planifié.
      await appliquerAvenantsDus(client, req.utilisateur.id);
      return resultat.rows[0];
    });
    if (!avenant) return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    return res.status(201).json(avenant);
  } catch (erreur) {
    return gererErreur(res, erreur, 'contrats.avenant');
  }
});

routeur.put('/:id/avenants/:avenantId', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const saisie = lireSaisieAvenant(req.body || {});
    const avenant = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const contratResultat = await client.query(
        'select * from contrats where id = $1 and supprime_le is null for update',
        [req.params.id]
      );
      const contrat = contratResultat.rows[0];
      if (!contrat) return null;
      const { avenant: actuel, precedente } = await chargerDernierAvenant(client, contrat.id, req.params.avenantId);
      const { version, modifications } = construireVersionAvenant(contrat, precedente, saisie, actuel.statut);
      await client.query(
        `update avenants_contrats set date_fin_validite = ($2::date - 1)
         where id = $1`,
        [precedente.id, version.date_effet]
      );
      // applique_le repart à null : un avenant reporté dans le futur redevient planifié.
      const resultat = await client.query(
        `update avenants_contrats set
           date_effet = $2, souscripteur_id = $3, societe_leasing = $4, payeur_id = $5,
           compagnie_id = $6, produit_id = $7, type_contrat = $8, immatriculation = $9,
           date_fin_contrat = $10, duree_mois = $11, fractionnement = $12,
           prime_totale = $13, prime_avenant = $14, retour_feuille_caisse = $15,
           remarque = $16, statut = $17, modifications = $18::jsonb, applique_le = null
         where id = $1 returning *`,
        [
          actuel.id, version.date_effet, version.souscripteur_id, version.societe_leasing,
          version.payeur_id, version.compagnie_id, version.produit_id,
          version.type_contrat, version.immatriculation,
          version.date_fin_contrat, version.duree_mois, version.fractionnement,
          version.prime_totale, version.prime_avenant, version.retour_feuille_caisse,
          version.remarque, version.statut, JSON.stringify(modifications),
        ]
      );
      await journaliser(client, {
        utilisateurId: req.utilisateur.id,
        action: 'modification',
        tableCible: 'avenants_contrats',
        ligneId: actuel.id,
        etatAvant: actuel,
        etatApres: resultat.rows[0],
      });
      await appliquerVersionCourante(client, contrat.id, req.utilisateur.id);
      return resultat.rows[0];
    });
    if (!avenant) return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    return res.json(avenant);
  } catch (erreur) {
    return gererErreur(res, erreur, 'contrats.avenant-modification');
  }
});

// La suppression du dernier avenant remet le contrat sur la version précédente.
routeur.delete('/:id/avenants/:avenantId', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const supprime = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const contratResultat = await client.query(
        'select id from contrats where id = $1 and supprime_le is null for update',
        [req.params.id]
      );
      if (!contratResultat.rows[0]) return null;
      const { avenant, precedente } = await chargerDernierAvenant(client, req.params.id, req.params.avenantId);
      await client.query('delete from avenants_contrats where id = $1', [avenant.id]);
      await client.query(
        'update avenants_contrats set date_fin_validite = null where id = $1',
        [precedente.id]
      );
      await journaliser(client, {
        utilisateurId: req.utilisateur.id,
        action: 'suppression',
        tableCible: 'avenants_contrats',
        ligneId: avenant.id,
        etatAvant: avenant,
        etatApres: { suppression_definitive: true },
      });
      await appliquerVersionCourante(client, req.params.id, req.utilisateur.id);
      return avenant;
    });
    if (!supprime) return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    return res.json({ ok: true });
  } catch (erreur) {
    return gererErreur(res, erreur, 'contrats.avenant-suppression');
  }
});

// Mise à jour rapide depuis la dernière colonne du tableau des contrats.
routeur.patch('/:id/retour-feuille-caisse', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { retourFeuilleCaisse } = req.body || {};
    if (typeof retourFeuilleCaisse !== 'boolean') {
      return res.status(400).json({ erreur: 'Choisissez Oui ou Non pour le retour de la feuille de caisse.' });
    }
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `update contrats set retour_feuille_caisse = $1, modifie_par = $2, modifie_le = now()
         where id = $3 and supprime_le is null
         returning id, retour_feuille_caisse`,
        [retourFeuilleCaisse, req.utilisateur.id, req.params.id]
      )
    );
    if (resultat.rowCount === 0) {
      return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });
    }
    return res.json(resultat.rows[0]);
  } catch (erreur) {
    return gererErreur(res, erreur, 'contrats.retour-feuille-caisse');
  }
});

routeur.delete('/:id', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const resultat = await transactionAvecUtilisateur(req.utilisateur.id, async (client) => {
      const archive = await client.query(
        `update contrats set supprime_le = now(), supprime_par = $1
         where id = $2 and supprime_le is null returning id`,
        [req.utilisateur.id, req.params.id]
      );
      if (archive.rowCount > 0) {
        await client.query(
          `delete from notifications_sms
           where contrat_id = $1 and statut <> 'envoyee'`,
          [req.params.id]
        );
      }
      return archive;
    });
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
      const precedent = await client.query(
        'select * from contrats where id = $1 and supprime_le is null for update',
        [req.params.id]
      );
      if (precedent.rowCount === 0) return null;

      const contrat = precedent.rows[0];
      if (contrat.fractionnement === 'prime_unique') {
        const erreur = new Error('Un contrat à durée ferme ne peut pas être renouvelé.');
        erreur.status = 400;
        throw erreur;
      }
      const nouvelleDateEffet = calculerDateFin(contrat.date_effet, contrat.duree_mois);
      const nouveau = await client.query(
        `insert into contrats (
           numero_contrat, client_id, souscripteur_id, societe_leasing_id, societe_leasing, payeur_id,
           compagnie_id, produit_id, type_contrat, immatriculation,
           date_effet, duree_mois, fractionnement, date_fin,
           prime_totale, feuille_caisse, com_nette, com_brute, taux_retenue,
           statut, contrat_precedent, cree_par, modifie_par
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, false, null, $16, $17, 'en_cours', $18, $19, $19
         ) returning id`,
        [
          contrat.numero_contrat, contrat.client_id, contrat.souscripteur_id,
          contrat.societe_leasing_id, contrat.societe_leasing, contrat.payeur_id,
          contrat.compagnie_id, contrat.produit_id, contrat.type_contrat, contrat.immatriculation,
          nouvelleDateEffet, contrat.duree_mois, contrat.fractionnement, null,
          contrat.prime_totale, contrat.com_brute, contrat.taux_retenue,
          contrat.id, req.utilisateur.id,
        ]
      );
      await client.query(
        "update contrats set statut = 'renouvele', modifie_par = $1, modifie_le = now() where id = $2",
        [req.utilisateur.id, contrat.id]
      );
      await client.query(
        "update echeances set statut = 'payee' where contrat_id = $1 and type_echeance = 'renouvellement'",
        [contrat.id]
      );
      const nouveauContrat = await client.query('select * from contrats where id = $1', [nouveau.rows[0].id]);
      await synchroniserProchaineEcheance(client, nouveauContrat.rows[0]);
      return nouveau.rows[0].id;
    });

    if (!nouveauId) return res.status(404).json({ erreur: 'Contrat introuvable ou archivé.' });

    const nouveauContrat = await requete('select * from contrats where id = $1', [nouveauId]);
    res.status(201).json({
      ...nouveauContrat.rows[0],
      type_duree: typeDureeDepuisFractionnement(nouveauContrat.rows[0].fractionnement),
    });
  } catch (erreur) {
    gererErreur(res, erreur, 'contrats.renouvellement');
  }
});

module.exports = routeur;
