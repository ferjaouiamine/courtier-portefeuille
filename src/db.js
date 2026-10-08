// Accès direct à PostgreSQL (aucun ORM), requêtes toujours paramétrées.
const { Pool, types } = require('pg');
const { organisationCourante } = require('./contexte');

// Une date métier ne doit jamais être décalée par le fuseau horaire du serveur.
types.setTypeParser(1082, (valeur) => valeur);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Ouvre la transaction et pose le contexte (schéma, utilisateur, organisation)
// en un seul aller-retour réseau au lieu de trois ou quatre.
async function ouvrirTransaction(client, utilisateurId = null) {
  const organisationId = organisationCourante();
  const reglages = ["set_config('search_path', 'public', true)"];
  if (utilisateurId) {
    reglages.push(`set_config('app.utilisateur_id', ${client.escapeLiteral(String(utilisateurId))}, true)`);
  }
  if (organisationId) {
    reglages.push(`set_config('app.organisation_id', ${client.escapeLiteral(String(organisationId))}, true)`);
  }
  await client.query(`begin; select ${reglages.join(', ')}`);
}

// Exécute une lecture simple, hors transaction.
async function requete(texte, parametres) {
  const client = await pool.connect();
  try {
    await ouvrirTransaction(client);
    const resultat = await client.query(texte, parametres);
    await client.query('commit');
    return resultat;
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  } finally {
    client.release();
  }
}

// Exécute fn(client) dans une transaction où la variable de session
// "app.utilisateur_id" est positionnée pour que les triggers d'audit
// (f_journal_ecriture, voir db/schema.sql) sachent qui écrit.
async function transactionAvecUtilisateur(utilisateurId, fn) {
  const client = await pool.connect();
  try {
    await ouvrirTransaction(client, utilisateurId);
    const resultat = await fn(client);
    await client.query('commit');
    return resultat;
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  } finally {
    client.release();
  }
}

module.exports = { pool, requete, transactionAvecUtilisateur };
