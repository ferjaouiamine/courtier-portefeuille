'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculerDateTerme, synchroniserProchaineEcheance } = require('../src/echeancier');

test('chaque prochain terme reste ancré sur la date d’effet', () => {
  assert.equal(calculerDateTerme('2026-01-31', 'trimestriel', 1), '2026-04-30');
  assert.equal(calculerDateTerme('2026-01-31', 'trimestriel', 2), '2026-07-31');
  assert.equal(calculerDateTerme('2026-01-31', 'semestriel', 2), '2027-01-31');
  assert.equal(calculerDateTerme('2026-01-31', 'annuel', 2), '2028-01-31');
});

test('une prime unique ne produit aucun terme suivant', () => {
  assert.equal(calculerDateTerme('2026-01-31', 'prime_unique', 1), null);
});

test('le terme suivant est créé après le dernier terme payé', async () => {
  const requetes = [];
  const client = {
    async query(texte, parametres) {
      requetes.push({ texte, parametres });
      if (texte.includes('coalesce(max(numero_terme)')) return { rows: [{ numero: 1 }] };
      if (texte.includes('insert into echeances')) {
        return {
          rowCount: 1,
          rows: [{ numero_terme: parametres[1], date_echeance: parametres[2] }],
        };
      }
      return { rowCount: 1, rows: [] };
    },
  };

  const prochaine = await synchroniserProchaineEcheance(client, {
    id: 'contrat-1',
    date_effet: '2026-01-31',
    fractionnement: 'trimestriel',
    prime_totale: '900.000',
    com_brute: '0',
    echeancier_personnalise: false,
  });

  assert.equal(prochaine.numero_terme, 2);
  assert.equal(prochaine.date_echeance, '2026-07-31');
  const insertion = requetes.find((requete) => requete.texte.includes('insert into echeances'));
  assert.deepEqual(insertion.parametres.slice(0, 4), ['contrat-1', 2, '2026-07-31', '900.000']);
});

test('un échéancier personnalisé n’est jamais prolongé automatiquement', async () => {
  let appels = 0;
  const client = { query: async () => { appels += 1; } };
  const prochaine = await synchroniserProchaineEcheance(client, { echeancier_personnalise: true });
  assert.equal(prochaine, null);
  assert.equal(appels, 0);
});
