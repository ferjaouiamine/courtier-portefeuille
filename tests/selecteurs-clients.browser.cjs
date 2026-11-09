// Vérification dans Chrome/Chromium, sans base de données ni dépendance ajoutée.
// Exécuter : node tests/selecteurs-clients.browser.cjs
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

async function verifierDansNavigateur() {
  const succes = [];
  const verifier = (condition, message) => { if (!condition) throw new Error(message); };
  const attendre = (ms = 350) => new Promise((resolve) => setTimeout(resolve, ms));
  const clients = Array.from({ length: 151 }, (_, i) => ({
    id: `client-${i + 1}`, nom: `Client ${String(i + 1).padStart(3, '0')}`,
    telephone: `26000${String(i + 1).padStart(3, '0')}`, cin_ou_matricule: `CIN-${i + 1}`,
  }));
  let ancienneReponse;
  let erreurSuivante = false;
  window.fetch = async (url) => {
    const requete = new URL(url, 'http://tests.local');
    const recherche = requete.searchParams.get('recherche') || '';
    if (recherche === 'ancienne') return new Promise((resolve) => { ancienneReponse = resolve; });
    if (erreurSuivante) { erreurSuivante = false; throw new Error('Erreur simulée'); }
    const page = Number(requete.searchParams.get('page') || 1);
    const limite = Number(requete.searchParams.get('limite') || 50);
    const trouves = clients.filter((client) => [client.nom, client.telephone, client.cin_ou_matricule]
      .some((valeur) => valeur.toLowerCase().includes(recherche.toLowerCase())));
    return { ok: true, status: 200, json: async () => ({
      donnees: trouves.slice((page - 1) * limite, page * limite),
      pagination: { page, totalPages: Math.max(1, Math.ceil(trouves.length / limite)) },
    }) };
  };
  const composant = (id) => composantsSelect.get(document.getElementById(id));
  const chercher = async (id, texte) => {
    const c = composant(id);
    c.saisie.value = texte;
    c.saisie.dispatchEvent(new Event('input', { bubbles: true }));
    await attendre();
    return c;
  };
  const choisir = (c, texte) => {
    const bouton = [...c.liste.querySelectorAll('button')].find((b) => b.textContent === texte);
    verifier(bouton, `Option absente : ${texte}`);
    bouton.click();
  };
  try {
    initialiserSelectsRecherchables();
    brancherEvenements();
    preparerClientsPourSelect();
    document.getElementById('modale-contrat').showModal();

    for (const id of ['contrat-client', 'contrat-souscripteur', 'contrat-payeur']) {
      const c = await chercher(id, 'Client 137');
      choisir(c, 'Client 137');
      verifier(c.select.value === 'client-137', `${id} : client hors premiere page`);
    }
    succes.push('Les trois selecteurs trouvent un client au-dela des 100 premiers');
    verifier(document.getElementById('contrat-souscripteur').value === 'client-137', 'Souscripteur initial');

    let c = await chercher('contrat-client', 'Client 151');
    choisir(c, 'Client 151');
    verifier(document.getElementById('contrat-souscripteur').value === 'client-151', 'Copie du souscripteur');
    succes.push('Le client choisi devient le souscripteur du nouveau contrat');

    c = await chercher('contrat-payeur', '26000137');
    choisir(c, 'Client 137');
    c = await chercher('contrat-payeur', 'CIN-151');
    choisir(c, 'Client 151');
    succes.push('Recherche par telephone et CIN, sans filtrage local sur le nom');

    c = await chercher('contrat-payeur', '');
    for (let page = 1; page <= 3; page += 1) {
      choisir(c, 'Résultats suivants →');
      await attendre(20);
    }
    choisir(c, 'Client 151');
    verifier(c.select.value === 'client-151', 'Pagination apres 150 clients');
    succes.push('Navigation dans toutes les pages de resultats');

    c = await chercher('contrat-payeur', 'introuvable');
    verifier(c.select.value === 'client-151', 'La recherche ne doit pas effacer la selection');
    verifier(c.liste.textContent.includes('Aucun client trouvé'), 'Etat sans resultat');
    choisir(c, 'Souscripteur');
    verifier(c.select.value === '', 'Payeur par defaut');
    succes.push('Selection conservee pendant la recherche et payeur par defaut disponible');

    await chercher('contrat-payeur', 'ancienne');
    c = await chercher('contrat-payeur', 'Client 137');
    ancienneReponse({ ok: true, status: 200, json: async () => ({ donnees: [clients[0]], pagination: { totalPages: 1 } }) });
    await attendre(20);
    verifier(c.liste.textContent.includes('Client 137') && !c.liste.textContent.includes('Client 001'), 'Reponse obsolete');
    succes.push('Une reponse ancienne ne remplace pas la recherche recente');

    erreurSuivante = true;
    c = await chercher('contrat-payeur', 'Client 137');
    choisir(c, 'Erreur simulée — Réessayer');
    await attendre(20);
    c.saisie.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    c.saisie.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    verifier(c.select.value === 'client-137', 'Selection clavier apres nouvelle tentative');
    succes.push('Nouvelle tentative apres erreur et selection au clavier');

    preparerClientsPourSelect({ client_id: 'client-151', client_nom: 'Client 151',
      souscripteur_id: 'client-137', souscripteur_nom: 'Client 137', payeur_id: 'client-150', payeur_nom: 'Client 150' });
    verifier(composant('contrat-client').saisie.value === 'Client 151', 'Client existant');
    verifier(composant('contrat-souscripteur').saisie.value === 'Client 137', 'Souscripteur existant');
    verifier(composant('contrat-payeur').saisie.value === 'Client 150', 'Payeur existant');
    succes.push('Les trois selections existantes sont affichees hors premiere page');

    await chercher('contrat-payeur', 'ancienne');
    document.getElementById('modale-contrat').close();
    await attendre(20);
    ancienneReponse({ ok: true, status: 200, json: async () => ({ donnees: [clients[0]], pagination: { totalPages: 1 } }) });
    await attendre(20);
    verifier(!composant('contrat-payeur').ouvert, 'Fermeture du selecteur avec la modale');
    verifier(document.getElementById('contrat-payeur').value === 'client-150', 'Reponse apres fermeture');
    succes.push('Fermer la modale annule la recherche en cours');
    document.body.dataset.resultatsTests = encodeURIComponent(JSON.stringify({ succes }));
  } catch (erreur) {
    document.body.dataset.resultatsTests = encodeURIComponent(JSON.stringify({ succes, erreur: erreur.message }));
  }
}

