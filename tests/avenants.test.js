'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { calculerModifications, calculerPrimeTotale } = require('../src/avenants');

test('un avenant conserve uniquement les champs réellement modifiés', () => {
  const avant = {
    produit_id: 'auto-tiers', prime_totale: '900.000', fractionnement: 'annuel',
    date_fin_contrat: '2031-01-01', statut: 'en_cours',
  };
  const apres = {
    ...avant, produit_id: 'auto-tous-risques', prime_totale: 1100,
  };

  const modifications = calculerModifications(avant, apres);

  assert.deepEqual(modifications.map((ligne) => ligne.champ), ['produit_id', 'prime_totale']);
  assert.deepEqual(modifications[0], {
    champ: 'produit_id', libelle: 'Produit', avant: 'auto-tiers', apres: 'auto-tous-risques',
  });
});

test('un avenant identique ne crée aucune différence', () => {
  const version = {
    produit_id: 'produit-1', prime_totale: '900.000', fractionnement: 'annuel',
    retour_feuille_caisse: false,
  };
  assert.deepEqual(calculerModifications(version, { ...version, prime_totale: 900 }), []);
});

test("la prime totale est la prime précédente augmentée de la prime d'avenant", () => {
  assert.equal(calculerPrimeTotale('900.000', 150.5), 1050.5);
  assert.equal(calculerPrimeTotale('0.100', 0.2), 0.3);
  assert.equal(calculerPrimeTotale('900.000', -100), 800);
});
