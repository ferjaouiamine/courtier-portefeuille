// Applique le schéma de base, puis les données importées si le fichier existe.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function executerFichierSql(client, cheminFichier) {
  const sql = fs.readFileSync(cheminFichier, 'utf8');
  await client.query(sql);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL est manquant. Copiez .env.example en .env et renseignez-le.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
  await client.connect();

  try {
    const cheminSchema = path.join(__dirname, '..', 'db', 'schema.sql');
    console.log('Application du schéma :', cheminSchema);
    await executerFichierSql(client, cheminSchema);
    console.log('Schéma appliqué avec succès.');

    const cheminImport = path.join(__dirname, '..', 'db', 'import_donnees.sql');
    if (fs.existsSync(cheminImport)) {
      await client.query(
        "select set_config('app.organisation_id', '00000000-0000-4000-8000-000000000001', false)"
      );
      console.log('Application des données importées :', cheminImport);
      await executerFichierSql(client, cheminImport);
      console.log('Données importées avec succès.');
    } else {
      console.log('Aucun fichier db/import_donnees.sql trouvé — étape ignorée.');
      console.log('Générez-le avec : python scripts/import_excel.py WF_1_1_26.xlsx');
    }
  } finally {
    await client.end();
  }
}

main().catch((erreur) => {
  console.error('Échec de la migration :', erreur.message);
  process.exit(1);
});
