// Crée le premier compte administrateur.
// Usage : npm run creer-admin -- "Prénom Nom" moi@exemple.tn motdepasse123
require('dotenv').config();
const { Client } = require('pg');
const { hacherMotDePasse } = require('../src/auth');

async function main() {
  const [nom, email, motDePasse, organisationId = '00000000-0000-4000-8000-000000000001'] = process.argv.slice(2);

  if (!nom || !email || !motDePasse) {
    console.error('Usage : npm run creer-admin -- "Prénom Nom" email@exemple.tn motdepasse');
    process.exit(1);
  }
  if (motDePasse.length < 8) {
    console.error('Le mot de passe doit contenir au moins 8 caractères.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("select set_config('app.organisation_id', $1, false)", [organisationId]);
    const existant = await client.query('select id from utilisateurs where email = $1', [email]);
    if (existant.rowCount > 0) {
      console.error(`Un utilisateur existe déjà avec l'e-mail ${email}.`);
      process.exit(1);
    }

    const hache = await hacherMotDePasse(motDePasse);
    const resultat = await client.query(
      `insert into utilisateurs (organisation_id, nom, email, mot_de_passe_hache, role)
       values ($1, $2, $3, $4, 'admin') returning id`,
      [organisationId, nom, email, hache]
    );

    console.log(`Administrateur créé (id ${resultat.rows[0].id}). Vous pouvez maintenant vous connecter.`);
  } finally {
    await client.end();
  }
}

main().catch((erreur) => {
  console.error('Échec de la création du compte :', erreur.message);
  process.exit(1);
});
