const test = require('node:test');
const assert = require('node:assert/strict');

const { calculerDateFin, validerPeriodeContrat } = require('../src/validation-contrat');

test('calcule automatiquement la date de fin selon la durée', () => {
  assert.equal(calculerDateFin('2026-09-04', 12), '2027-09-03');
  assert.equal(calculerDateFin('2026-01-31', 1), '2026-02-27');
});

test('refuse une date de fin incohérente', () => {
  assert.throws(
    () => validerPeriodeContrat({
      dateEffet: '2026-09-04',
      dureeMois: 12,
      fractionnement: 'annuel',
      dateFin: '2026-09-07',
    }),
    /La date de fin doit être le 2027-09-03/
  );
});

test('refuse une fréquence plus longue que le contrat', () => {
  assert.throws(
    () => validerPeriodeContrat({
      dateEffet: '2026-09-04',
      dureeMois: 3,
      fractionnement: 'annuel',
    }),
    /contrat d'au moins 12 mois/
  );
});

test('retourne une période normalisée utilisable par l API', () => {
  assert.deepEqual(
    validerPeriodeContrat({
      dateEffet: '2026-09-04',
      dureeMois: '6',
      fractionnement: 'semestriel',
    }),
    { dureeMois: 6, dateFin: '2027-03-03' }
  );
});
