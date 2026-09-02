require('dotenv').config();

const { Client } = require('pg');
const { hacherMotDePasse } = require('../src/auth');

async function main() {
  const [nomOrganisation, nomAdministrateur, email, motDePasse] = process.argv.slice(2);
  if (!nomOrganisation || !nomAdministrateur || !email || !motDePasse) {
    console.error('Usage : npm run creer-organisation -- "Cabinet" "Administrateur" email@exemple.tn motdepasse');
    process.exit(1);
  }
  if (motDePasse.length < 8) {
    console.error('Le mot de passe doit contenir au moins 8 caractères.');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    await client.query('begin');
    await client.query('set local search_path to public');
    const organisation = await client.query(
      'insert into organisations (nom) values ($1) returning id, nom',
      [nomOrganisation.trim()]
    );
    await client.query("select set_config('app.organisation_id', $1, true)", [organisation.rows[0].id]);
    const hache = await hacherMotDePasse(motDePasse);
    await client.query(
      `insert into utilisateurs (organisation_id, nom, email, mot_de_passe_hache, role)
       values ($1, $2, $3, $4, 'admin')`,
      [organisation.rows[0].id, nomAdministrateur.trim(), email.trim().toLowerCase(), hache]
    );
    await client.query('commit');
    console.log(`Organisation créée : ${organisation.rows[0].nom} (${organisation.rows[0].id})`);
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  } finally {
    await client.end();
  }
}

main().catch((erreur) => {
  console.error('Échec de la création de l’organisation :', erreur.message);
  process.exit(1);
});
