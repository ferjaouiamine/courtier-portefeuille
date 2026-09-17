'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normaliserFeuilleCaisse,
  normaliserDureeEtFractionnement,
  moisDuFractionnement,
  typeDureeDepuisFractionnement,
} = require('../src/regles-contrat');

test('une feuille de caisse absente impose une commission nette vide', () => {
  assert.deepEqual(normaliserFeuilleCaisse(false, 150), {
    feuilleCaisse: false,
    commissionNette: null,
    commissionNetteSaisie: null,
  });
});

test('une feuille de caisse disponible exige une commission nette valide', () => {
  assert.deepEqual(normaliserFeuilleCaisse(true, '150.250'), {
    feuilleCaisse: true,
    commissionNette: 150.25,
    commissionNetteSaisie: '150.250',
  });
  assert.deepEqual(normaliserFeuilleCaisse(true, 'Commission 1 250,375 DT'), {
    feuilleCaisse: true,
    commissionNette: 1250.375,
    commissionNetteSaisie: 'Commission 1 250,375 DT',
  });
  assert.throws(() => normaliserFeuilleCaisse(true, ''), /commission nette est obligatoire/);
  assert.throws(() => normaliserFeuilleCaisse(true, 'non calculée'), /commission nette est obligatoire/);
  assert.throws(() => normaliserFeuilleCaisse(true, -1), /commission nette est obligatoire/);
});

test('une durée ferme impose la prime unique', () => {
  assert.deepEqual(normaliserDureeEtFractionnement('ferme', 'trimestriel'), {
    typeDuree: 'ferme',
    fractionnement: 'prime_unique',
  });
  assert.equal(typeDureeDepuisFractionnement('prime_unique'), 'ferme');
});

test('une durée RTR accepte les trois fréquences prévues', () => {
  for (const fractionnement of ['annuel', 'semestriel', 'trimestriel']) {
    assert.deepEqual(normaliserDureeEtFractionnement('rtr', fractionnement), {
      typeDuree: 'rtr',
      fractionnement,
    });
  }
  assert.equal(typeDureeDepuisFractionnement('annuel'), 'rtr');
  assert.equal(moisDuFractionnement('trimestriel'), 3);
  assert.equal(moisDuFractionnement('semestriel'), 6);
  assert.equal(moisDuFractionnement('annuel'), 12);
});

test('une durée RTR refuse la prime unique', () => {
  assert.throws(
    () => normaliserDureeEtFractionnement('rtr', 'prime_unique'),
    /fréquence annuelle, semestrielle ou trimestrielle/
  );
});
