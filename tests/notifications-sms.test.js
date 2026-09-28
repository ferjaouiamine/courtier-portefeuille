'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normaliserTelephone, envoyerAvecWinSms } = require('../src/notifications-sms');

test('normalise les numéros tunisiens au format E.164', () => {
  assert.equal(normaliserTelephone('22 345 678'), '+21622345678');
  assert.equal(normaliserTelephone('216 22 345 678'), '+21622345678');
  assert.equal(normaliserTelephone('+216 22 345 678'), '+21622345678');
});

test('refuse un numéro SMS invalide', () => {
  assert.equal(normaliserTelephone('123'), null);
  assert.equal(normaliserTelephone(''), null);
});

test('envoie un SMS avec le format REST WinSMS', async () => {
  const ancienneCle = process.env.WINSMS_API_KEY;
  const ancienFetch = global.fetch;
  process.env.WINSMS_API_KEY = 'cle-test';
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.winsms.co.za/api/rest/v1/sms/outgoing/send');
    assert.equal(options.headers.AUTHORIZATION, 'cle-test');
    assert.deepEqual(JSON.parse(options.body), {
      message: 'Message test',
      recipients: [{ mobileNumber: '21622345678' }],
      maxSegments: 1,
    });
    return {
      ok: true,
      json: async () => ({ recipients: [{ accepted: true, apiMessageId: 12345 }] }),
    };
  };
  try {
    assert.deepEqual(
      await envoyerAvecWinSms({ telephone: '+21622345678', message: 'Message test' }),
      { configure: true, id: '12345' }
    );
  } finally {
    if (ancienneCle === undefined) delete process.env.WINSMS_API_KEY;
    else process.env.WINSMS_API_KEY = ancienneCle;
    global.fetch = ancienFetch;
  }
});
