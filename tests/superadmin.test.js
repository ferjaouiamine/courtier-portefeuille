'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { lirePeriode, lireSaisieUtilisateur } = require('../src/routes/superadmin');

test("la période comptable par défaut va du 1er janvier à aujourd'hui", () => {
  assert.deepEqual(lirePeriode({}, '2026-10-08'), { du: '2026-01-01', au: '2026-10-08' });
  assert.deepEqual(lirePeriode({ du: '2026-03-01', au: '2026-03-31' }, '2026-10-08'), { du: '2026-03-01', au: '2026-03-31' });
  assert.deepEqual(lirePeriode({ du: 'invalide' }, '2026-10-08'), { du: '2026-01-01', au: '2026-10-08' });
  assert.throws(() => lirePeriode({ du: '2026-05-01', au: '2026-04-01' }, '2026-10-08'), /précéder/);
});

test('la saisie d un utilisateur normalise l e-mail et refuse un rôle inconnu', () => {
  assert.deepEqual(
    lireSaisieUtilisateur({ nom: ' Sami ', email: ' Sami@Finasure.TN ', role: 'agent' }),
    { nom: 'Sami', email: 'sami@finasure.tn', role: 'agent', superAdmin: false }
  );
  assert.throws(() => lireSaisieUtilisateur({ nom: 'Sami', email: 'sami@finasure.tn', role: 'superadmin' }), /Rôle/);
  assert.throws(() => lireSaisieUtilisateur({ nom: 'Sami', email: 'pas-un-email', role: 'agent' }), /e-mail/);
});
