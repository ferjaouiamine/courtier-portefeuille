const test = require('node:test');
const assert = require('node:assert/strict');

const { calculerDateFin } = require('../src/dates-contrat');

test('la date de fin est calculée avec la durée en mois', () => {
  assert.equal(calculerDateFin('2026-09-08', 3), '2026-12-08');
  assert.equal(calculerDateFin('2026-09-08', 12), '2027-09-08');
});

test('le calcul conserve une date valide en fin de mois', () => {
  assert.equal(calculerDateFin('2026-01-31', 1), '2026-02-28');
  assert.equal(calculerDateFin('2024-02-29', 12), '2025-02-28');
});

test('la date et la durée invalides sont refusées', () => {
  assert.throws(() => calculerDateFin('2026-02-30', 12), /date d'effet est invalide/i);
  assert.throws(() => calculerDateFin('2026-09-08', 0), /durée du contrat/i);
  assert.throws(() => calculerDateFin('2026-09-08', 1.5), /durée du contrat/i);
  assert.throws(() => calculerDateFin('2026-09-08', 1201), /durée du contrat/i);
});
