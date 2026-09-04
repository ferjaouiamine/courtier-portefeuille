'use strict';

const etat = {
  utilisateur: null,
  vue: 'tableau-de-bord',
  compagnies: [],
  produits: [],
  clients: [],
  contratId: null,
  clientId: null,
  echeanceId: null,
  edition: {},
  pages: { echeances: 1, contrats: 1, clients: 1 },
};

const $ = (selecteur, racine = document) => racine.querySelector(selecteur);
const $$ = (selecteur, racine = document) => [...racine.querySelectorAll(selecteur)];

function echapper(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formaterMontant(valeur) {
  return `${new Intl.NumberFormat('fr-TN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number(valeur) || 0).replace(/\u202f/g, ' ')} DT`;
}

function formaterDate(valeur, avecHeure = false) {
  if (!valeur) return '—';
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fr-FR', avecHeure
    ? { dateStyle: 'short', timeStyle: 'short' }
    : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function libelleCode(valeur) {
  return String(valeur ?? '—').replaceAll('_', ' ');
}

function calculerDateEcheance() {
  const valeur = $('#contrat-date-effet').value;
  const mois = { trimestriel: 3, semestriel: 6, annuel: 12 }[$('#contrat-fractionnement').value];
  if (!valeur || !mois) {
    $('#contrat-date-echeance').value = '';
    return;
  }
  const [annee, moisInitial, jour] = valeur.split('-').map(Number);
  const indexCible = moisInitial - 1 + mois;
  const anneeCible = annee + Math.floor(indexCible / 12);
  const moisCible = ((indexCible % 12) + 12) % 12;
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate();
  $('#contrat-date-echeance').value = `${anneeCible}-${String(moisCible + 1).padStart(2, '0')}-${String(Math.min(jour, dernierJour)).padStart(2, '0')}`;
}

function calculerDateFinContrat() {
  const valeur = $('#contrat-date-effet').value;
  const duree = Number($('#contrat-duree').value);
  const champDateFin = $('#contrat-date-fin');
  if (!valeur || !Number.isInteger(duree) || duree < 1 || duree > 120) {
    champDateFin.value = '';
    return;
  }

  const [annee, moisInitial, jour] = valeur.split('-').map(Number);
  const indexCible = moisInitial - 1 + duree;
  const anneeCible = annee + Math.floor(indexCible / 12);
  const moisCible = ((indexCible % 12) + 12) % 12;
  const dernierJour = new Date(Date.UTC(anneeCible, moisCible + 1, 0)).getUTCDate();
  const dateFin = new Date(Date.UTC(anneeCible, moisCible, Math.min(jour, dernierJour)));
  dateFin.setUTCDate(dateFin.getUTCDate() - 1);
  champDateFin.value = [
    dateFin.getUTCFullYear(),
    String(dateFin.getUTCMonth() + 1).padStart(2, '0'),
    String(dateFin.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function actualiserDatesContrat() {
  calculerDateFinContrat();
  calculerDateEcheance();
  const duree = Number($('#contrat-duree').value);
  const frequence = { trimestriel: 3, semestriel: 6, annuel: 12 }[$('#contrat-fractionnement').value];
  $('#contrat-duree').setCustomValidity(
    frequence && Number.isInteger(duree) && duree < frequence
      ? `La durée doit être d'au moins ${frequence} mois pour cette fréquence.`
      : ''
  );
}

function parametres(objet) {
  const recherche = new URLSearchParams();
  Object.entries(objet).forEach(([cle, valeur]) => {
    if (valeur !== '' && valeur !== null && valeur !== undefined) recherche.set(cle, valeur);
  });
  return recherche.toString();
}

function debounce(fonction, delai = 300) {
  let minuterie;
  return (...argumentsRecus) => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => fonction(...argumentsRecus), delai);
  };
}

function peutEcrire() {
  return etat.utilisateur?.role !== 'lecture';
}

function afficherConnexion() {
  etat.utilisateur = null;
  $('#app').hidden = true;
  $('#vue-connexion').hidden = false;
}

function effacerErreurs(conteneur = document) {
  $$('.message-erreur', conteneur).forEach((zone) => {
    zone.textContent = '';
    zone.hidden = true;
  });
}

function afficherErreur(message, conteneur = $(`#vue-${etat.vue}`) || $('#contenu')) {
  let zone = $('.message-erreur', conteneur);
  if (!zone) {
    zone = document.createElement('p');
    zone.className = 'message-erreur';
    conteneur.prepend(zone);
  }
  zone.textContent = message || 'Une erreur est survenue.';
  zone.hidden = false;
  zone.scrollIntoView({ block: 'nearest' });
}

async function api(chemin, options = {}) {
  const estFormulaireFichier = options.body instanceof FormData;
  const reponse = await fetch(chemin, {
    credentials: 'include',
    ...options,
    headers: options.body && !estFormulaireFichier
      ? { 'Content-Type': 'application/json', ...(options.headers || {}) }
      : options.headers,
  });
  let donnees = {};
  try {
    donnees = await reponse.json();
  } catch (_) {
    // Certaines réponses réussies peuvent ne pas contenir de JSON.
  }
  if (reponse.status === 401) afficherConnexion();
  if (!reponse.ok) throw new Error(donnees.erreur || 'La demande n’a pas pu aboutir.');
  return donnees;
}

function appliquerDroits() {
  $('#nav-corbeille').hidden = etat.utilisateur.role !== 'admin';
  $$('#bouton-nouveau-contrat, #bouton-nouveau-client, #bouton-nouvelle-compagnie, #bouton-nouveau-produit')
    .forEach((element) => { element.hidden = !peutEcrire(); });
}

async function changerVue(nom) {
  if (nom === 'corbeille' && etat.utilisateur?.role !== 'admin') nom = 'tableau-de-bord';
  etat.vue = nom;
  effacerErreurs();
  $$('.vue').forEach((vue) => { vue.hidden = vue.id !== `vue-${nom}`; });
  $$('#navigation button[data-vue]').forEach((bouton) => {
    const actif = bouton.dataset.vue === nom
      || (nom === 'fiche-contrat' && bouton.dataset.vue === 'contrats')
      || (nom === 'fiche-client' && bouton.dataset.vue === 'clients');
    bouton.classList.toggle('actif', actif);
  });
  const chargeurs = {
    'tableau-de-bord': chargerTableauDeBord,
    echeances: chargerEcheances,
    contrats: chargerContrats,
    clients: chargerClients,
    referentiel: chargerReferentiel,
    corbeille: chargerCorbeille,
  };
  try {
    if (chargeurs[nom]) await chargeurs[nom]();
  } catch (erreur) {
    afficherErreur(erreur.message);
  }
}

function remplirSelect(selecteur, lignes, texte, conserver = true) {
  const select = $(selecteur);
  const valeur = conserver ? select.value : '';
  const premiere = select.options[0]?.value === '' ? select.options[0].outerHTML : '';
  select.innerHTML = premiere + lignes.map((ligne) =>
    `<option value="${echapper(ligne.id)}">${echapper(texte(ligne))}</option>`).join('');
  if ([...select.options].some((option) => option.value === valeur)) select.value = valeur;
}

async function chargerReferentiels(force = false) {
  if (!force && etat.compagnies.length && etat.produits.length) return;
  [etat.compagnies, etat.produits] = await Promise.all([
    api('/api/compagnies'),
    api('/api/produits'),
  ]);
  remplirSelect('#filtre-compagnie-contrat', etat.compagnies, (x) => x.nom);
  remplirSelect('#filtre-produit-contrat', etat.produits, (x) => `${x.branche} — ${x.nom}`);
  remplirSelect('#contrat-compagnie', etat.compagnies, (x) => x.nom, false);
  remplirSelect('#contrat-produit', etat.produits, (x) => `${x.branche} — ${x.nom}`, false);
  const select = $('#filtre-compagnie-echeance');
  const valeur = select.value;
  select.innerHTML = '<option value="">Toutes</option>' + etat.compagnies.map((x) =>
    `<option value="${echapper(x.nom)}">${echapper(x.nom)}</option>`).join('');
  select.value = valeur;
}

async function chargerClientsPourSelect() {
  const resultat = await api('/api/clients?limite=100');
  etat.clients = resultat.donnees;
  remplirSelect('#contrat-client', etat.clients, (x) => x.nom, false);
  remplirSelect('#contrat-souscripteur', etat.clients, (x) => x.nom, false);
  remplirSelect('#contrat-payeur', etat.clients, (x) => x.nom, false);
}

function afficherPagination(type, pagination) {
  const zone = $(`#pagination-${type}`);
  if (!zone) return;
  zone.innerHTML = `<span>${pagination.total} résultat(s)</span><div>
    <button type="button" data-action="changer-page" data-cible="${type}" data-page="${pagination.page - 1}"
      ${pagination.page <= 1 ? 'disabled' : ''}>Précédent</button>
    <span>Page ${pagination.page} / ${pagination.totalPages}</span>
    <button type="button" data-action="changer-page" data-cible="${type}" data-page="${pagination.page + 1}"
      ${pagination.page >= pagination.totalPages ? 'disabled' : ''}>Suivant</button>
  </div>`;
}

function repartitionHtml(lignes, cleNom, cleMontant) {
  if (!lignes.length) return '<p class="etat-vide">Aucune donnée disponible.</p>';
  const maximum = Math.max(0, ...lignes.map((ligne) => Number(ligne[cleMontant]) || 0));
  return lignes.map((ligne) => {
    const montant = Number(ligne[cleMontant]) || 0;
    const largeur = maximum ? Math.max(2, montant / maximum * 100) : 0;
    return `<div class="ligne-repartition">
      <span class="nom" title="${echapper(ligne[cleNom])}">${echapper(ligne[cleNom])}</span>
      <span class="barre"><span style="width:${largeur}%"></span></span>
      <span class="montant">${formaterMontant(montant)}</span>
    </div>`;
  }).join('');
}

async function chargerTableauDeBord() {
  const donnees = await api('/api/tableau-de-bord');
  const statistiques = [
    ['Total contrats', donnees.total_contrats],
    ['Contrats en cours', donnees.contrats_en_cours],
    ['Primes émises', formaterMontant(donnees.primes_emises)],
    ['En retard', donnees.en_retard, Number(donnees.en_retard) > 0],
    ['Sous 30 jours', donnees.sous_30_jours],
  ];
  $('#stats-tableau-de-bord').innerHTML = statistiques.map(([libelle, valeur, alerte]) =>
    `<div class="carte stat${alerte ? ' alerte' : ''}"><div class="valeur">${echapper(valeur)}</div><div class="libelle">${libelle}</div></div>`).join('');
  $('#repartition-compagnie').innerHTML = repartitionHtml(donnees.parCompagnie, 'compagnie_nom', 'primes');
  $('#repartition-branche').innerHTML = repartitionHtml(donnees.parBranche, 'branche', 'primes');
  $('#repartition-encaissements').innerHTML = repartitionHtml(donnees.encaissements12Mois, 'mois', 'total');

  const frise = $('#frise');
  frise.style.position = 'relative';
  frise.style.overflow = 'visible';
  const reperes = [0, 30, 60, 90, 120].map((jours, index) => {
    const valeur = new Date();
    valeur.setDate(valeur.getDate() + jours);
    return `<span class="frise-repere${index === 4 ? ' dernier' : ''}" style="left:${jours / 1.2}%">${jours === 0 ? 'Aujourd’hui' : formaterDate(valeur)}</span>`;
  }).join('');
  const points = donnees.frise120Jours.map((ligne) => {
    const jours = Math.max(0, Math.min(120, Math.ceil((new Date(ligne.date_echeance) - new Date()) / 86400000)));
    return `<button type="button" class="frise-point ${echapper(ligne.niveau)}"
      data-action="ouvrir-contrat" data-id="${echapper(ligne.contrat_id)}"
      style="position:absolute;left:${jours / 1.2}%;height:12px"
      title="${echapper(`${formaterDate(ligne.date_echeance)} — ${ligne.client_nom} — ${ligne.numero_contrat}`)}"></button>`;
  }).join('');
  frise.innerHTML = reperes + points;

  const prochainesEcheances = donnees.frise120Jours.slice(0, 12);
  $('#corps-prochaines-echeances').innerHTML = prochainesEcheances.map((ligne) => `
    <tr data-contrat-id="${echapper(ligne.contrat_id)}" title="Ouvrir le contrat ${echapper(ligne.numero_contrat)}">
      <td><strong>${formaterDate(ligne.date_echeance)}</strong><br><span class="texte-secondaire">dans ${echapper(ligne.jours_restants)} jour(s)</span></td>
      <td><span class="etiquette-niveau ${echapper(ligne.niveau)}">${echapper(libelleCode(ligne.niveau))}</span></td>
      <td>${echapper(ligne.client_nom)}</td>
      <td>${echapper(ligne.numero_contrat)}</td>
      <td>${echapper(ligne.compagnie_nom)}</td>
      <td>${formaterMontant(ligne.montant_prime)}</td>
    </tr>`).join('');
  $('#etat-vide-prochaines-echeances').hidden = prochainesEcheances.length > 0;
  $('#carte-prochaines-echeances .tableau-responsive').hidden = prochainesEcheances.length === 0;
}

function filtresEcheances() {
  return {
    fenetre: $('#filtre-fenetre').value,
    niveau: $('#filtre-niveau').value,
    type_echeance: $('#filtre-type-echeance').value,
    compagnie_nom: $('#filtre-compagnie-echeance').value,
    recherche: $('#filtre-recherche-echeance').value.trim(),
  };
}

async function chargerEcheances() {
  await chargerReferentiels();
  const resultat = await api(`/api/echeances?${parametres({
    ...filtresEcheances(), page: etat.pages.echeances, limite: 50,
  })}`);
  const lignes = resultat.donnees;
  $('#corps-tableau-echeances').innerHTML = lignes.map((ligne) => `<tr data-contrat-id="${echapper(ligne.contrat_id)}">
    <td>${formaterDate(ligne.date_echeance)}</td>
    <td><span class="etiquette-niveau ${echapper(ligne.niveau)}">${echapper(libelleCode(ligne.niveau))}</span></td>
    <td>${echapper(ligne.client_nom)}${ligne.client_telephone ? `<br><a href="tel:${echapper(ligne.client_telephone)}">${echapper(ligne.client_telephone)}</a>` : ''}</td>
    <td>${echapper(ligne.numero_contrat)}</td><td>${echapper(ligne.compagnie_nom)}</td>
    <td>${echapper(libelleCode(ligne.type_echeance))}</td><td>${formaterMontant(ligne.montant_prime)}</td>
    <td>${formaterMontant(ligne.montant_regle)}</td><td>${echapper(libelleCode(ligne.statut))}</td>
    <td><div class="actions-ligne"${peutEcrire() ? '' : ' hidden'}>
      ${ligne.type_echeance === 'terme' ? `<button type="button" data-action="encaisser" data-id="${echapper(ligne.echeance_id)}" data-solde="${Math.max(0, Number(ligne.montant_prime) - Number(ligne.montant_regle))}">Encaisser</button>` : ''}
      <button type="button" data-action="relancer" data-id="${echapper(ligne.echeance_id)}">Relancer</button>
    </div></td></tr>`).join('');
  $('#etat-vide-echeances').hidden = lignes.length > 0;
  afficherPagination('echeances', resultat.pagination);
}

function filtresContrats() {
  return {
    statut: $('#filtre-statut-contrat').value,
    compagnie_id: $('#filtre-compagnie-contrat').value,
    produit_id: $('#filtre-produit-contrat').value,
    recherche: $('#filtre-recherche-contrat').value.trim(),
    tri: $('#filtre-tri-contrat').value,
  };
}

async function chargerContrats() {
  await chargerReferentiels();
  const resultat = await api(`/api/contrats?${parametres({
    ...filtresContrats(), page: etat.pages.contrats, limite: 50,
  })}`);
  const lignes = resultat.donnees;
  $('#corps-tableau-contrats').innerHTML = lignes.map((ligne) => `<tr data-contrat-id="${echapper(ligne.id)}">
    <td>${echapper(ligne.numero_contrat)}</td><td>${echapper(ligne.client_nom)}</td>
    <td>${echapper(ligne.compagnie_nom)}</td><td>${echapper(ligne.produit_nom)}</td>
    <td>${formaterDate(ligne.date_effet)}</td><td>${formaterDate(ligne.date_fin)}</td>
    <td>${formaterMontant(ligne.prime_totale)}</td><td>${echapper(libelleCode(ligne.statut))}</td></tr>`).join('');
  $('#etat-vide-contrats').hidden = lignes.length > 0;
  afficherPagination('contrats', resultat.pagination);
  $('#bouton-export-csv').href = `/api/export/portefeuille.csv?${parametres(filtresContrats())}`;
}

async function ouvrirFicheContrat(id) {
  const contrat = await api(`/api/contrats/${id}`);
  etat.contratId = contrat.id;
  const actions = peutEcrire() ? `<div class="actions-ligne">
    <button type="button" data-action="modifier-contrat">Modifier</button>
    ${contrat.statut === 'en_cours' ? '<button type="button" data-action="renouveler-contrat">Renouveler</button>' : ''}
    <button type="button" class="danger" data-action="archiver-contrat">Archiver</button></div>` : '';
  const echeances = contrat.echeances.map((ligne) => `<tr><td>${formaterDate(ligne.date_echeance)}</td>
    <td>${echapper(libelleCode(ligne.type_echeance))}${ligne.numero_terme ? ` ${echapper(ligne.numero_terme)}` : ''}</td>
    <td>${formaterMontant(ligne.montant_prime)}</td><td>${formaterMontant(ligne.montant_regle)}</td>
    <td>${echapper(libelleCode(ligne.statut))}</td></tr>`).join('');
  const paiements = contrat.paiements.map((ligne) => `<tr><td>${formaterDate(ligne.date_paiement)}</td>
    <td>${formaterMontant(ligne.montant)}</td><td>${echapper(libelleCode(ligne.mode_paiement))}</td>
    <td>${echapper(ligne.reference || '—')}</td></tr>`).join('');
  const historique = contrat.historique.map((ligne) => `<div class="entree-historique">
    <span class="date">${formaterDate(ligne.cree_le, true)}</span><span>${echapper(libelleCode(ligne.action))}</span></div>`).join('');
  const piecesJointes = (contrat.piecesJointes || []).map((piece) => `<li class="piece-jointe">
    <div><a href="/api/contrats/${echapper(contrat.id)}/pieces-jointes/${echapper(piece.id)}/telecharger">${echapper(piece.nom_original)}</a>
    <span>${echapper((Number(piece.taille_octets) / 1024 / 1024).toFixed(2))} Mo · ${formaterDate(piece.ajoute_le, true)}</span></div>
    ${peutEcrire() ? `<button type="button" class="danger" data-action="supprimer-piece-jointe" data-id="${echapper(piece.id)}">Supprimer</button>` : ''}
  </li>`).join('');
  const ajoutPieceJointe = peutEcrire() ? `<div class="ajout-piece-jointe">
    <input type="file" id="piece-jointe-fichier" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" />
    <button type="button" class="principal" data-action="televerser-piece-jointe">Ajouter</button>
  </div>` : '';
  $('#contenu-fiche-contrat').innerHTML = `<div class="fiche-entete"><div><h2>${echapper(contrat.numero_contrat)}</h2>
    <p>${echapper(contrat.client_nom)} — ${echapper(contrat.compagnie_nom)} — ${echapper(contrat.produit_nom)}</p></div>${actions}</div>
    <div class="carte fiche-cumuls"><div>Assuré<div class="valeur">${echapper(contrat.client_nom)}</div></div>
    <div>Souscripteur<div class="valeur">${echapper(contrat.souscripteur_nom || contrat.client_nom)}</div></div>
    <div>Société de leasing<div class="valeur">${echapper(contrat.societe_leasing_nom || 'Aucune')}</div></div>
    <div>Payeur<div class="valeur">${echapper(contrat.payeur_nom || contrat.souscripteur_nom || contrat.client_nom)}</div></div></div>
    <div class="carte fiche-cumuls"><div>Prime totale<div class="valeur">${formaterMontant(contrat.prime_totale)}</div></div>
    <div>Période<div class="valeur">${formaterDate(contrat.date_effet)} – ${formaterDate(contrat.date_fin)}</div></div>
    <div>Statut<div class="valeur">${echapper(libelleCode(contrat.statut))}</div></div></div>
    <div class="carte"><div class="entete-section"><h3>Pièces jointes du contrat</h3>${ajoutPieceJointe}</div>
    ${piecesJointes ? `<ul class="liste-pieces-jointes">${piecesJointes}</ul>` : '<p class="etat-vide">Aucune pièce jointe.</p>'}</div>
    <div class="carte"><h3>Échéancier</h3><table><thead><tr><th>Date</th><th>Type</th><th>Montant</th><th>Réglé</th><th>Statut</th></tr></thead><tbody>${echeances}</tbody></table></div>
    <div class="carte"><h3>Paiements</h3>${paiements ? `<table><thead><tr><th>Date</th><th>Montant</th><th>Mode</th><th>Référence</th></tr></thead><tbody>${paiements}</tbody></table>` : '<p class="etat-vide">Aucun paiement.</p>'}</div>
    <div class="carte"><h3>Historique</h3><div class="frise-historique">${historique || '<p class="etat-vide">Aucun historique.</p>'}</div></div>`;
  await changerVue('fiche-contrat');
}

async function chargerClients() {
  const resultat = await api(`/api/clients?${parametres({
    recherche: $('#filtre-recherche-client').value.trim(), page: etat.pages.clients, limite: 50,
  })}`);
  const lignes = resultat.donnees;
  $('#corps-tableau-clients').innerHTML = lignes.map((ligne) => `<tr data-client-id="${echapper(ligne.id)}">
    <td>${echapper(ligne.nom)}</td><td>${echapper(libelleCode(ligne.type_client))}</td>
    <td>${echapper(ligne.cin_ou_matricule || '—')}</td><td>${echapper(ligne.telephone || '—')}</td>
    <td>${echapper(ligne.code_client_finasure || '—')}</td>
    <td><div class="actions-ligne"${peutEcrire() ? '' : ' hidden'}>
      <button type="button" data-action="modifier-client" data-id="${echapper(ligne.id)}">Modifier</button>
      <button type="button" class="danger" data-action="archiver-client" data-id="${echapper(ligne.id)}">Supprimer</button>
    </div></td></tr>`).join('');
  $('#etat-vide-clients').hidden = lignes.length > 0;
  afficherPagination('clients', resultat.pagination);
}

async function ouvrirFicheClient(id) {
  const client = await api(`/api/clients/${id}`);
  etat.clientId = client.id;
  const actions = peutEcrire() ? `<div class="actions-ligne"><button type="button" data-action="modifier-client">Modifier</button>
    <button type="button" class="danger" data-action="archiver-client">Supprimer</button></div>` : '';
  const contrats = client.contrats.map((ligne) => `<tr data-contrat-id="${echapper(ligne.id)}"><td>${echapper(ligne.numero_contrat)}</td>
    <td>${echapper(ligne.compagnie_nom)}</td><td>${echapper(ligne.produit_nom)}</td><td>${formaterDate(ligne.date_effet)}</td>
    <td>${formaterMontant(ligne.prime_totale)}</td><td>${echapper(libelleCode(ligne.statut))}</td>
    <td>${Number(ligne.nombre_pieces) || 0}</td></tr>`).join('');
  $('#contenu-fiche-client').innerHTML = `<div class="fiche-entete"><div><h2>${echapper(client.nom)}</h2>
    <p>${echapper(libelleCode(client.type_client))} — ${echapper(client.cin_ou_matricule || 'Identifiant non renseigné')}</p></div>${actions}</div>
    <div class="carte fiche-cumuls"><div>Cumul des primes<div class="valeur">${formaterMontant(client.cumulPrimes)}</div></div>
    <div>Téléphone<div class="valeur">${client.telephone ? `<a href="tel:${echapper(client.telephone)}">${echapper(client.telephone)}</a>` : '—'}</div></div>
    <div>Date de naissance<div class="valeur">${formaterDate(client.date_naissance)}</div></div>
    <div>Code Finasure<div class="valeur">${echapper(client.code_client_finasure || '—')}</div></div></div>
    <div class="carte"><h3>Contrats</h3>${contrats ? `<table><thead><tr><th>N° contrat</th><th>Compagnie</th><th>Produit</th><th>Effet</th><th>Prime</th><th>Statut</th><th>Documents</th></tr></thead><tbody>${contrats}</tbody></table>` : '<p class="etat-vide">Aucun contrat.</p>'}</div>`;
  await changerVue('fiche-client');
}

async function chargerReferentiel() {
  await chargerReferentiels(true);
  $('#corps-tableau-compagnies').innerHTML = etat.compagnies.map((ligne) => `<tr><td>${echapper(ligne.code)}</td><td>${echapper(ligne.nom)}</td>
    <td><div class="actions-ligne"${peutEcrire() ? '' : ' hidden'}><button data-action="modifier-compagnie" data-id="${ligne.id}">Modifier</button>
    <button class="danger" data-action="archiver-compagnie" data-id="${ligne.id}">Archiver</button></div></td></tr>`).join('');
  $('#corps-tableau-produits').innerHTML = etat.produits.map((ligne) => `<tr><td>${echapper(ligne.branche)}</td><td>${echapper(ligne.nom)}</td>
    <td><div class="actions-ligne"${peutEcrire() ? '' : ' hidden'}><button data-action="modifier-produit" data-id="${ligne.id}">Modifier</button>
    <button class="danger" data-action="archiver-produit" data-id="${ligne.id}">Archiver</button></div></td></tr>`).join('');
}

async function chargerCorbeille() {
  const lignes = await api('/api/corbeille');
  $('#corps-tableau-corbeille').innerHTML = lignes.map((ligne) => `<tr><td>${echapper(ligne.table_source)}</td>
    <td>${echapper(ligne.libelle)}</td><td>${formaterDate(ligne.supprime_le, true)}</td>
    <td><div class="actions-ligne">
      <button type="button" data-action="restaurer" data-table="${echapper(ligne.table_source)}" data-id="${ligne.id}">Restaurer</button>
      <button type="button" class="danger" data-action="supprimer-definitivement" data-table="${echapper(ligne.table_source)}" data-id="${ligne.id}">Supprimer définitivement</button>
    </div></td></tr>`).join('');
  $('#etat-vide-corbeille').hidden = lignes.length > 0;
}

function ouvrirModaleClient(client = null) {
  etat.edition.client = client?.id || null;
  $('#formulaire-client').reset();
  $('#titre-modale-client').textContent = client ? 'Modifier le client' : 'Nouveau client';
  $('#description-modale-client').textContent = client
    ? `Mettez à jour les informations de ${client.nom}.`
    : 'Renseignez les informations du client.';
  $('#bouton-enregistrer-client').textContent = client ? 'Enregistrer les modifications' : 'Créer le client';
  $('#client-nom').value = client?.nom || '';
  $('#client-type').value = client?.type_client || 'personne_physique';
  $('#client-cin').value = client?.cin_ou_matricule || '';
  $('#client-telephone').value = client?.telephone || '';
  $('#client-code-finasure').value = client?.code_client_finasure || '';
  $('#client-date-naissance').value = client?.date_naissance?.slice(0, 10) || '';
  $('#client-date-naissance').max = new Date().toISOString().slice(0, 10);
  $('#zone-client-date-naissance').hidden = $('#client-type').value !== 'personne_physique';
  $('#modale-client').showModal();
}

async function ouvrirModaleContrat(contrat = null) {
  await Promise.all([chargerReferentiels(), chargerClientsPourSelect()]);
  etat.edition.contrat = contrat?.id || null;
  $('#titre-modale-contrat').textContent = contrat ? 'Modifier le contrat' : 'Nouveau contrat';
  const champs = {
    '#contrat-client': contrat?.client_id, '#contrat-souscripteur': contrat?.souscripteur_id || contrat?.client_id,
    '#contrat-societe-leasing': contrat?.societe_leasing || contrat?.societe_leasing_nom,
    '#contrat-payeur': contrat?.payeur_id,
    '#contrat-numero': contrat?.numero_contrat,
    '#contrat-compagnie': contrat?.compagnie_id, '#contrat-produit': contrat?.produit_id,
    '#contrat-immatriculation': contrat?.immatriculation,
    '#contrat-date-effet': contrat?.date_effet?.slice(0, 10), '#contrat-duree': contrat?.duree_mois || 12,
    '#contrat-fractionnement': contrat?.fractionnement || 'annuel', '#contrat-date-fin': contrat?.date_fin?.slice(0, 10),
    '#contrat-date-echeance': contrat?.date_echeance?.slice(0, 10),
    '#contrat-prime': contrat?.prime_totale,
  };
  Object.entries(champs).forEach(([selecteur, valeur]) => { $(selecteur).value = valeur ?? ''; });
  if (!contrat) $('#contrat-souscripteur').value = $('#contrat-client').value;
  actualiserDatesContrat();
  $('#modale-contrat').showModal();
}

function ouvrirModaleCompagnie(compagnie = null) {
  etat.edition.compagnie = compagnie?.id || null;
  $('#titre-modale-compagnie').textContent = compagnie ? 'Modifier la compagnie' : 'Nouvelle compagnie';
  $('#compagnie-code').value = compagnie?.code || '';
  $('#compagnie-nom').value = compagnie?.nom || '';
  $('#modale-compagnie').showModal();
}

function ouvrirModaleProduit(produit = null) {
  etat.edition.produit = produit?.id || null;
  $('#titre-modale-produit').textContent = produit ? 'Modifier le produit' : 'Nouveau produit';
  $('#produit-nom').value = produit?.nom || '';
  $('#produit-branche').value = produit?.branche || 'AUTO';
  $('#modale-produit').showModal();
}

async function soumettre(formulaire, action) {
  const dialogue = formulaire.closest('dialog');
  const bouton = $(`[form="${formulaire.id}"][type="submit"]`);
  effacerErreurs(dialogue);
  bouton.disabled = true;
  try { await action(); } catch (e) { afficherErreur(e.message, dialogue); } finally { bouton.disabled = false; }
}

async function actionDeleguee(event) {
  const bouton = event.target.closest('[data-action]');
  const ligneContrat = event.target.closest('tr[data-contrat-id]');
  const ligneClient = event.target.closest('tr[data-client-id]');
  if (!bouton) {
    if (ligneContrat) await ouvrirFicheContrat(ligneContrat.dataset.contratId);
    else if (ligneClient) await ouvrirFicheClient(ligneClient.dataset.clientId);
    return;
  }
  event.stopPropagation();
  const { action, id } = bouton.dataset;
  try {
    if (action === 'encaisser') {
      etat.echeanceId = id;
      $('#encaissement-montant').value = Number(bouton.dataset.solde).toFixed(3);
      $('#encaissement-date').value = new Date().toISOString().slice(0, 10);
      $('#encaissement-reference').value = '';
      $('#modale-encaissement').showModal();
    } else if (action === 'relancer') {
      etat.echeanceId = id;
      $('#formulaire-relance').reset();
      $('#modale-relance').showModal();
    } else if (action === 'modifier-contrat') {
      await ouvrirModaleContrat(await api(`/api/contrats/${etat.contratId}`));
    } else if (action === 'renouveler-contrat' && window.confirm('Renouveler ce contrat sur la période suivante ?')) {
      const nouveau = await api(`/api/contrats/${etat.contratId}/renouveler`, { method: 'POST' });
      await ouvrirFicheContrat(nouveau.id);
    } else if (action === 'archiver-contrat' && window.confirm('Archiver ce contrat ?')) {
      await api(`/api/contrats/${etat.contratId}`, { method: 'DELETE' });
      await changerVue('contrats');
    } else if (action === 'ouvrir-contrat') {
      await ouvrirFicheContrat(id);
    } else if (action === 'televerser-piece-jointe') {
      const fichier = $('#piece-jointe-fichier')?.files[0];
      if (!fichier) throw new Error('Sélectionnez un fichier PDF, JPG ou PNG.');
      const formulaire = new FormData();
      formulaire.append('fichier', fichier);
      bouton.disabled = true;
      try {
        await api(`/api/contrats/${etat.contratId}/pieces-jointes`, { method: 'POST', body: formulaire });
        await ouvrirFicheContrat(etat.contratId);
      } finally {
        bouton.disabled = false;
      }
    } else if (action === 'supprimer-piece-jointe' && window.confirm('Supprimer définitivement cette pièce jointe ?')) {
      await api(`/api/contrats/${etat.contratId}/pieces-jointes/${id}`, { method: 'DELETE' });
      await ouvrirFicheContrat(etat.contratId);
    } else if (action === 'changer-page') {
      const cible = bouton.dataset.cible;
      etat.pages[cible] = Number(bouton.dataset.page);
      if (cible === 'echeances') await chargerEcheances();
      else if (cible === 'contrats') await chargerContrats();
      else if (cible === 'clients') await chargerClients();
    } else if (action === 'modifier-client') {
      const clientId = id || etat.clientId;
      ouvrirModaleClient(await api(`/api/clients/${clientId}`));
    } else if (action === 'archiver-client' && window.confirm('Supprimer ce client ? Il sera placé dans la corbeille.')) {
      const clientId = id || etat.clientId;
      await api(`/api/clients/${clientId}`, { method: 'DELETE' });
      etat.clients = [];
      await changerVue('clients');
    } else if (action === 'modifier-compagnie') {
      ouvrirModaleCompagnie(etat.compagnies.find((x) => String(x.id) === id));
    } else if (action === 'archiver-compagnie' && window.confirm('Archiver cette compagnie ?')) {
      await api(`/api/compagnies/${id}`, { method: 'DELETE' });
      await chargerReferentiel();
    } else if (action === 'modifier-produit') {
      ouvrirModaleProduit(etat.produits.find((x) => String(x.id) === id));
    } else if (action === 'archiver-produit' && window.confirm('Archiver ce produit ?')) {
      await api(`/api/produits/${id}`, { method: 'DELETE' });
      await chargerReferentiel();
    } else if (action === 'restaurer') {
      await api(`/api/${bouton.dataset.table}/${id}/restaurer`, { method: 'POST' });
      etat.compagnies = []; etat.produits = []; etat.clients = [];
      await chargerCorbeille();
    } else if (action === 'supprimer-definitivement'
      && window.confirm('Supprimer définitivement cet élément ? Cette action est irréversible.')) {
      await api(`/api/corbeille/${bouton.dataset.table}/${id}`, { method: 'DELETE' });
      etat.compagnies = []; etat.produits = []; etat.clients = [];
      await chargerCorbeille();
    }
  } catch (e) {
    afficherErreur(e.message);
  }
}

function brancherFormulaires() {
  $('#formulaire-client').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      const id = etat.edition.client;
      const corps = {
        typeClient: $('#client-type').value, nom: $('#client-nom').value.trim(),
        cinOuMatricule: $('#client-cin').value.trim(), telephone: $('#client-telephone').value.trim(),
        codeClientFinasure: $('#client-code-finasure').value.trim(),
        dateNaissance: $('#client-date-naissance').value || null,
      };
      await api(id ? `/api/clients/${id}` : '/api/clients', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(corps),
      });
      $('#modale-client').close(); etat.clients = [];
      if (id && etat.vue === 'fiche-client') await ouvrirFicheClient(id); else await changerVue('clients');
    });
  });

  $('#formulaire-contrat').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      const id = etat.edition.contrat;
      const corps = {
        numeroContrat: $('#contrat-numero').value.trim(), clientId: $('#contrat-client').value,
        souscripteurId: $('#contrat-souscripteur').value,
        societeLeasing: $('#contrat-societe-leasing').value.trim() || null,
        payeurId: $('#contrat-payeur').value || null,
        compagnieId: $('#contrat-compagnie').value, produitId: $('#contrat-produit').value,
        immatriculation: $('#contrat-immatriculation').value.trim(),
        dateEffet: $('#contrat-date-effet').value, dureeMois: Number($('#contrat-duree').value),
        fractionnement: $('#contrat-fractionnement').value, dateFin: $('#contrat-date-fin').value,
        primeTotale: Number($('#contrat-prime').value),
      };
      const contrat = await api(id ? `/api/contrats/${id}` : '/api/contrats', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify(corps),
      });
      $('#modale-contrat').close();
      await ouvrirFicheContrat(contrat.id);
    });
  });

  $('#formulaire-encaissement').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      await api(`/api/echeances/${etat.echeanceId}/paiements`, {
        method: 'POST', body: JSON.stringify({
          montant: Number($('#encaissement-montant').value), modePaiement: $('#encaissement-mode').value,
          reference: $('#encaissement-reference').value.trim(), datePaiement: $('#encaissement-date').value || null,
        }),
      });
      $('#modale-encaissement').close();
      await chargerEcheances();
    });
  });

  $('#formulaire-relance').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      await api(`/api/echeances/${etat.echeanceId}/relances`, {
        method: 'POST', body: JSON.stringify({
          typeRelance: $('#relance-type').value, note: $('#relance-note').value.trim(),
        }),
      });
      $('#modale-relance').close();
    });
  });

  $('#formulaire-compagnie').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      const id = etat.edition.compagnie;
      await api(id ? `/api/compagnies/${id}` : '/api/compagnies', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify({
          code: $('#compagnie-code').value.trim(), nom: $('#compagnie-nom').value.trim(),
        }),
      });
      $('#modale-compagnie').close(); await chargerReferentiel();
    });
  });

  $('#formulaire-produit').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      const id = etat.edition.produit;
      await api(id ? `/api/produits/${id}` : '/api/produits', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify({
          nom: $('#produit-nom').value.trim(), branche: $('#produit-branche').value,
        }),
      });
      $('#modale-produit').close(); await chargerReferentiel();
    });
  });
}

