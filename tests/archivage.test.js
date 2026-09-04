require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { Client } = require('pg');

process.env.JWT_SECRET ||= 'secret-test-archivage-local-uniquement';

function utiliseBaseLocale() {
  try {
    return ['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.DATABASE_URL).hostname);
  } catch {
    return false;
  }
}

test('archiver un client ou contrat masque ses valeurs et la suppression efface les dependances', async (t) => {
  if (!utiliseBaseLocale()) return t.skip('Test destructif interdit sur une base distante');

  const app = require('../src/server');
  const { pool } = require('../src/db');
  const administration = new Client({
    connectionString: 'postgresql://courtier:courtier@localhost:5432/courtier_portefeuille',
  });
  const ids = {
    organisation: crypto.randomUUID(),
    utilisateur: crypto.randomUUID(),
    compagnie: crypto.randomUUID(),
    produit: crypto.randomUUID(),
    client: crypto.randomUUID(),
    contrat: crypto.randomUUID(),
    echeance: crypto.randomUUID(),
  };

  await administration.connect();
  try {
    await administration.query("select set_config('app.organisation_id', $1, false)", [ids.organisation]);
    await administration.query('insert into organisations (id, nom) values ($1, $2)', [ids.organisation, 'Test archivage']);
    await administration.query(
      `insert into utilisateurs (id, organisation_id, nom, email, mot_de_passe_hache, role)
       values ($1, $2, 'Admin test', $3, 'inutilise', 'admin')`,
      [ids.utilisateur, ids.organisation, `archive-${ids.organisation}@test.local`]
    );
    await administration.query(
      'insert into compagnies (id, organisation_id, code, nom) values ($1, $2, $3, $3)',
      [ids.compagnie, ids.organisation, `C-${ids.organisation.slice(0, 8)}`]
    );
    await administration.query(
      "insert into produits (id, organisation_id, nom, branche) values ($1, $2, 'Produit test', 'AUTRE')",
      [ids.produit, ids.organisation]
    );
    await administration.query(
      "insert into clients (id, organisation_id, type_client, nom) values ($1, $2, 'personne_morale', 'Client test')",
      [ids.client, ids.organisation]
    );
    await administration.query(
      `insert into contrats
        (id, organisation_id, numero_contrat, client_id, souscripteur_id, compagnie_id, produit_id,
         date_effet, duree_mois, fractionnement, date_fin, prime_totale)
       values ($1, $2, $3, $4, $4, $5, $6, current_date, 12, 'annuel',
               (current_date + interval '12 months' - interval '1 day')::date, 1000)`,
      [ids.contrat, ids.organisation, `TEST-${ids.contrat}`, ids.client, ids.compagnie, ids.produit]
    );
    await administration.query(
      `insert into echeances
        (id, organisation_id, contrat_id, type_echeance, numero_terme, date_echeance, montant_prime)
       values ($1, $2, $3, 'terme', 1, current_date, 1000)`,
      [ids.echeance, ids.organisation, ids.contrat]
    );
    await administration.query(
      `insert into paiements (organisation_id, echeance_id, montant, mode_paiement, date_paiement)
       values ($1, $2, 321.123, 'virement', current_date)`,
      [ids.organisation, ids.echeance]
    );
    await administration.query(
      `insert into paiements (organisation_id, echeance_id, montant, mode_paiement, date_paiement)
       values ($1, $2, 50, 'virement', current_date + 10)`,
      [ids.organisation, ids.echeance]
    );

    const token = jwt.sign({
      id: ids.utilisateur,
      nom: 'Admin test',
      role: 'admin',
      organisationId: ids.organisation,
    }, process.env.JWT_SECRET);
    const cookie = `jeton=${token}`;

    const avant = await request(app).get('/api/tableau-de-bord').set('Cookie', cookie).expect(200);
    assert.equal(Number(avant.body.encaissements12Mois[0].total), 321.123);

    await administration.query("update contrats set statut = 'resilie' where id = $1", [ids.contrat]);
    await request(app).delete(`/api/clients/${ids.client}`).set('Cookie', cookie).expect(200);
    const apresArchivageClient = await request(app).get('/api/tableau-de-bord').set('Cookie', cookie).expect(200);
    assert.equal(apresArchivageClient.body.encaissements12Mois.length, 0);
    assert.equal(apresArchivageClient.body.total_contrats, 0);

    await request(app).post(`/api/clients/${ids.client}/restaurer`).set('Cookie', cookie).expect(200);
    const apresRestaurationClient = await request(app).get('/api/tableau-de-bord').set('Cookie', cookie).expect(200);
    assert.equal(Number(apresRestaurationClient.body.encaissements12Mois[0].total), 321.123);
    assert.equal(apresRestaurationClient.body.total_contrats, 1);

    await request(app).delete(`/api/contrats/${ids.contrat}`).set('Cookie', cookie).expect(200);
    const apresArchivage = await request(app).get('/api/tableau-de-bord').set('Cookie', cookie).expect(200);
    assert.equal(apresArchivage.body.encaissements12Mois.length, 0);
    assert.equal(apresArchivage.body.total_contrats, 0);

    await request(app)
      .delete(`/api/corbeille/contrats/${ids.contrat}`)
      .set('Cookie', cookie)
      .expect(200);

    const restes = await administration.query(
      `select
        (select count(*) from contrats where id = $1)::int as contrats,
        (select count(*) from echeances where contrat_id = $1)::int as echeances,
        (select count(*) from paiements where echeance_id = $2)::int as paiements`,
      [ids.contrat, ids.echeance]
    );
    assert.deepEqual(restes.rows[0], { contrats: 0, echeances: 0, paiements: 0 });
  } finally {
    await administration.query('delete from journal_audit where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from relances where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from paiements where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from echeances where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from pieces_jointes_contrats where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from contrats where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from clients where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from produits where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from compagnies where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from utilisateurs where organisation_id = $1', [ids.organisation]).catch(() => {});
    await administration.query('delete from organisations where id = $1', [ids.organisation]).catch(() => {});
    await administration.end();
    await pool.end();
  }
});
