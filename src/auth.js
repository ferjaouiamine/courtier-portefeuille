// Authentification : hachage des mots de passe, jetons JWT en cookie httpOnly,
// contrôle des rôles et limitation des tentatives de connexion.
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { avecOrganisation } = require('./contexte');

const NOM_COOKIE = 'jeton';
const TENTATIVES_MAX = parseInt(process.env.CONNEXION_TENTATIVES_MAX || '5', 10);
const BLOCAGE_MS = parseInt(process.env.CONNEXION_BLOCAGE_MINUTES || '15', 10) * 60 * 1000;

// Suivi en mémoire des échecs de connexion par e-mail (suffisant pour un
// cabinet mono-instance ; repart à zéro si le serveur redémarre).
const echecsParEmail = new Map();

function hacherMotDePasse(motDePasse) {
  return bcrypt.hash(motDePasse, 12);
}

function verifierMotDePasse(motDePasse, hache) {
  return bcrypt.compare(motDePasse, hache);
}

function creerJeton(utilisateur) {
  return jwt.sign(
    {
      id: utilisateur.id,
      nom: utilisateur.nom,
      role: utilisateur.role,
      organisationId: utilisateur.organisation_id,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_DUREE || '12h' }
  );
}

function poserCookieJeton(res, jeton) {
  res.cookie(NOM_COOKIE, jeton, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

function effacerCookieJeton(res) {
  res.clearCookie(NOM_COOKIE);
}

// Retourne { bloque: bool, minutesRestantes } sans consommer de tentative.
function estBloque(email) {
  const entree = echecsParEmail.get(email);
  if (!entree || entree.compte < TENTATIVES_MAX) return { bloque: false };
  const finBlocage = entree.dernierEchec + BLOCAGE_MS;
  if (Date.now() >= finBlocage) {
    echecsParEmail.delete(email);
    return { bloque: false };
  }
  return { bloque: true, minutesRestantes: Math.ceil((finBlocage - Date.now()) / 60000) };
}

function enregistrerEchec(email) {
  const entree = echecsParEmail.get(email) || { compte: 0, dernierEchec: 0 };
  entree.compte += 1;
  entree.dernierEchec = Date.now();
  echecsParEmail.set(email, entree);
}

function reinitialiserEchecs(email) {
  echecsParEmail.delete(email);
}

// Middleware : exige un jeton valide, place req.utilisateur = { id, nom, role }.
function exigerConnexion(req, res, next) {
  const jeton = req.cookies && req.cookies[NOM_COOKIE];
  if (!jeton) {
    return res.status(401).json({ erreur: 'Veuillez vous connecter pour continuer.' });
  }
  try {
    req.utilisateur = jwt.verify(jeton, process.env.JWT_SECRET);
    if (!req.utilisateur.organisationId) {
      effacerCookieJeton(res);
      return res.status(401).json({ erreur: 'Votre session doit être renouvelée. Veuillez vous reconnecter.' });
    }
    return avecOrganisation(req.utilisateur.organisationId, () => next());
  } catch (erreur) {
    effacerCookieJeton(res);
    return res.status(401).json({ erreur: 'Votre session a expiré, veuillez vous reconnecter.' });
  }
}

// Middleware : exige que req.utilisateur.role fasse partie des rôles autorisés.
function exigerRole(...rolesAutorises) {
  return (req, res, next) => {
    if (!req.utilisateur || !rolesAutorises.includes(req.utilisateur.role)) {
      return res.status(403).json({ erreur: "Votre profil ne permet pas d'effectuer cette action." });
    }
    next();
  };
}

module.exports = {
  hacherMotDePasse,
  verifierMotDePasse,
  creerJeton,
  poserCookieJeton,
  effacerCookieJeton,
  estBloque,
  enregistrerEchec,
  reinitialiserEchecs,
  exigerConnexion,
  exigerRole,
};
