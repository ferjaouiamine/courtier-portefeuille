'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normaliserDureeEtFractionnement,
  moisDuFractionnement,
  typeDureeDepuisFractionnement,
} = require('../src/regles-contrat');

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