const racine = path.resolve(__dirname, '..');
const navigateur = process.env.CHROME_BINARY || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((fichier) => fs.existsSync(fichier));
if (!navigateur) throw new Error('Definir CHROME_BINARY avec le chemin de Chrome/Chromium.');
const temporaire = fs.mkdtempSync(path.join(os.tmpdir(), 'courtier-selecteurs-'));
try {
  const app = fs.readFileSync(path.join(racine, 'public/app.js'), 'utf8').replace(/initialiser\(\);\s*$/, '');
  const html = fs.readFileSync(path.join(racine, 'public/index.html'), 'utf8')
    .replace('<script src="/app.js"></script>', () => `<script>${app}\n(${verifierDansNavigateur.toString()})();</script>`);
  const fichier = path.join(temporaire, 'test.html');
  fs.writeFileSync(fichier, html);
  const execution = spawnSync(navigateur, ['--headless', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', `--user-data-dir=${path.join(temporaire, 'profil')}`,
    '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(fichier).href],
  { encoding: 'utf8', windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const resultat = execution.stdout?.match(/data-resultats-tests="([^"]+)"/);
  if (!resultat) throw new Error(`Verification navigateur incomplete : ${execution.error?.message || execution.status}`);
  const bilan = JSON.parse(decodeURIComponent(resultat[1]));
  for (const succes of bilan.succes) console.log(`OK ${succes}`);
  if (bilan.erreur) throw new Error(bilan.erreur);
  console.log(`${bilan.succes.length} scenarios navigateur reussis.`);
} finally {
  // Le dossier est celui cree pour ce test, sous le repertoire temporaire.
  if (path.dirname(path.resolve(temporaire)) === path.resolve(os.tmpdir())
      && path.basename(temporaire).startsWith('courtier-selecteurs-')) {
    fs.rmSync(temporaire, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
