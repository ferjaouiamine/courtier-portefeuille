const test = require('node:test');
const assert = require('node:assert/strict');

const { resumerLigneAudit } = require('../src/audit');

test('le résumé d audit affiche l auteur et les champs modifiés', () => {
  const resume = resumerLigneAudit({
    id: 'audit-1',
    action: 'modification',
    table_cible: 'clients',
    ligne_id: 'client-1',
    cree_le: '2026-09-04T10:00:00Z',
    utilisateur_id: 'admin-1',
    utilisateur_nom: 'Souad Ben Hassine',
    utilisateur_email: 'souad.ben.hassine@finasure.tn',
    etat_avant: { nom: 'Ancien nom', telephone: '11111111' },
    etat_apres: { nom: 'Nouveau nom', telephone: '22222222' },
  });

  assert.equal(resume.utilisateur_nom, 'Souad Ben Hassine');
  assert.equal(resume.element, 'Nouveau nom');
  assert.deepEqual(resume.modifications, [
    { champ: 'Nom', avant: 'Ancien nom', apres: 'Nouveau nom' },
    { champ: 'Téléphone', avant: '11111111', apres: '22222222' },
  ]);
});

test('le résumé d audit ne retourne jamais le hachage du mot de passe', () => {
  const resume = resumerLigneAudit({
    action: 'creation',
    table_cible: 'utilisateurs',
    utilisateur_id: null,
    etat_apres: {
      nom: 'Administrateur',
      email: 'admin@finasure.tn',
      role: 'admin',
      mot_de_passe_hache: 'information-sensible',
    },
  });

  assert.equal(JSON.stringify(resume).includes('information-sensible'), false);
});
