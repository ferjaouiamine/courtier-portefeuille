'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { echapperCsv, formaterNumeroContratCsv } = require('../src/csv');

test('le numéro de contrat est exporté comme texte pour Excel', () => {
  assert.equal(
    formaterNumeroContratCsv('001234567890123456789'),
    '"=""001234567890123456789"""'
  );
});

test('les caractères du numéro restent dans une chaîne Excel sans exécuter leur contenu', () => {
  assert.equal(formaterNumeroContratCsv('+CMD|test'), '"=""+CMD|test"""');
  assert.equal(echapperCsv('A;B'), '"A;B"');
});
