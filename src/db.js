// Accès direct à PostgreSQL (aucun ORM), requêtes toujours paramétrées.
const { Pool, types } = require('pg');
const { organisationCourante } = require('./contexte');

// Une date métier ne doit jamais être décalée par le fuseau horaire du serveur.
types.setTypeParser(1082, (valeur) => valeur);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Exécute une lecture simple, hors transaction.
async function requete(texte, parametres) {
  const organisationId = organisationCourante();
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local search_path to public');
    if (organisationId) {
      await client.query("select set_config('app.organisation_id', $1, true)", [organisationId]);
    }
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
    await client.query('begin');
    await client.query('set local search_path to public');
    await client.query("select set_config('app.utilisateur_id', $1, true)", [utilisateurId || null]);
    const organisationId = organisationCourante();
    if (organisationId) {
      await client.query("select set_config('app.organisation_id', $1, true)", [organisationId]);
    }
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
