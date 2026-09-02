require('dotenv').config();

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const { exigerConnexion, exigerRole } = require('../src/auth');
const { avecOrganisation, organisationCourante } = require('../src/contexte');
const { pool, requete } = require('../src/db');
const { Pool } = require('pg');

const ORGANISATION_PRINCIPALE = '00000000-0000-4000-8000-000000000001';

function jeton(role, organisationId = ORGANISATION_PRINCIPALE) {
  return jwt.sign({ id: crypto.randomUUID(), nom: 'Test', role, organisationId }, process.env.JWT_SECRET);
}

function applicationPermissions() {
  const app = express();
  app.use(cookieParser());
  app.get('/lecture', exigerConnexion, (req, res) => {
    res.json({ organisationId: organisationCourante() });
  });
  app.post('/ecriture', exigerConnexion, exigerRole('admin', 'agent'), (req, res) => res.json({ ok: true }));
  return app;
}

test('une route protégée refuse une requête sans session', async () => {
  await request(applicationPermissions()).get('/lecture').expect(401);
});

test('le rôle lecture ne peut pas écrire', async () => {
  await request(applicationPermissions())
    .post('/ecriture')
    .set('Cookie', `jeton=${jeton('lecture')}`)
    .expect(403);
});

test('le JWT propage l’organisation dans le contexte de la requête', async () => {
  const organisationId = crypto.randomUUID();
  const reponse = await request(applicationPermissions())
    .get('/lecture')
    .set('Cookie', `jeton=${jeton('agent', organisationId)}`)
    .expect(200);
  assert.equal(reponse.body.organisationId, organisationId);
});

test('PostgreSQL isole les clients entre deux organisations', async (t) => {
  if (!process.env.DATABASE_URL) return t.skip('DATABASE_URL absent');

  const organisationB = crypto.randomUUID();
  const nomMarqueur = `CLIENT-ISOLATION-${crypto.randomUUID()}`;
  const administration = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  await administration.query('insert into organisations (id, nom) values ($1, $2)', [organisationB, 'Organisation test']);

  try {
    const clientB = await avecOrganisation(organisationB, () => requete(
      `insert into clients (type_client, nom) values ('personne_morale', $1) returning id`,
      [nomMarqueur]
    ));

    const visibleB = await avecOrganisation(organisationB, () => requete(
      'select id from clients where id = $1', [clientB.rows[0].id]
    ));
    const invisibleA = await avecOrganisation(ORGANISATION_PRINCIPALE, () => requete(
      'select id from clients where id = $1', [clientB.rows[0].id]
    ));
    const modificationA = await avecOrganisation(ORGANISATION_PRINCIPALE, () => requete(
      'update clients set nom = $1 where id = $2', ['INTERDIT', clientB.rows[0].id]
    ));

    assert.equal(visibleB.rowCount, 1);
    assert.equal(invisibleA.rowCount, 0);
    assert.equal(modificationA.rowCount, 0);
  } finally {
    await avecOrganisation(organisationB, () => requete('delete from clients where nom = $1', [nomMarqueur]));
    await avecOrganisation(organisationB, () => requete('delete from journal_audit'));
    await administration.query('delete from organisations where id = $1', [organisationB]);
    await administration.end();
  }
});

test.after(async () => {
  await pool.end();
});
