const express = require('express');
const { requete, transactionAvecUtilisateur } = require('../db');
const { exigerConnexion, exigerRole } = require('../auth');
const { gererErreur } = require('../erreurs');
const { lirePagination, reponsePaginee } = require('../pagination');

const routeur = express.Router();
routeur.use(exigerConnexion);

const MODES_PAIEMENT = ['especes', 'cheque', 'virement', 'carte', 'autre'];
const TYPES_RELANCE = ['appel', 'sms', 'whatsapp', 'email', 'automatique'];

// Agenda des échéances (termes de prime + renouvellements), filtrable.
routeur.get('/', async (req, res) => {
  try {
    const { niveau, compagnie_nom: compagnieNom, type_echeance: typeEcheance, recherche } = req.query;
    const fenetre = req.query.fenetre ? parseInt(req.query.fenetre, 10) : null;
    const { page, limite, offset } = lirePagination(req);

    const conditions = ['1 = 1'];
    const parametres = [];

    if (fenetre !== null && !Number.isNaN(fenetre)) {
      parametres.push(fenetre);
      conditions.push(`jours_restants <= $${parametres.length}`);
    }
    if (niveau) {
      parametres.push(niveau);
      conditions.push(`niveau = $${parametres.length}`);
    }
    if (compagnieNom) {
      parametres.push(compagnieNom);
      conditions.push(`compagnie_nom = $${parametres.length}`);
    }
    if (typeEcheance) {
      parametres.push(typeEcheance);
      conditions.push(`type_echeance = $${parametres.length}`);
    }
    if (recherche) {
      parametres.push(`%${recherche}%`);
      conditions.push(`(client_nom ilike $${parametres.length} or numero_contrat ilike $${parametres.length})`);
    }

    parametres.push(limite, offset);
    const resultat = await requete(
      `select *, count(*) over() as total_elements from v_echeances
       where ${conditions.join(' and ')} and statut <> 'payee'
       order by date_echeance
       limit $${parametres.length - 1} offset $${parametres.length}`,
      parametres
    );

    res.json(reponsePaginee(resultat.rows, page, limite));
  } catch (erreur) {
    gererErreur(res, erreur, 'echeances.agenda');
  }
});

// Encaissement total ou partiel. Le statut de l'échéance est recalculé par trigger.
routeur.post('/:id/paiements', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { montant, modePaiement, reference, datePaiement } = req.body || {};

    if (!montant || Number(montant) <= 0) {
      return res.status(400).json({ erreur: 'Le montant encaissé doit être supérieur à zéro.' });
    }
    if (!MODES_PAIEMENT.includes(modePaiement)) {
      return res.status(400).json({ erreur: 'Mode de paiement invalide.' });
    }

    const paiement = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `insert into paiements (echeance_id, montant, mode_paiement, reference, date_paiement, saisi_par)
         values ($1, $2, $3, $4, coalesce($5, current_date), $6)
         returning *`,
        [req.params.id, montant, modePaiement, reference || null, datePaiement || null, req.utilisateur.id]
      )
    );

    const echeance = await requete('select statut from echeances where id = $1', [req.params.id]);

    res.status(201).json({ paiement: paiement.rows[0], statutEcheance: echeance.rows[0]?.statut });
  } catch (erreur) {
    gererErreur(res, erreur, 'echeances.encaissement');
  }
});

// Trace une relance (appel, SMS, WhatsApp, e-mail) sur une échéance.
routeur.post('/:id/relances', exigerRole('admin', 'agent'), async (req, res) => {
  try {
    const { typeRelance, note } = req.body || {};
    if (!TYPES_RELANCE.includes(typeRelance)) {
      return res.status(400).json({ erreur: 'Type de relance invalide.' });
    }

    const relance = await transactionAvecUtilisateur(req.utilisateur.id, (client) =>
      client.query(
        `insert into relances (echeance_id, type_relance, note, effectue_par)
         values ($1, $2, $3, $4) returning *`,
        [req.params.id, typeRelance, note || null, req.utilisateur.id]
      )
    );

    res.status(201).json(relance.rows[0]);
  } catch (erreur) {
    gererErreur(res, erreur, 'echeances.relance');
  }
});

module.exports = routeur;
