'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliserTelephone } = require('../src/notifications-sms');

test('normalise les numéros tunisiens au format E.164', () => {
  assert.equal(normaliserTelephone('22 345 678'), '+21622345678');
  assert.equal(normaliserTelephone('216 22 345 678'), '+21622345678');
  assert.equal(normaliserTelephone('+216 22 345 678'), '+21622345678');
});

test('refuse un numéro SMS invalide', () => {
  assert.equal(normaliserTelephone('123'), null);
  assert.equal(normaliserTelephone(''), null);
});
