'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { synchroniserResumePaiementsContrat } = require('../src/paiements');

test('la suppression du dernier paiement réinitialise la feuille de caisse du contrat', async () => {
  const requetes = [];
  const client = {
    async query(texte, parametres) {
      requetes.push({ texte, parametres });
      if (texte.includes('from paiements p')) return { rows: [] };
      return { rowCount: 1, rows: [] };
    },
  };

  await synchroniserResumePaiementsContrat(client, 'contrat-1', 'utilisateur-1');

  assert.match(requetes[0].texte, /p\.supprime_le is null/);
  assert.deepEqual(requetes[1].parametres, [
    'contrat-1', false, null, null, null, null, 'utilisateur-1',
  ]);
});

test('la suppression conserve le résumé du paiement actif le plus récent', async () => {
  const requetes = [];
  const client = {
    async query(texte, parametres) {
      requetes.push({ texte, parametres });
      if (texte.includes('from paiements p')) {
        return { rows: [{
          feuille_caisse: true,
          com_nette: '9.034',
          com_nette_saisie: 'Commission 9,034',
          date_mise_a_jour: '2026-09-15',
          remarque: 'Paiement reçu par chèque',
        }] };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  await synchroniserResumePaiementsContrat(client, 'contrat-2', 'utilisateur-2');

  assert.match(requetes[0].texte, /order by p\.date_paiement desc/);
  assert.deepEqual(requetes[1].parametres, [
    'contrat-2', true, '9.034', 'Commission 9,034', '2026-09-15',
    'Paiement reçu par chèque', 'utilisateur-2',
  ]);
});