function brancherEvenements() {
  $('#formulaire-connexion').addEventListener('submit', async (event) => {
    event.preventDefault(); effacerErreurs($('#vue-connexion'));
    try {
      etat.utilisateur = await api('/api/auth/connexion', {
        method: 'POST', body: JSON.stringify({
          email: $('#connexion-email').value, motDePasse: $('#connexion-mot-de-passe').value,
        }),
      });
      $('#vue-connexion').hidden = true; $('#app').hidden = false;
      $('#nom-utilisateur').textContent = etat.utilisateur.nom;
      appliquerDroits(); await changerVue('tableau-de-bord');
    } catch (e) { afficherErreur(e.message, $('#vue-connexion')); }
  });
  $('#bouton-deconnexion').addEventListener('click', async () => {
    try { await api('/api/auth/deconnexion', { method: 'POST' }); } finally { afficherConnexion(); }
  });
  document.addEventListener('click', actionDeleguee);
  $$('[data-vue]').forEach((bouton) => bouton.addEventListener('click', () => changerVue(bouton.dataset.vue)));
  $$('[data-fermer-modale]').forEach((bouton) => bouton.addEventListener('click', () => bouton.closest('dialog').close()));
  $$('dialog').forEach((dialogue) => dialogue.addEventListener('click', (event) => {
    if (event.target === dialogue) dialogue.close();
  }));
  ['#filtre-fenetre', '#filtre-niveau', '#filtre-type-echeance', '#filtre-compagnie-echeance']
    .forEach((id) => $(id).addEventListener('change', () => {
      etat.pages.echeances = 1;
      chargerEcheances().catch((e) => afficherErreur(e.message));
    }));
  $('#filtre-recherche-echeance').addEventListener('input', debounce(() => {
    etat.pages.echeances = 1;
    chargerEcheances().catch((e) => afficherErreur(e.message));
  }));
  ['#filtre-statut-contrat', '#filtre-compagnie-contrat', '#filtre-produit-contrat', '#filtre-tri-contrat']
    .forEach((id) => $(id).addEventListener('change', () => {
      etat.pages.contrats = 1;
      chargerContrats().catch((e) => afficherErreur(e.message));
    }));
  $('#filtre-recherche-contrat').addEventListener('input', debounce(() => {
    etat.pages.contrats = 1;
    chargerContrats().catch((e) => afficherErreur(e.message));
  }));
  $('#filtre-recherche-client').addEventListener('input', debounce(() => {
    etat.pages.clients = 1;
    chargerClients().catch((e) => afficherErreur(e.message));
  }));
  $('#bouton-nouveau-client').addEventListener('click', () => ouvrirModaleClient());
  $('#bouton-nouveau-contrat').addEventListener('click', () => ouvrirModaleContrat().catch((e) => afficherErreur(e.message)));
  $('#bouton-nouvelle-compagnie').addEventListener('click', () => ouvrirModaleCompagnie());
  $('#bouton-nouveau-produit').addEventListener('click', () => ouvrirModaleProduit());
  $('#client-type').addEventListener('change', () => {
    const physique = $('#client-type').value === 'personne_physique';
    $('#zone-client-date-naissance').hidden = !physique;
    if (!physique) $('#client-date-naissance').value = '';
  });
  $('#contrat-date-effet').addEventListener('change', actualiserDatesContrat);
  $('#contrat-duree').addEventListener('input', actualiserDatesContrat);
  $('#contrat-fractionnement').addEventListener('change', actualiserDatesContrat);
  $('#contrat-client').addEventListener('change', () => {
    if (!etat.edition.contrat) $('#contrat-souscripteur').value = $('#contrat-client').value;
  });
  brancherFormulaires();
}

async function initialiser() {
  brancherEvenements();
  try {
    etat.utilisateur = await api('/api/auth/moi');
    $('#nom-utilisateur').textContent = etat.utilisateur.nom;
    $('#vue-connexion').hidden = true; $('#app').hidden = false;
    appliquerDroits(); await changerVue('tableau-de-bord');
  } catch (_) {
    if (!etat.utilisateur) afficherConnexion();
  }
}

initialiser();
