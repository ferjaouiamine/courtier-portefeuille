const test = require('node:test');
const assert = require('node:assert/strict');

const {
  calculerDateFin,
  calculerDureeMoisEntreDates,
  validerDateFinFerme,
} = require('../src/dates-contrat');

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

test('la date de fin d’une durée ferme doit suivre la date d’effet', () => {
  assert.equal(validerDateFinFerme('2026-09-08', '2027-03-31'), '2027-03-31');
  assert.throws(
    () => validerDateFinFerme('2026-09-08', '2026-09-08'),
    /postérieure à la date d'effet/
  );
  assert.throws(() => validerDateFinFerme('2026-09-08', '2026-02-30'), /date de fin est invalide/i);
});

test('la durée technique est calculée entre la date d’effet et la date de fin', () => {
  assert.equal(calculerDureeMoisEntreDates('2026-01-01', '2031-01-01'), 60);
  assert.equal(calculerDureeMoisEntreDates('2026-01-31', '2026-04-30'), 3);
});

test('un contrat RTR n a pas de date de fin et garde sa période de renouvellement', () => {
  const { calculerPeriodeContrat, finDePeriode } = require('../src/dates-contrat');
  assert.deepEqual(
    calculerPeriodeContrat({ ferme: false, dateEffet: '2026-10-08', dateFin: '2030-01-01', dureeMois: undefined }),
    { dateFin: null, dureeMois: 12 }
  );
  assert.deepEqual(
    calculerPeriodeContrat({ ferme: false, dateEffet: '2026-10-08', dateFin: null, dureeMois: 120 }),
    { dateFin: null, dureeMois: 120 }
  );
  assert.equal(finDePeriode({ date_effet: '2026-10-08', date_fin: null, duree_mois: 12 }), '2027-10-08');
});

test('un contrat à durée ferme garde sa date de fin saisie', () => {
  const { calculerPeriodeContrat, finDePeriode } = require('../src/dates-contrat');
  assert.deepEqual(
    calculerPeriodeContrat({ ferme: true, dateEffet: '2026-10-08', dateFin: '2027-04-08', dureeMois: 12 }),
    { dateFin: '2027-04-08', dureeMois: 6 }
  );
  assert.equal(finDePeriode({ date_effet: '2026-10-08', date_fin: '2027-04-08', duree_mois: 6 }), '2027-04-08');
  assert.throws(
    () => calculerPeriodeContrat({ ferme: true, dateEffet: '2026-10-08', dateFin: '2026-10-01' }),
    /postérieure/
  );
});
