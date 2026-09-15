'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  NOMBRE_ECHEANCES_FUTURES,
  calculerDateTerme,
  completerTousLesEcheanciers,
  enregistrerPaiementInitial,
  synchroniserProchaineEcheance,
} = require('../src/echeancier');

test('le paiement initial solde une échéance à la date d’effet', async () => {
  const requetes = [];
  const client = {
    async query(texte, parametres) {
      requetes.push({ texte, parametres });
      if (texte.includes('insert into echeances')) return { rows: [{ id: 'echeance-0' }] };
      return { rows: [{ id: 'paiement-0' }] };
    },
  };

  const resultat = await enregistrerPaiementInitial(client, {
    id: 'contrat-1', date_effet: '2026-09-15', prime_totale: '103.375', com_brute: '0',
  }, 'utilisateur-1', {
    modePaiement: 'cheque', reference: 'CH-001', feuilleCaisse: true, commissionNette: 9.034,
  });

  assert.equal(resultat.echeance.id, 'echeance-0');
  assert.match(requetes[0].texte, /numero_terme, date_echeance/);
  assert.deepEqual(requetes[0].parametres, ['contrat-1', '2026-09-15', '103.375', '0']);
  assert.equal(requetes[1].parametres[0], 'echeance-0');
  assert.equal(requetes[1].parametres[4], '2026-09-15');
  assert.equal(requetes[1].parametres[5], true);
  assert.equal(requetes[1].parametres[6], 9.034);
  assert.equal(requetes[1].parametres[7], '2026-09-15');
});

test('chaque prochain terme reste ancré sur la date d’effet', () => {
  assert.equal(calculerDateTerme('2026-01-31', 'trimestriel', 1), '2026-04-30');
  assert.equal(calculerDateTerme('2026-01-31', 'trimestriel', 2), '2026-07-31');
  assert.equal(calculerDateTerme('2026-01-31', 'semestriel', 2), '2027-01-31');
  assert.equal(calculerDateTerme('2026-01-31', 'annuel', 2), '2028-01-31');
});

test('une prime unique ne produit aucun terme suivant', () => {
  assert.equal(calculerDateTerme('2026-01-31', 'prime_unique', 1), null);
});

test('dix termes futurs sont maintenus après le dernier terme payé', async () => {
  const requetes = [];
  const client = {
    async query(texte, parametres) {
      requetes.push({ texte, parametres });
      if (texte.includes('coalesce(max(numero_terme)')) {
        return { rows: [{ dernier_numero: 1, numeros_payes: [1] }] };
      }
      if (texte.includes('numero_terme = $2')) {
        return { rows: [{ numero_terme: parametres[1], date_echeance: '2026-07-31' }] };
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
  assert.deepEqual(insertion.parametres[1], [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(insertion.parametres[2].length, NOMBRE_ECHEANCES_FUTURES);
  assert.equal(insertion.parametres[2][0], '2026-07-31');
  assert.equal(insertion.parametres[2][9], '2028-10-31');
  assert.equal(insertion.parametres[3], '900.000');
});

test('la complétion globale utilise une seule requête et renvoie son bilan', async () => {
  let texteExecute = '';
  const modifications = await completerTousLesEcheanciers({
    query: async (texte) => {
      texteExecute = texte;
      return { rows: [{ modifications: 24 }] };
    },
  });

  assert.equal(modifications, 24);
  assert.match(texteExecute, /greatest\(e\.dernier_numero \+ 10, 10\)/);
  assert.match(texteExecute, /not c\.echeancier_personnalise/);
});

test('un paiement hors ordre ne masque pas les termes antérieurs encore dus', async () => {
  let numerosInseres;
  const client = {
    async query(texte, parametres) {
      if (texte.includes('coalesce(max(numero_terme)')) {
        return { rows: [{ dernier_numero: 10, numeros_payes: [5] }] };
      }
      if (texte.includes('insert into echeances')) numerosInseres = parametres[1];
      if (texte.includes('numero_terme = $2')) {
        return { rows: [{ numero_terme: parametres[1], date_echeance: '2026-04-30' }] };
      }
      return { rows: [] };
    },
  };

  await synchroniserProchaineEcheance(client, {
    id: 'contrat-2', date_effet: '2026-01-31', fractionnement: 'trimestriel',
    prime_totale: '900.000', com_brute: '0', echeancier_personnalise: false,
  });

  assert.deepEqual(numerosInseres, [1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
});

test('un échéancier personnalisé n’est jamais prolongé automatiquement', async () => {
  let appels = 0;
  const client = { query: async () => { appels += 1; } };
  const prochaine = await synchroniserProchaineEcheance(client, { echeancier_personnalise: true });
  assert.equal(prochaine, null);
  assert.equal(appels, 0);
});
