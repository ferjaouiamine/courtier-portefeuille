const express = require('express');
const rateLimit = require('express-rate-limit');
const { requete } = require('../db');
const {
  verifierMotDePasse,
  creerJeton,
  poserCookieJeton,
  effacerCookieJeton,
  estBloque,
  enregistrerEchec,
  reinitialiserEchecs,
  exigerConnexion,
} = require('../auth');
const { gererErreur } = require('../erreurs');
const { avecOrganisation } = require('../contexte');

const routeur = express.Router();

const limiteurConnexion = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { erreur: 'Trop de tentatives de connexion depuis cette adresse. Réessayez plus tard.' },
});

routeur.post('/connexion', limiteurConnexion, async (req, res) => {
  const { email, motDePasse } = req.body || {};
  if (!email || !motDePasse) {
    return res.status(400).json({ erreur: 'Veuillez saisir votre e-mail et votre mot de passe.' });
  }

  const emailNormalise = String(email).trim().toLowerCase();
  const blocage = estBloque(emailNormalise);
  if (blocage.bloque) {
    return res.status(429).json({
      erreur: `Trop de tentatives échouées. Réessayez dans ${blocage.minutesRestantes} minute(s).`,
    });
  }

  try {
    const resultat = await requete(
      `select u.id, u.nom, u.email, u.mot_de_passe_hache, u.role, u.organisation_id
       from utilisateurs u
       join organisations o on o.id = u.organisation_id and o.actif = true
       where u.email = $1 and u.supprime_le is null`,
      [emailNormalise]
    );
    const utilisateur = resultat.rows[0];

    const motDePasseValide = utilisateur
      ? await verifierMotDePasse(motDePasse, utilisateur.mot_de_passe_hache)
      : false;

    if (!utilisateur || !motDePasseValide) {
      enregistrerEchec(emailNormalise);
      return res.status(401).json({ erreur: 'E-mail ou mot de passe incorrect.' });
    }

    reinitialiserEchecs(emailNormalise);
    const jeton = creerJeton(utilisateur);
    poserCookieJeton(res, jeton);

    await avecOrganisation(utilisateur.organisation_id, () => requete(
      `insert into journal_audit (utilisateur_id, action, table_cible, ligne_id, etat_apres)
       values ($1, 'connexion', 'utilisateurs', $1, jsonb_build_object('email', $2::text))`,
      [utilisateur.id, utilisateur.email]
    ));

    res.json({ id: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role });
  } catch (erreur) {
    gererErreur(res, erreur, 'auth.connexion');
  }
});

routeur.post('/deconnexion', (req, res) => {
  effacerCookieJeton(res);
  res.json({ ok: true });
});

routeur.get('/moi', exigerConnexion, (req, res) => {
  res.json(req.utilisateur);
});

module.exports = routeur;
