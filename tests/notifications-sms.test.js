'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normaliserTelephone,
  construireRappelEcheance,
  envoyerAvecWinSms,
} = require('../src/notifications-sms');

test('normalise les numéros tunisiens au format E.164', () => {
  assert.equal(normaliserTelephone('22 345 678'), '+21622345678');
  assert.equal(normaliserTelephone('216 22 345 678'), '+21622345678');
  assert.equal(normaliserTelephone('+216 22 345 678'), '+21622345678');
});

test('refuse un numéro SMS invalide', () => {
  assert.equal(normaliserTelephone('123'), null);
  assert.equal(normaliserTelephone(''), null);
});

test('construit le rappel avec le contrat, la date et la prime', () => {
  assert.equal(
    construireRappelEcheance({
      numeroContrat: '25702000004',
      dateEcheance: '2026-10-30',
      montantPrime: '1082.097',
    }),
    "Cher client,\n\nVotre contrat d'assurance numero 25702000004 arrive a echeance le 30/10/2026.\n\nMerci de proceder au paiement de votre prime d'assurance de 1 082,097 DT.\n\nFinasure\n26 17 94 10 / 29 27 98 78"
  );
});

test('envoie un SMS avec le format API WinSMS Tunisie', async () => {
  const ancienneCle = process.env.WINSMS_API_KEY;
  const ancienExpediteur = process.env.WINSMS_SENDER_ID;
  const ancienFetch = global.fetch;
  process.env.WINSMS_API_KEY = 'cle-test';
  process.env.WINSMS_SENDER_ID = 'Finasure';
  global.fetch = async (url, options) => {
    assert.equal(url.origin + url.pathname, 'https://www.winsmspro.com/sms/sms/api');
    assert.equal(url.searchParams.get('action'), 'send-sms');
    assert.equal(url.searchParams.get('api_key'), 'cle-test');
    assert.equal(url.searchParams.get('to'), '21622345678');
    assert.equal(url.searchParams.get('sms'), 'Message test');
    assert.equal(url.searchParams.get('from'), 'Finasure');
    assert.equal(options.method, 'GET');
    return {
      ok: true,
      text: async () => JSON.stringify({ status: 'success', ref: 12345 }),
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
    if (ancienExpediteur === undefined) delete process.env.WINSMS_SENDER_ID;
    else process.env.WINSMS_SENDER_ID = ancienExpediteur;
    global.fetch = ancienFetch;
  }
});
