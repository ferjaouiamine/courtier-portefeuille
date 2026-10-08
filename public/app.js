'use strict';

const etat = {
  utilisateur: null,
  vue: 'tableau-de-bord',
  compagnies: [],
  produits: [],
  clients: [],
  contratId: null,
  contratCourant: null,
  clientId: null,
  echeanceId: null,
  remarqueContrat: '',
  paiementsContrat: [],
  echeancesContrat: [],
  echeanciersCompletes: false,
  edition: {},
  utilisateurs: [],
  paiementsComptabilite: [],
  comptabilite: null,
  moisComptabilite: null,
  pages: { echeances: 1, contrats: 1, clients: 1, journal: 1, comptabilite: 1 },
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

function formaterMontantAligne(valeur) {
  const parties = new Intl.NumberFormat('fr-TN', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).formatToParts(Number(valeur) || 0);
  const entier = parties
    .filter((partie) => partie.type === 'integer' || partie.type === 'group')
    .map((partie) => partie.value.replace(/\u202f/g, ' ')).join('');
  const separateur = parties.find((partie) => partie.type === 'decimal')?.value || ',';
  const decimales = parties.find((partie) => partie.type === 'fraction')?.value || '000';
  return `<span class="montant-aligne"><span>${echapper(entier)}</span><span>${echapper(separateur)}</span><span>${echapper(decimales)}</span></span>`;
}

function typeDureeContrat(contrat) {
  return contrat?.type_duree || (contrat?.fractionnement === 'prime_unique' ? 'ferme' : 'rtr');
}

function libelleTypeDuree(contrat) {
  return typeDureeContrat(contrat) === 'ferme' ? 'DF' : 'RTR';
}

function typeDureeAvecInfobulle(contrat) {
  const ferme = typeDureeContrat(contrat) === 'ferme';
  return `<span class="abreviation-duree" title="${ferme ? 'Durée ferme' : 'Renouvelable par tacite reconduction'}">${ferme ? 'DF' : 'RTR'}</span>`;
}

function etiquetteFeuilleCaisse(disponible) {
  const classe = disponible ? 'oui' : 'non';
  return `<span class="etiquette-feuille-caisse ${classe}">${disponible ? 'Oui' : 'Non'}</span>`;
}

function controleRetourFeuilleCaisse(ligne) {
  const id = echapper(ligne.id);
  const desactive = peutEcrire() ? '' : ' disabled';
  return `<label class="controle-retour-feuille" title="Feuille de caisse retournée">
    <input type="checkbox" data-retour-feuille-id="${id}" aria-label="Feuille de caisse retournée"${ligne.retour_feuille_caisse ? ' checked' : ''}${desactive} />
  </label>`;
}

function libelleStatutEcheance(statut) {
  return {
    a_venir: 'À venir',
    partielle: 'Partielle',
    payee: 'Payée',
    impayee: 'Impayée',
  }[statut] || libelleCode(statut);
}

function etiquetteStatutEcheance(statut) {
  return `<span class="etiquette-statut-echeance ${echapper(statut)}">${echapper(libelleStatutEcheance(statut))}</span>`;
}

const ACTIONS_AUDIT = {
  creation: 'Ajout',
  modification: 'Modification',
  suppression: 'Archivage',
  restauration: 'Restauration',
  suppression_definitive: 'Suppression définitive',
  connexion: 'Connexion',
};

const TYPES_AUDIT = {
  utilisateurs: 'Utilisateur',
  compagnies: 'Compagnie',
  produits: 'Produit',
  clients: 'Client',
  contrats: 'Contrat',
  echeances: 'Échéance',
  avenants_contrats: 'Avenant',
  paiements: 'Encaissement',
  relances: 'Relance',
  pieces_jointes_contrats: 'Pièce jointe',
};

function formaterValeurAudit(valeur) {
  if (valeur === null || valeur === undefined || valeur === '') return 'Non renseigné';
  if (typeof valeur === 'boolean') return valeur ? 'Oui' : 'Non';
  if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(valeur))) return formaterDate(valeur);
  return libelleCode(valeur);
}

function detailsAudit(ligne) {
  const modifications = ligne.modifications || [];
  if (!modifications.length) return '<span class="texte-secondaire">—</span>';
  const visibles = modifications.slice(0, 4).map((modification) => {
    const valeur = ligne.action === 'creation'
      ? formaterValeurAudit(modification.apres)
      : `${formaterValeurAudit(modification.avant)} → ${formaterValeurAudit(modification.apres)}`;
    return `<span><strong>${echapper(modification.champ)} :</strong> ${echapper(valeur)}</span>`;
  }).join('');
  const supplement = modifications.length > 4
    ? `<span class="texte-secondaire">+ ${modifications.length - 4} autre(s) champ(s)</span>`
    : '';
  return `<span class="details-audit">${visibles}${supplement}</span>`;
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

function actualiserContrainteDateFin() {
  const dateFin = $('#contrat-date-fin');
  const valeur = $('#contrat-date-effet').value;
  if (!valeur) {
    dateFin.removeAttribute('min');
    return;
  }
  const dateMinimum = new Date(`${valeur}T00:00:00Z`);
  dateMinimum.setUTCDate(dateMinimum.getUTCDate() + 1);
  dateFin.min = dateMinimum.toISOString().slice(0, 10);
}

function appliquerReglesDureeContrat() {
  const dureeFerme = $('#contrat-type-duree').value === 'ferme';
  const fractionnement = $('#contrat-fractionnement');
  const dateFin = $('#contrat-date-fin');
  if (dureeFerme) fractionnement.value = 'prime_unique';
  else if (fractionnement.value === 'prime_unique') fractionnement.value = 'annuel';
  $('#zone-contrat-fractionnement').hidden = dureeFerme;
  $('#zone-contrat-date-echeance').hidden = dureeFerme;
  $('#zone-contrat-date-fin').hidden = false;
  dateFin.required = true;
  actualiserContrainteDateFin();
  synchroniserSelectRecherchable(fractionnement);
  calculerDateEcheance();
}

function appliquerReglesFeuilleCaisseEncaissement() {
  const disponible = $('#encaissement-feuille-caisse-oui').checked;
  const commission = $('#encaissement-commission-nette');
  const dateFeuille = $('#encaissement-date-feuille');
  $('#zone-encaissement-commission-nette').hidden = !disponible;
  $('#zone-encaissement-date-feuille').hidden = !disponible;
  commission.disabled = !disponible;
  commission.required = disponible;
  dateFeuille.disabled = !disponible;
  dateFeuille.required = disponible;
  if (!disponible) {
    commission.value = '';
    dateFeuille.value = '';
  } else if (!dateFeuille.value) {
    dateFeuille.value = $('#encaissement-date').value || new Date().toISOString().slice(0, 10);
  }
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

const composantsSelect = new WeakMap();
let composantSelectOuvert = null;

function normaliserRechercheSelect(valeur) {
  return String(valeur || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr');
}

function libelleDuSelect(select) {
  const option = select.options[select.selectedIndex];
  return option ? option.textContent.trim() : '';
}

function rendreSelectRecherchable(select) {
  if (composantsSelect.has(select)) return;

  const conteneur = document.createElement('div');
  conteneur.className = 'select-recherchable';

  const saisie = document.createElement('input');
  saisie.type = 'text';
  saisie.className = 'select-recherche-saisie';
  saisie.autocomplete = 'off';
  saisie.spellcheck = false;
  saisie.setAttribute('role', 'combobox');
  saisie.setAttribute('aria-autocomplete', 'list');
  saisie.setAttribute('aria-expanded', 'false');

  const liste = document.createElement('div');
  liste.className = 'select-recherche-options';
  liste.id = `liste-${select.id || Math.random().toString(36).slice(2)}`;
  liste.setAttribute('role', 'listbox');
  liste.setAttribute('popover', 'manual');
  liste.hidden = true;
  saisie.setAttribute('aria-controls', liste.id);

  const label = select.closest('label');
  const texteLabel = label
    ? [...label.childNodes].find((noeud) => noeud.nodeType === Node.TEXT_NODE)?.textContent.trim()
    : '';
  saisie.setAttribute('aria-label', `${texteLabel || 'Liste'} : rechercher une option`);

  select.parentNode.insertBefore(conteneur, select);
  conteneur.append(saisie, select);
  // Un element hors d'un dialog modal devient inerte et ne recoit plus les clics.
  (select.closest('dialog') || document.body).append(liste);
  select.classList.add('select-recherche-source');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const composant = {
    select, conteneur, saisie, liste, optionsVisibles: [], indexActif: -1, ouvert: false,
  };
  composantsSelect.set(select, composant);

  function positionnerListe() {
    if (!composant.ouvert) return;
    const rectangle = saisie.getBoundingClientRect();
    const marge = 8;
    liste.style.width = `${rectangle.width}px`;
    liste.style.maxHeight = `${Math.min(260, window.innerHeight - 2 * marge)}px`;
    const hauteur = Math.min(liste.scrollHeight, 260);
    const placeDessous = window.innerHeight - rectangle.bottom - marge;
    const placeDessus = rectangle.top - marge;
    const ouvrirDessus = placeDessous < Math.min(hauteur, 180) && placeDessus > placeDessous;
    const haut = ouvrirDessus
      ? Math.max(marge, rectangle.top - hauteur - 4)
      : Math.min(window.innerHeight - hauteur - marge, rectangle.bottom + 4);
    liste.style.left = `${Math.max(marge, Math.min(rectangle.left, window.innerWidth - rectangle.width - marge))}px`;
    liste.style.top = `${Math.max(marge, haut)}px`;
  }
  composant.positionnerListe = positionnerListe;

  function definirOptionActive(index) {
    if (!composant.optionsVisibles.length) {
      composant.indexActif = -1;
      saisie.removeAttribute('aria-activedescendant');
      return;
    }
    composant.indexActif = Math.max(0, Math.min(index, composant.optionsVisibles.length - 1));
    $$('.select-recherche-option', liste).forEach((element, numero) => {
      const actif = numero === composant.indexActif;
      element.classList.toggle('actif', actif);
      if (actif) {
        saisie.setAttribute('aria-activedescendant', element.id);
        element.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function choisirOption(option) {
    if (!option) return;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    fermerSelectRecherchable(composant);
  }

  function afficherOptions(recherche = '') {
    const terme = normaliserRechercheSelect(recherche.trim());
    composant.optionsVisibles = [...select.options].filter((option) => (
      !option.disabled && normaliserRechercheSelect(option.textContent).includes(terme)
    ));
    liste.replaceChildren();

    if (!composant.optionsVisibles.length) {
      const vide = document.createElement('p');
      vide.className = 'select-recherche-vide';
      vide.textContent = 'Aucun résultat';
      liste.append(vide);
      definirOptionActive(-1);
      positionnerListe();
      return;
    }

    composant.optionsVisibles.forEach((option, index) => {
      const bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'select-recherche-option';
      bouton.id = `${liste.id}-option-${index}`;
      bouton.setAttribute('role', 'option');
      bouton.setAttribute('aria-selected', String(option.value === select.value));
      bouton.dataset.value = option.value;
      bouton.textContent = option.textContent.trim();
      bouton.addEventListener('mouseenter', () => definirOptionActive(index));
      bouton.addEventListener('click', () => choisirOption(option));
      liste.append(bouton);
    });

    const indexSelectionne = composant.optionsVisibles.findIndex((option) => option.value === select.value);
    definirOptionActive(indexSelectionne >= 0 ? indexSelectionne : 0);
    positionnerListe();
  }

  function ouvrirSelectRecherchable(reinitialiserRecherche = true) {
    if (composant.ouvert || select.disabled) return;
    if (composantSelectOuvert) fermerSelectRecherchable(composantSelectOuvert);
    composantSelectOuvert = composant;
    composant.ouvert = true;
    if (reinitialiserRecherche) saisie.value = '';
    saisie.setAttribute('aria-expanded', 'true');
    liste.hidden = false;
    if (typeof liste.showPopover === 'function') {
      try { liste.showPopover(); } catch (_) { /* navigateur sans prise en charge complète */ }
    }
    afficherOptions(saisie.value);
  }

  saisie.addEventListener('focus', ouvrirSelectRecherchable);
  saisie.addEventListener('click', ouvrirSelectRecherchable);
  saisie.addEventListener('input', () => {
    if (!composant.ouvert) ouvrirSelectRecherchable(false);
    afficherOptions(saisie.value);
  });
  saisie.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!composant.ouvert) ouvrirSelectRecherchable();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      definirOptionActive(composant.indexActif + direction);
    } else if (event.key === 'Enter' && composant.ouvert) {
      event.preventDefault();
      choisirOption(composant.optionsVisibles[composant.indexActif]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      fermerSelectRecherchable(composant);
    } else if (event.key === 'Tab') {
      fermerSelectRecherchable(composant);
    }
  });

  select.addEventListener('change', () => synchroniserSelectRecherchable(select));
  new MutationObserver(() => synchroniserSelectRecherchable(select)).observe(select, {
    childList: true, subtree: true, attributes: true,
  });
  if (select.form) {
    select.form.addEventListener('reset', () => setTimeout(() => synchroniserSelectRecherchable(select)));
  }
  synchroniserSelectRecherchable(select);
}

function fermerSelectRecherchable(composant = composantSelectOuvert) {
  if (!composant?.ouvert) return;
  composant.ouvert = false;
  composant.saisie.value = libelleDuSelect(composant.select);
  composant.saisie.setAttribute('aria-expanded', 'false');
  composant.saisie.removeAttribute('aria-activedescendant');
  if (typeof composant.liste.hidePopover === 'function') {
    try { composant.liste.hidePopover(); } catch (_) { /* déjà fermé */ }
  }
  composant.liste.hidden = true;
  if (composantSelectOuvert === composant) composantSelectOuvert = null;
}

function synchroniserSelectRecherchable(select) {
  const composant = composantsSelect.get(select);
  if (!composant) return;
  composant.saisie.disabled = select.disabled;
  if (!composant.ouvert) composant.saisie.value = libelleDuSelect(select);
  else {
    const optionSelectionnee = $('.select-recherche-option[aria-selected="true"]', composant.liste);
    if (optionSelectionnee) optionSelectionnee.setAttribute('aria-selected', 'false');
    const nouvelle = $$('.select-recherche-option', composant.liste)
      .find((option) => option.dataset.value === select.value);
    if (nouvelle) nouvelle.setAttribute('aria-selected', 'true');
  }
}

function synchroniserTousLesSelects() {
  $$('select').forEach((select) => synchroniserSelectRecherchable(select));
}

function initialiserSelectsRecherchables() {
  $$('select').forEach(rendreSelectRecherchable);
  document.addEventListener('click', (event) => {
    if (!composantSelectOuvert) return;
    const { conteneur, liste } = composantSelectOuvert;
    if (!conteneur.contains(event.target) && !liste.contains(event.target)) {
      fermerSelectRecherchable(composantSelectOuvert);
    }
  });
  window.addEventListener('resize', () => {
    composantSelectOuvert?.positionnerListe();
  });
  document.addEventListener('scroll', (event) => {
    if (composantSelectOuvert && !composantSelectOuvert.liste.contains(event.target)) {
      composantSelectOuvert.positionnerListe();
    }
  }, true);
}

function peutEcrire() {
  return etat.utilisateur?.role !== 'lecture';
}

function voitHistorique() {
  return etat.utilisateur?.voitHistorique === true;
}

function estSuperAdmin() {
  return etat.utilisateur?.superAdmin === true;
}

function afficherConnexion() {
  etat.utilisateur = null;
  etat.echeanciersCompletes = false;
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

function afficherSucces(message, conteneur = $(`#vue-${etat.vue}`) || $('#contenu')) {
  let zone = $('.message-succes', conteneur);
  if (!zone) {
    zone = document.createElement('p');
    zone.className = 'message-succes';
    conteneur.prepend(zone);
  }
  zone.textContent = message;
  zone.hidden = false;
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
  $('#nav-journal').hidden = !voitHistorique();
  $('#nav-superadmin').hidden = !estSuperAdmin();
  $$('#bouton-nouveau-contrat, #bouton-nouveau-client, #bouton-nouvelle-compagnie, #bouton-nouveau-produit')
    .forEach((element) => { element.hidden = !peutEcrire(); });
}

async function changerVue(nom) {
  if (nom === 'corbeille' && etat.utilisateur?.role !== 'admin') nom = 'tableau-de-bord';
  if (nom === 'journal' && !voitHistorique()) nom = 'tableau-de-bord';
  if (nom === 'superadmin' && !estSuperAdmin()) nom = 'tableau-de-bord';
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
    journal: chargerJournal,
    corbeille: chargerCorbeille,
    superadmin: chargerSuperAdmin,
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
  synchroniserSelectRecherchable(select);
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
  synchroniserSelectRecherchable(select);
}

async function completerEcheanciers() {
  if (!peutEcrire() || etat.echeanciersCompletes) return;
  await api('/api/echeances/completer', { method: 'POST' });
  etat.echeanciersCompletes = true;
}

async function chargerClientsPourSelect() {
  if (etat.clients.length) return;
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
  await completerEcheanciers();
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
    compagnie_nom: $('#filtre-compagnie-echeance').value,
    recherche: $('#filtre-recherche-echeance').value.trim(),
  };
}

async function chargerEcheances() {
  await completerEcheanciers();
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
    <td>${formaterMontant(ligne.montant_prime)}</td><td>${echapper(libelleCode(ligne.statut))}</td>
    <td><div class="actions-ligne"${peutEcrire() ? '' : ' hidden'}>
      ${ligne.type_echeance === 'terme' ? `<button type="button" data-action="encaisser" data-id="${echapper(ligne.echeance_id)}" data-solde="${Math.max(0, Number(ligne.montant_prime) - Number(ligne.montant_regle))}">Encaisser</button>` : ''}
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
    <td>${formaterDate(ligne.date_effet)}</td><td>${typeDureeAvecInfobulle(ligne)}</td>
    <td>${formaterDate(ligne.date_fin)}</td>
    <td>${etiquetteFeuilleCaisse(ligne.feuille_caisse)}</td>
    <td class="prime-contrat">${formaterMontantAligne(ligne.prime_totale)}</td>
    <td>DT</td>
    <td class="commission-nette">${ligne.feuille_caisse ? echapper(ligne.com_nette_saisie || formaterMontant(ligne.com_nette)) : ''}</td>
    <td><span class="remarque-contrat" title="${echapper(ligne.remarque || '')}">${echapper(ligne.remarque || '—')}</span></td>
    <td>${echapper(libelleCode(ligne.statut))}</td>
    <td>${controleRetourFeuilleCaisse(ligne)}</td></tr>`).join('');
  $('#etat-vide-contrats').hidden = lignes.length > 0;
  afficherPagination('contrats', resultat.pagination);
  $('#bouton-export-csv').href = `/api/export/portefeuille.csv?${parametres(filtresContrats())}`;
}

async function ouvrirFicheContrat(id) {
  const [contrat] = await Promise.all([api(`/api/contrats/${id}`), chargerReferentiels()]);
  etat.contratId = contrat.id;
  etat.contratCourant = contrat;
  etat.remarqueContrat = contrat.remarque || '';
  etat.paiementsContrat = contrat.paiements;
  etat.echeancesContrat = contrat.echeances;
  const dateFinContrat = `<div>Fin du contrat<div class="valeur">${formaterDate(contrat.date_fin)}</div></div>`;
  const commissionNette = contrat.feuille_caisse
    ? `<div>Commission nette<div class="valeur commission-nette">${echapper(contrat.com_nette_saisie || formaterMontant(contrat.com_nette))}</div></div>`
    : '';
  const actions = peutEcrire() ? `<div class="actions-ligne">
    <button type="button" data-action="modifier-contrat">Modifier</button>
    <button type="button" class="principal" data-action="creer-avenant">Créer un avenant</button>
    ${contrat.statut === 'en_cours' && typeDureeContrat(contrat) === 'rtr' ? '<button type="button" data-action="renouveler-contrat">Renouveler</button>' : ''}
    <button type="button" class="danger" data-action="archiver-contrat">Archiver</button></div>` : '';
  const echeances = contrat.echeances.map((ligne) => `<tr${peutEcrire() ? ` data-action="modifier-echeance" data-id="${echapper(ligne.id)}" title="Modifier l'échéance"` : ''}>
    <td>${ligne.type_echeance === 'terme' ? echapper(ligne.numero_terme) : 'Renouvellement'}</td>
    <td>${formaterDate(ligne.date_echeance)}</td>
    <td>${formaterMontant(ligne.montant_prime)}</td>
    <td>${etiquetteStatutEcheance(ligne.statut)}</td></tr>`).join('');
  const paiements = contrat.paiements.map((ligne) => `<tr${peutEcrire() ? ` data-action="modifier-paiement" data-id="${echapper(ligne.id)}" title="Modifier le paiement"` : ''}>
    <td>${formaterDate(ligne.date_paiement)}</td>
    <td>${formaterMontant(ligne.montant)}</td><td>${etiquetteFeuilleCaisse(ligne.feuille_caisse)}</td>
    <td>${ligne.feuille_caisse ? formaterDate(ligne.date_feuille_caisse) : ''}</td>
    <td class="commission-nette">${ligne.feuille_caisse ? echapper(ligne.com_nette_saisie || formaterMontant(ligne.com_nette)) : ''}</td>
    <td>${echapper(libelleCode(ligne.mode_paiement))}</td>
    <td>${echapper(ligne.reference || '—')}</td>
    <td><span class="remarque-contrat" title="${echapper(ligne.remarque || '')}">${echapper(ligne.remarque || '—')}</span></td></tr>`).join('');
  const historique = (contrat.historique || []).map((ligne) => `<div class="entree-historique">
    <span class="date">${formaterDate(ligne.cree_le, true)}</span>
    <span><strong>${echapper(ACTIONS_AUDIT[ligne.action] || libelleCode(ligne.action))}</strong>
    par ${echapper(ligne.utilisateur_nom)}${ligne.utilisateur_email ? `<br><span class="texte-secondaire">${echapper(ligne.utilisateur_email)}</span>` : ''}
    ${detailsAudit(ligne)}</span></div>`).join('');
  const libelleValeurAvenant = (modification, valeur) => {
    if (valeur === null || valeur === undefined || valeur === '') return 'Non renseigné';
    if (modification.champ === 'compagnie_id') return etat.compagnies.find((x) => x.id === valeur)?.nom || valeur;
    if (modification.champ === 'produit_id') return etat.produits.find((x) => x.id === valeur)?.nom || valeur;
    if (['souscripteur_id', 'payeur_id'].includes(modification.champ)) return contrat.nomsClients?.[valeur] || valeur;
    if (modification.champ === 'prime_totale') return formaterMontant(valeur);
    return formaterValeurAudit(valeur);
  };
  // La carte « Avenants » n'apparaît que si le contrat a au moins un avenant.
  const aDesAvenants = (contrat.avenants || []).some((version) => version.numero_version > 1);
  const versions = (contrat.avenants || []).map((version, index) => {
    const modifications = (version.modifications || []).map((modification) => `<li>
      <strong>${echapper(modification.libelle || modification.champ)} :</strong>
      <span>${echapper(libelleValeurAvenant(modification, modification.avant))}</span>
      <span aria-hidden="true">→</span>
      <span>${echapper(libelleValeurAvenant(modification, modification.apres))}</span>
    </li>`).join('');
    const etatVersion = version.est_version_active
      ? 'En vigueur'
      : (version.applique_le ? 'Historique' : 'Planifié');
    const classeVersion = version.est_version_active
      ? 'appliquee'
      : (version.applique_le ? 'historique' : 'planifiee');
    const periodeVersion = version.date_fin_validite
      ? `du ${formaterDate(version.date_effet)} au ${formaterDate(version.date_fin_validite)}`
      : `à partir du ${formaterDate(version.date_effet)}`;
    const primeAvenant = Number(version.prime_avenant) || 0;
    const primeVersion = version.numero_version === 1 ? '' : `<p class="prime-avenant">Prime de l’avenant :
      <strong>${primeAvenant > 0 ? '+' : ''}${formaterMontant(primeAvenant)}</strong>
      · Prime totale : <strong>${formaterMontant(version.prime_totale)}</strong></p>`;
    // Seul le dernier avenant est modifiable : les versions suivantes en découlent.
    const actionsVersion = peutEcrire() && index === 0 && version.numero_version > 1
      ? `<div class="actions-ligne">
        <button type="button" data-action="modifier-avenant" data-id="${echapper(version.id)}">Modifier</button>
        <button type="button" class="danger" data-action="supprimer-avenant" data-id="${echapper(version.id)}">Supprimer</button></div>`
      : '';
    return `<article class="version-contrat">
      <div class="version-contrat-entete"><div><strong>${version.numero_version === 1 ? 'Version initiale' : `Avenant n° ${version.numero_version - 1}`}</strong>
      <span>Version ${version.numero_version} · valable ${periodeVersion}</span></div>
      <span class="etiquette-version ${classeVersion}">${etatVersion}</span></div>
      ${primeVersion}
      ${modifications ? `<ul class="differences-avenant">${modifications}</ul>` : '<p class="texte-secondaire">Données d’origine du contrat.</p>'}
      <p class="texte-secondaire">Créée par ${echapper(version.auteur_nom || 'Système')} le ${formaterDate(version.cree_le, true)}</p>
      ${actionsVersion}
    </article>`;
  }).join('');
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
    <div>Date d'effet<div class="valeur">${formaterDate(contrat.date_effet)}</div></div>
    <div>Durée du contrat<div class="valeur">${typeDureeAvecInfobulle(contrat)}</div></div>
    <div>Feuille de caisse<div class="valeur">${etiquetteFeuilleCaisse(contrat.feuille_caisse)}</div></div>
    <div>Retour feuille de caisse<div class="valeur">${etiquetteFeuilleCaisse(contrat.retour_feuille_caisse)}</div></div>
    ${commissionNette}
    ${dateFinContrat}
    <div>Statut<div class="valeur">${echapper(libelleCode(contrat.statut))}</div></div>
    <div>Remarque<div class="valeur remarque-contrat">${echapper(contrat.remarque || '—')}</div></div></div>
    <div class="carte"><div class="entete-section"><h3>Pièces jointes du contrat</h3>${ajoutPieceJointe}</div>
    ${piecesJointes ? `<ul class="liste-pieces-jointes">${piecesJointes}</ul>` : '<p class="etat-vide">Aucune pièce jointe.</p>'}</div>
    <div class="carte"><h3>Échéancier complet</h3>${echeances
      ? `<div class="tableau-responsive"><table id="tableau-echeancier-contrat"><thead><tr><th>N°</th><th>Date</th><th>Montant</th><th>Statut</th></tr></thead><tbody>${echeances}</tbody></table></div>`
      : '<p class="etat-vide">Aucune échéance pour ce contrat.</p>'}</div>
    <div class="carte"><h3>Paiements</h3>${paiements ? `<div class="tableau-responsive"><table id="tableau-paiements-contrat"><thead><tr><th>Date du paiement</th><th>Montant</th><th>Feuille de caisse</th><th>Date de la feuille</th><th>Commission nette</th><th>Mode</th><th>Référence</th><th>Remarque</th></tr></thead><tbody>${paiements}</tbody></table></div>` : '<p class="etat-vide">Aucun paiement.</p>'}</div>
    ${aDesAvenants ? `<div class="carte"><h3>Avenants</h3><div class="liste-versions-contrat">${versions}</div></div>` : ''}
    ${voitHistorique() ? `<div class="carte"><h3>Historique</h3><div class="frise-historique">${historique || '<p class="etat-vide">Aucun historique.</p>'}</div></div>` : ''}`;
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
  const contrats = client.contrats.map((ligne) => {
    const echeances = (ligne.echeances || []).map((echeance) => `<span class="resume-echeance">
      <span>${formaterDate(echeance.date_echeance)}</span>
      <span>${formaterMontant(echeance.montant_prime)}</span>
      ${etiquetteStatutEcheance(echeance.statut)}
    </span>`).join('');
    return `<tr data-contrat-id="${echapper(ligne.id)}"><td>${echapper(ligne.numero_contrat)}</td>
    <td>${echapper(ligne.compagnie_nom)}</td><td>${echapper(ligne.produit_nom)}</td><td>${formaterDate(ligne.date_effet)}</td>
    <td>${formaterMontant(ligne.prime_totale)}</td><td>${echapper(libelleCode(ligne.statut))}</td>
    <td><div class="liste-echeances-contrat">${echeances || '<span class="texte-secondaire">Aucune échéance</span>'}</div></td>
    <td>${Number(ligne.nombre_pieces) || 0}</td></tr>`;
  }).join('');
  const historique = (client.historique || []).map((ligne) => `<div class="entree-historique">
    <span class="date">${formaterDate(ligne.cree_le, true)}</span>
    <span><strong>${echapper(ACTIONS_AUDIT[ligne.action] || libelleCode(ligne.action))}</strong>
    par ${echapper(ligne.utilisateur_nom)}${ligne.utilisateur_email ? `<br><span class="texte-secondaire">${echapper(ligne.utilisateur_email)}</span>` : ''}
    ${detailsAudit(ligne)}</span></div>`).join('');
  $('#contenu-fiche-client').innerHTML = `<div class="fiche-entete"><div><h2>${echapper(client.nom)}</h2>
    <p>${echapper(libelleCode(client.type_client))} — ${echapper(client.cin_ou_matricule || 'Identifiant non renseigné')}</p></div>${actions}</div>
    <div class="carte fiche-cumuls"><div>Cumul des primes<div class="valeur">${formaterMontant(client.cumulPrimes)}</div></div>
    <div>Téléphone<div class="valeur">${client.telephone ? `<a href="tel:${echapper(client.telephone)}">${echapper(client.telephone)}</a>` : '—'}</div></div>
    <div>Date de naissance<div class="valeur">${formaterDate(client.date_naissance)}</div></div>
    <div>Code Finasure<div class="valeur">${echapper(client.code_client_finasure || '—')}</div></div></div>
    <div class="carte"><h3>Contrats et échéances</h3>${contrats ? `<div class="tableau-responsive"><table><thead><tr><th>N° contrat</th><th>Compagnie</th><th>Produit</th><th>Effet</th><th>Prime</th><th>Statut</th><th>Échéances</th><th>Documents</th></tr></thead><tbody>${contrats}</tbody></table></div>` : '<p class="etat-vide">Aucun contrat.</p>'}</div>
    ${voitHistorique() ? `<div class="carte"><h3>Historique</h3><div class="frise-historique">${historique || '<p class="etat-vide">Aucun historique.</p>'}</div></div>` : ''}`;
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

function filtresJournal() {
  return {
    action: $('#filtre-action-journal').value,
    table: $('#filtre-table-journal').value,
    recherche: $('#filtre-recherche-journal').value.trim(),
  };
}

async function chargerJournal() {
  const resultat = await api(`/api/journal-audit?${parametres({
    ...filtresJournal(), page: etat.pages.journal, limite: 50,
  })}`);
  $('#corps-tableau-journal').innerHTML = resultat.donnees.map((ligne) => `<tr>
    <td>${formaterDate(ligne.cree_le, true)}</td>
    <td><strong>${echapper(ligne.utilisateur_nom)}</strong>${ligne.utilisateur_email ? `<br><span class="texte-secondaire">${echapper(ligne.utilisateur_email)}</span>` : ''}</td>
    <td><span class="etiquette-audit ${echapper(ligne.action)}">${echapper(ACTIONS_AUDIT[ligne.action] || libelleCode(ligne.action))}</span></td>
    <td>${echapper(TYPES_AUDIT[ligne.table_cible] || libelleCode(ligne.table_cible))}</td>
    <td><strong>${echapper(ligne.element)}</strong></td>
    <td>${detailsAudit(ligne)}</td>
  </tr>`).join('');
  $('#etat-vide-journal').hidden = resultat.donnees.length > 0;
  afficherPagination('journal', resultat.pagination);
}

function periodeComptabilite() {
  return { du: $('#filtre-comptabilite-du').value, au: $('#filtre-comptabilite-au').value };
}

// Période du détail : le mois cliqué, borné par la période choisie en haut de page.
function periodeDetailComptabilite() {
  const periode = periodeComptabilite();
  const mois = etat.moisComptabilite;
  if (!mois) return periode;
  const [annee, numero] = mois.split('-').map(Number);
  const debut = `${mois}-01`;
  const fin = `${mois}-${String(new Date(Date.UTC(annee, numero, 0)).getUTCDate()).padStart(2, '0')}`;
  return {
    du: periode.du && periode.du > debut ? periode.du : debut,
    au: periode.au && periode.au < fin ? periode.au : fin,
  };
}

function controlesMois(ligne) {
  const controles = [];
  if (Number(ligne.nb_sans_feuille) > 0) controles.push(`${ligne.nb_sans_feuille} sans feuille de caisse`);
  if (Number(ligne.nb_commission_lot) > 0) controles.push(`${ligne.nb_commission_lot} commission(s) regroupée(s) sur un autre dossier`);
  if (Number(ligne.nb_commission_nulle) > 0) controles.push(`${ligne.nb_commission_nulle} commission(s) à 0 sans remarque`);
  return controles.join(' · ') || '—';
}

function libelleMois(mois) {
  const [annee, numero] = mois.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(annee, numero - 1, 1)));
}

// Le détail s'ouvre sous le mois cliqué ; sans mois choisi, il liste toute la période sous le tableau.
function placerDetailComptabilite() {
  const elements = [$('#carte-detail-comptabilite'), $('#pagination-comptabilite')];
  const ancienne = $('#ligne-detail-mois');
  const ligneMois = etat.moisComptabilite
    ? $(`#corps-comptabilite-mois tr[data-mois="${etat.moisComptabilite}"]`) : null;
  if (ligneMois) {
    const ligne = document.createElement('tr');
    const cellule = document.createElement('td');
    cellule.colSpan = 5;
    cellule.append(...elements);
    ligne.append(cellule);
    ligneMois.after(ligne);
    if (ancienne) ancienne.remove();
    ligne.id = 'ligne-detail-mois';
  } else {
    $('#carte-comptabilite-mois').after(...elements);
    if (ancienne) ancienne.remove();
  }
}

async function chargerPaiementsComptabilite() {
  const resultat = await api(`/api/superadmin/comptabilite/paiements?${parametres({
    ...periodeDetailComptabilite(), page: etat.pages.comptabilite, limite: 50,
  })}`);
  etat.paiementsComptabilite = resultat.donnees;
  const mois = etat.moisComptabilite;
  $('#titre-detail-comptabilite').textContent = mois
    ? `Paiements de ${libelleMois(mois)}` : 'Détail des paiements de la période';
  $('#bouton-toute-periode-comptabilite').hidden = !mois;
  // Rappel des totaux attendus, pour contrôler le détail ligne à ligne.
  const reference = mois
    ? (etat.comptabilite?.par_mois || []).find((ligne) => ligne.mois === mois)
    : etat.comptabilite?.totaux;
  $('#resume-detail-comptabilite').textContent = reference
    ? `${reference.nb_paiements} paiement(s) · ${formaterMontant(reference.encaisse)} encaissés · ${formaterMontant(reference.commission_nette)} de commission nette`
    : '';
  $$('#corps-comptabilite-mois tr').forEach((ligne) => ligne.classList.toggle('actif', ligne.dataset.mois === mois));
  $('#corps-tableau-comptabilite').innerHTML = resultat.donnees.map((ligne) => `<tr>
    <td>${formaterDate(ligne.date_paiement)}</td><td>${echapper(ligne.client_nom)}</td>
    <td><button type="button" class="discret" data-action="ouvrir-contrat" data-id="${echapper(ligne.contrat_id)}">${echapper(ligne.numero_contrat)}</button></td>
    <td>${echapper(ligne.compagnie_nom)}</td>
    <td>${formaterMontant(ligne.montant)}</td><td>${etiquetteFeuilleCaisse(ligne.feuille_caisse)}</td>
    <td class="commission-nette">${ligne.feuille_caisse ? echapper(ligne.com_nette_saisie || formaterMontant(ligne.com_nette)) : ''}</td>
    <td><span class="remarque-contrat" title="${echapper(ligne.remarque || '')}">${echapper(ligne.remarque || '—')}</span></td>
    <td>${echapper(libelleCode(ligne.mode_paiement))}</td>
    <td>${echapper(ligne.saisi_par_nom || '—')}</td>
    <td><div class="actions-ligne"${peutEcrire() ? '' : ' hidden'}>
      <button type="button" data-action="modifier-paiement-comptabilite" data-id="${echapper(ligne.id)}">Modifier</button>
      <button type="button" class="danger" data-action="supprimer-paiement-comptabilite" data-id="${echapper(ligne.id)}">Supprimer</button>
    </div></td></tr>`).join('');
  $('#etat-vide-comptabilite').hidden = resultat.donnees.length > 0;
  afficherPagination('comptabilite', resultat.pagination);
  placerDetailComptabilite();
}

// Après la modification ou la suppression d'un paiement : totaux recalculés sans le cache.
async function rafraichirComptabilite() {
  await chargerComptabilite(true);
  await chargerPaiementsComptabilite();
}

async function chargerComptabilite(sansCache = false) {
  const donnees = await api(`/api/superadmin/comptabilite?${parametres({
    ...periodeComptabilite(), frais: sansCache ? 1 : '',
  })}`);
  etat.comptabilite = donnees;
  $('#filtre-comptabilite-du').value = donnees.du;
  $('#filtre-comptabilite-au').value = donnees.au;
  const totaux = donnees.totaux;
  const statistiques = [
    ['Commission nette', formaterMontant(totaux.commission_nette)],
    ['Primes encaissées', formaterMontant(totaux.encaisse)],
    ['Nombre de paiements', totaux.nb_paiements],
    ['Sans feuille de caisse', totaux.nb_sans_feuille, Number(totaux.nb_sans_feuille) > 0],
    ['Commission regroupée sur un autre dossier', totaux.nb_commission_lot],
    ['Commission à 0 sans remarque', totaux.nb_commission_nulle, Number(totaux.nb_commission_nulle) > 0],
    ['Encaissé sans commission saisie', formaterMontant(totaux.encaisse_sans_feuille)],
  ];
  $('#stats-comptabilite').innerHTML = statistiques.map(([libelle, valeur, alerte]) =>
    `<div class="carte stat${alerte ? ' alerte' : ''}"><div class="valeur">${echapper(valeur)}</div><div class="libelle">${libelle}</div></div>`).join('');
  // Le détail est sorti du tableau avant que ses lignes soient réécrites.
  $('#carte-comptabilite-mois').after($('#carte-detail-comptabilite'), $('#pagination-comptabilite'));
  $('#corps-comptabilite-mois').innerHTML = donnees.par_mois.map((ligne) => `<tr data-action="voir-mois-comptabilite"
    data-mois="${echapper(ligne.mois)}" title="Voir les paiements de ${echapper(libelleMois(ligne.mois))}">
    <td>${echapper(libelleMois(ligne.mois))}</td><td>${echapper(ligne.nb_paiements)}</td>
    <td>${formaterMontant(ligne.encaisse)}</td>
    <td class="commission-nette">${formaterMontant(ligne.commission_nette)}</td>
    <td>${echapper(controlesMois(ligne))}</td></tr>`).join('');
  // Le total est recalculé ici à partir des lignes : il doit égaler les cartes du haut.
  const somme = (cle) => donnees.par_mois.reduce((cumul, ligne) => cumul + Math.round(Number(ligne[cle]) * 1000), 0) / 1000;
  $('#pied-comptabilite-mois').innerHTML = donnees.par_mois.length ? `<tr><td>Total</td>
    <td>${somme('nb_paiements')}</td><td>${formaterMontant(somme('encaisse'))}</td>
    <td class="commission-nette">${formaterMontant(somme('commission_nette'))}</td><td></td></tr>` : '';
  $('#etat-vide-comptabilite-mois').hidden = donnees.par_mois.length > 0;
  $('#comptabilite-compagnie').innerHTML = repartitionHtml(donnees.par_compagnie, 'nom', 'commission_nette');
  $('#comptabilite-branche').innerHTML = repartitionHtml(donnees.par_branche, 'nom', 'commission_nette');
  $('#comptabilite-utilisateur').innerHTML = repartitionHtml(donnees.par_utilisateur, 'nom', 'commission_nette');
}

async function chargerUtilisateurs() {
  etat.utilisateurs = await api('/api/superadmin/utilisateurs');
  const roles = { admin: 'Administrateur', agent: 'Agent', lecture: 'Lecture seule' };
  $('#corps-tableau-utilisateurs').innerHTML = etat.utilisateurs.map((ligne) => `<tr>
    <td><strong>${echapper(ligne.nom)}</strong></td><td>${echapper(ligne.email)}</td>
    <td>${echapper(roles[ligne.role] || ligne.role)}${ligne.super_admin ? ' <span class="etiquette-audit">Super admin</span>' : ''}</td>
    <td><span class="etiquette-audit ${ligne.actif ? 'restauration' : 'suppression'}">${ligne.actif ? 'Actif' : 'Désactivé'}</span></td>
    <td>${formaterDate(ligne.derniere_connexion, true)}</td>
    <td><div class="actions-ligne">${ligne.actif ? `
      <button type="button" data-action="modifier-utilisateur" data-id="${echapper(ligne.id)}">Modifier</button>
      <button type="button" data-action="mot-de-passe-utilisateur" data-id="${echapper(ligne.id)}">Mot de passe</button>
      ${ligne.id === etat.utilisateur.id ? '' : `<button type="button" class="danger" data-action="desactiver-utilisateur" data-id="${echapper(ligne.id)}">Désactiver</button>`}`
    : `<button type="button" data-action="reactiver-utilisateur" data-id="${echapper(ligne.id)}">Réactiver</button>`}
    </div></td></tr>`).join('');
}

async function chargerSuperAdmin() {
  etat.pages.comptabilite = 1;
  etat.moisComptabilite = null;
  // La comptabilité fixe d'abord la période par défaut, reprise par le détail des paiements.
  await Promise.all([chargerComptabilite().then(chargerPaiementsComptabilite), chargerUtilisateurs()]);
}

function ouvrirModaleUtilisateur(utilisateur = null) {
  etat.edition.utilisateur = utilisateur?.id || null;
  $('#formulaire-utilisateur').reset();
  $('#titre-modale-utilisateur').textContent = utilisateur ? `Modifier ${utilisateur.nom}` : 'Nouvel utilisateur';
  $('#utilisateur-nom').value = utilisateur?.nom || '';
  $('#utilisateur-email').value = utilisateur?.email || '';
  $('#utilisateur-role').value = utilisateur?.role || 'agent';
  $('#utilisateur-super-admin').checked = Boolean(utilisateur?.super_admin);
  $('#zone-utilisateur-mot-de-passe').hidden = Boolean(utilisateur);
  $('#utilisateur-mot-de-passe').required = !utilisateur;
  synchroniserTousLesSelects();
  $('#modale-utilisateur').showModal();
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
  $('#client-sms-autorise').checked = Boolean(client?.sms_autorise);
  $('#client-date-naissance').max = new Date().toISOString().slice(0, 10);
  $('#zone-client-date-naissance').hidden = $('#client-type').value !== 'personne_physique';
  synchroniserTousLesSelects();
  $('#modale-client').showModal();
}

async function ouvrirModaleContrat(contrat = null) {
  await Promise.all([chargerReferentiels(), chargerClientsPourSelect()]);
  etat.edition.contrat = contrat?.id || null;
  etat.edition.avenant = false;
  etat.edition.avenantId = null;
  $('#zone-date-effet-avenant').hidden = true;
  $('#contrat-date-effet-avenant').required = false;
  $('#libelle-contrat-prime').textContent = 'Prime totale (DT)';
  $('#contrat-prime').min = '0.001';
  $('#resume-prime-avenant').hidden = true;
  $('#contrat-client').disabled = false;
  $('#contrat-numero').readOnly = false;
  $('#contrat-date-effet').readOnly = false;
  $('#titre-modale-contrat').textContent = contrat ? 'Modifier le contrat' : 'Nouveau contrat';
  const champs = {
    '#contrat-client': contrat?.client_id, '#contrat-souscripteur': contrat?.souscripteur_id || contrat?.client_id,
    '#contrat-societe-leasing': contrat?.societe_leasing || contrat?.societe_leasing_nom,
    '#contrat-payeur': contrat?.payeur_id,
    '#contrat-numero': contrat?.numero_contrat,
    '#contrat-compagnie': contrat?.compagnie_id, '#contrat-produit': contrat?.produit_id,
    '#contrat-immatriculation': contrat?.immatriculation,
    '#contrat-date-effet': contrat?.date_effet?.slice(0, 10), '#contrat-date-fin': contrat?.date_fin?.slice(0, 10),
    '#contrat-duree': contrat?.duree_mois || 12,
    '#contrat-type-duree': typeDureeContrat(contrat),
    '#contrat-fractionnement': contrat?.fractionnement || 'annuel',
    '#contrat-date-echeance': contrat?.date_echeance?.slice(0, 10),
    '#contrat-prime': contrat?.prime_totale,
    '#contrat-remarque': contrat?.remarque,
  };
  Object.entries(champs).forEach(([selecteur, valeur]) => { $(selecteur).value = valeur ?? ''; });
  $('#contrat-paiement-mode').value = 'autre';
  $('#contrat-paiement-reference').value = '';
  $('#contrat-retour-feuille-oui').checked = Boolean(contrat?.retour_feuille_caisse);
  $('#contrat-retour-feuille-non').checked = !contrat?.retour_feuille_caisse;
  $$('[data-paiement-initial]').forEach((champ) => { champ.hidden = Boolean(contrat); });
  if (!contrat) $('#contrat-souscripteur').value = $('#contrat-client').value;
  appliquerReglesDureeContrat();
  synchroniserTousLesSelects();
  $('#modale-contrat').showModal();
}

function actualiserResumePrimeAvenant() {
  if (!etat.edition.avenant) return;
  const precedente = Number(etat.edition.primePrecedente) || 0;
  const total = Math.round((precedente + (Number($('#contrat-prime').value) || 0)) * 1000) / 1000;
  const resume = $('#resume-prime-avenant');
  resume.textContent = `Prime actuelle : ${formaterMontant(precedente)} · Prime totale après avenant : ${formaterMontant(total)}`;
  resume.hidden = false;
}

// La prime saisie est celle de l'avenant : elle s'ajoute à la prime de la version précédente.
async function ouvrirModaleAvenant(contrat, avenant = null) {
  await ouvrirModaleContrat(avenant ? {
    ...contrat,
    souscripteur_id: avenant.souscripteur_id,
    societe_leasing: avenant.societe_leasing,
    societe_leasing_nom: avenant.societe_leasing,
    payeur_id: avenant.payeur_id,
    compagnie_id: avenant.compagnie_id,
    produit_id: avenant.produit_id,
    immatriculation: avenant.immatriculation,
    date_fin: avenant.date_fin_contrat,
    duree_mois: avenant.duree_mois,
    fractionnement: avenant.fractionnement,
    type_duree: avenant.fractionnement === 'prime_unique' ? 'ferme' : 'rtr',
    retour_feuille_caisse: avenant.retour_feuille_caisse,
    remarque: avenant.remarque,
  } : contrat);
  etat.edition.avenant = true;
  etat.edition.avenantId = avenant?.id || null;
  etat.edition.primePrecedente = avenant
    ? Number(avenant.prime_totale) - Number(avenant.prime_avenant)
    : Number(contrat.prime_totale);
  $('#titre-modale-contrat').textContent = avenant
    ? `Modifier l’avenant n° ${avenant.numero_version - 1} — ${contrat.numero_contrat}`
    : `Créer un avenant — ${contrat.numero_contrat}`;
  $('#zone-date-effet-avenant').hidden = false;
  $('#contrat-date-effet-avenant').required = true;
  const aujourdhui = new Date().toISOString().slice(0, 10);
  if (avenant) $('#contrat-date-effet-avenant').removeAttribute('min');
  else $('#contrat-date-effet-avenant').min = aujourdhui;
  $('#contrat-date-effet-avenant').value = avenant?.date_effet?.slice(0, 10) || aujourdhui;
  $('#libelle-contrat-prime').textContent = 'Prime de l’avenant (DT)';
  $('#contrat-prime').removeAttribute('min');
  $('#contrat-prime').value = avenant ? Number(avenant.prime_avenant) : '';
  actualiserResumePrimeAvenant();
  $('#contrat-client').disabled = true;
  $('#contrat-numero').readOnly = true;
  $('#contrat-date-effet').readOnly = true;
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
  synchroniserTousLesSelects();
  $('#modale-produit').showModal();
}

async function soumettre(formulaire, action) {
  const dialogue = formulaire.closest('dialog');
  const bouton = $(`[form="${formulaire.id}"][type="submit"]`);
  effacerErreurs(dialogue);
  bouton.disabled = true;
  try { await action(); } catch (e) { afficherErreur(e.message, dialogue); } finally { bouton.disabled = false; }
}

function ouvrirModalePaiement({ paiement = null, echeanceId, solde = 0 } = {}) {
  const aujourdHui = new Date().toISOString().slice(0, 10);
  etat.edition.paiement = paiement?.id || null;
  etat.echeanceId = echeanceId || paiement?.echeance_id;
  $('#titre-modale-encaissement').textContent = paiement ? 'Modifier le paiement' : 'Encaisser';
  $('#bouton-enregistrer-encaissement').textContent = paiement ? 'Enregistrer les modifications' : "Enregistrer l'encaissement";
  $('#bouton-supprimer-paiement').hidden = !paiement;
  $('#encaissement-montant').value = paiement ? Number(paiement.montant).toFixed(3) : Number(solde).toFixed(3);
  $('#encaissement-mode').value = paiement?.mode_paiement || 'especes';
  $('#encaissement-reference').value = paiement?.reference || '';
  const estDernierPaiement = paiement
    && String(paiement.id) === String(etat.paiementsContrat[0]?.id);
  $('#encaissement-remarque').value = paiement?.remarque
    ?? (estDernierPaiement ? etat.remarqueContrat : '');
  $('#encaissement-date').value = paiement?.date_paiement?.slice(0, 10) || aujourdHui;
  $('#encaissement-feuille-caisse-oui').checked = Boolean(paiement?.feuille_caisse);
  $('#encaissement-feuille-caisse-non').checked = !paiement?.feuille_caisse;
  $('#encaissement-commission-nette').value = paiement?.feuille_caisse
    ? (paiement.com_nette_saisie || paiement.com_nette) : '';
  $('#encaissement-date-feuille').value = paiement?.date_feuille_caisse?.slice(0, 10) || '';
  appliquerReglesFeuilleCaisseEncaissement();
  $('#modale-encaissement').showModal();
}

function ouvrirModaleEcheance(echeance) {
  etat.edition.echeance = echeance.id;
  $('#echeance-date').value = echeance.date_echeance?.slice(0, 10) || '';
  $('#echeance-montant').value = Number(echeance.montant_prime).toFixed(3);
  $('#echeance-statut').value = echeance.statut;
  $('#modale-echeance').showModal();
}

async function actionDeleguee(event) {
  const bouton = event.target.closest('[data-action]');
  const ligneContrat = event.target.closest('tr[data-contrat-id]');
  const ligneClient = event.target.closest('tr[data-client-id]');
  if (event.target.closest('.controle-retour-feuille')) return;
  if (!bouton) {
    if (ligneContrat) await ouvrirFicheContrat(ligneContrat.dataset.contratId);
    else if (ligneClient) await ouvrirFicheClient(ligneClient.dataset.clientId);
    return;
  }
  event.stopPropagation();
  const { action, id } = bouton.dataset;
  try {
    if (action === 'encaisser') {
      ouvrirModalePaiement({
        echeanceId: id,
        solde: bouton.dataset.solde,
      });
    } else if (action === 'modifier-paiement') {
      const paiement = etat.paiementsContrat.find((ligne) => String(ligne.id) === String(id));
      if (!paiement) throw new Error('Paiement introuvable. Rechargez la fiche du contrat.');
      ouvrirModalePaiement({ paiement });
    } else if (action === 'modifier-echeance') {
      const echeance = etat.echeancesContrat.find((ligne) => String(ligne.id) === String(id));
      if (!echeance) throw new Error("Échéance introuvable. Rechargez la fiche du contrat.");
      ouvrirModaleEcheance(echeance);
    } else if (action === 'supprimer-paiement'
        && window.confirm('Supprimer ce paiement ? Le statut de l’échéance sera recalculé.')) {
      await api(`/api/echeances/${etat.echeanceId}/paiements/${etat.edition.paiement}`, { method: 'DELETE' });
      $('#modale-encaissement').close();
      if (etat.vue === 'superadmin') {
        await rafraichirComptabilite();
        afficherSucces('Paiement supprimé.', $('#vue-superadmin'));
      } else {
        await ouvrirFicheContrat(etat.contratId);
        afficherSucces('Paiement supprimé.', $('#vue-fiche-contrat'));
      }
    } else if (action === 'voir-mois-comptabilite') {
      // Un second clic sur le même mois referme son détail.
      const mois = bouton.dataset.mois || null;
      etat.moisComptabilite = mois === etat.moisComptabilite ? null : mois;
      etat.pages.comptabilite = 1;
      await chargerPaiementsComptabilite();
      if (etat.moisComptabilite) $('#ligne-detail-mois').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (action === 'modifier-paiement-comptabilite') {
      const paiement = etat.paiementsComptabilite.find((ligne) => String(ligne.id) === String(id));
      if (!paiement) throw new Error('Paiement introuvable. Rechargez la page.');
      ouvrirModalePaiement({ paiement });
    } else if (action === 'supprimer-paiement-comptabilite'
        && window.confirm('Supprimer ce paiement ? Le statut de l’échéance sera recalculé.')) {
      const paiement = etat.paiementsComptabilite.find((ligne) => String(ligne.id) === String(id));
      if (!paiement) throw new Error('Paiement introuvable. Rechargez la page.');
      await api(`/api/echeances/${paiement.echeance_id}/paiements/${paiement.id}`, { method: 'DELETE' });
      await rafraichirComptabilite();
      afficherSucces('Paiement supprimé.', $('#vue-superadmin'));
    } else if (action === 'supprimer-echeance'
        && window.confirm('Supprimer cette échéance ? Cette action sera enregistrée dans le journal.')) {
      await api(`/api/echeances/${etat.edition.echeance}`, { method: 'DELETE' });
      $('#modale-echeance').close();
      await ouvrirFicheContrat(etat.contratId);
      afficherSucces('Échéance supprimée.', $('#vue-fiche-contrat'));
    } else if (action === 'relancer') {
      etat.echeanceId = id;
      $('#formulaire-relance').reset();
      $('#modale-relance').showModal();
    } else if (action === 'modifier-contrat') {
      await ouvrirModaleContrat(etat.contratCourant);
    } else if (action === 'creer-avenant') {
      await ouvrirModaleAvenant(etat.contratCourant);
    } else if (action === 'modifier-avenant') {
      const avenant = (etat.contratCourant.avenants || []).find((ligne) => String(ligne.id) === String(id));
      if (!avenant) throw new Error('Avenant introuvable. Rechargez la fiche du contrat.');
      await ouvrirModaleAvenant(etat.contratCourant, avenant);
    } else if (action === 'supprimer-avenant'
        && window.confirm('Supprimer cet avenant ? Le contrat reviendra à la version précédente.')) {
      await api(`/api/contrats/${etat.contratId}/avenants/${id}`, { method: 'DELETE' });
      await ouvrirFicheContrat(etat.contratId);
      afficherSucces('Avenant supprimé.', $('#vue-fiche-contrat'));
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
      if (fichier.size > 4 * 1024 * 1024) throw new Error('Le fichier dépasse la taille maximale de 4 Mo.');
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
      else if (cible === 'journal') await chargerJournal();
      else if (cible === 'comptabilite') await chargerPaiementsComptabilite();
    } else if (action === 'modifier-client') {
      const clientId = id || etat.clientId;
      ouvrirModaleClient(await api(`/api/clients/${clientId}`));
    } else if (action === 'archiver-client' && window.confirm('Supprimer ce client ? Il sera placé dans la corbeille.')) {
      const clientId = id || etat.clientId;
      await api(`/api/clients/${clientId}`, { method: 'DELETE' });
      etat.clients = [];
      await changerVue('clients');
    } else if (action === 'nouvel-utilisateur') {
      ouvrirModaleUtilisateur();
    } else if (action === 'modifier-utilisateur') {
      ouvrirModaleUtilisateur(etat.utilisateurs.find((x) => x.id === id));
    } else if (action === 'mot-de-passe-utilisateur') {
      const utilisateur = etat.utilisateurs.find((x) => x.id === id);
      etat.edition.utilisateur = id;
      $('#formulaire-mot-de-passe').reset();
      $('#titre-modale-mot-de-passe').textContent = `Nouveau mot de passe — ${utilisateur?.nom || ''}`;
      $('#modale-mot-de-passe').showModal();
    } else if (action === 'desactiver-utilisateur'
        && window.confirm('Désactiver ce compte ? Il ne pourra plus se connecter.')) {
      await api(`/api/superadmin/utilisateurs/${id}`, { method: 'DELETE' });
      await chargerUtilisateurs();
    } else if (action === 'reactiver-utilisateur') {
      await api(`/api/superadmin/utilisateurs/${id}/restaurer`, { method: 'POST' });
      await chargerUtilisateurs();
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
    afficherErreur(e.message, $('dialog[open]') || undefined);
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
        smsAutorise: $('#client-sms-autorise').checked,
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
      const estAvenant = etat.edition.avenant === true;
      const corps = {
        numeroContrat: $('#contrat-numero').value.trim(), clientId: $('#contrat-client').value,
        souscripteurId: $('#contrat-souscripteur').value,
        societeLeasing: $('#contrat-societe-leasing').value.trim() || null,
        payeurId: $('#contrat-payeur').value || null,
        compagnieId: $('#contrat-compagnie').value, produitId: $('#contrat-produit').value,
        immatriculation: $('#contrat-immatriculation').value.trim(),
        dateEffet: $('#contrat-date-effet').value, dureeMois: Number($('#contrat-duree').value),
        dateFin: $('#contrat-date-fin').value,
        typeDuree: $('#contrat-type-duree').value,
        fractionnement: $('#contrat-fractionnement').value,
        primeTotale: estAvenant ? null : Number($('#contrat-prime').value),
        primeAvenant: estAvenant ? Number($('#contrat-prime').value) : null,
        retourFeuilleCaisse: $('#contrat-retour-feuille-oui').checked,
        remarque: $('#contrat-remarque').value.trim(),
        modePaiementInitial: $('#contrat-paiement-mode').value,
        referencePaiementInitial: $('#contrat-paiement-reference').value.trim(),
        dateEffetAvenant: estAvenant ? $('#contrat-date-effet-avenant').value : null,
      };
      const avenantId = estAvenant ? etat.edition.avenantId : null;
      const cheminAvenant = `/api/contrats/${id}/avenants${avenantId ? `/${avenantId}` : ''}`;
      const contrat = await api(estAvenant ? cheminAvenant : (id ? `/api/contrats/${id}` : '/api/contrats'), {
        method: estAvenant ? (avenantId ? 'PUT' : 'POST') : (id ? 'PUT' : 'POST'), body: JSON.stringify(corps),
      });
      $('#modale-contrat').close();
      await ouvrirFicheContrat(estAvenant ? id : contrat.id);
    });
  });

  $('#formulaire-encaissement').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      const paiementId = etat.edition.paiement;
      const resultat = await api(
        `/api/echeances/${etat.echeanceId}/paiements${paiementId ? `/${paiementId}` : ''}`,
        { method: paiementId ? 'PUT' : 'POST', body: JSON.stringify({
          montant: Number($('#encaissement-montant').value), modePaiement: $('#encaissement-mode').value,
          reference: $('#encaissement-reference').value.trim(), datePaiement: $('#encaissement-date').value || null,
          remarquePaiement: $('#encaissement-remarque').value.trim(),
          feuilleCaisse: $('#encaissement-feuille-caisse-oui').checked,
          commissionNette: $('#encaissement-feuille-caisse-oui').checked
            ? $('#encaissement-commission-nette').value.trim() : null,
          dateFeuilleCaisse: $('#encaissement-feuille-caisse-oui').checked
            ? $('#encaissement-date-feuille').value || null : null,
        }) }
      );
      $('#modale-encaissement').close();
      if (paiementId && etat.vue === 'superadmin') {
        await rafraichirComptabilite();
        afficherSucces('Paiement modifié.', $('#vue-superadmin'));
        return;
      }
      if (paiementId) {
        await ouvrirFicheContrat(etat.contratId);
        afficherSucces('Paiement modifié.', $('#vue-fiche-contrat'));
        return;
      }
      await chargerEcheances();
      if (resultat.prochaineEcheance) {
        afficherSucces(
          `Échéance encaissée. Prochaine échéance : ${formaterDate(resultat.prochaineEcheance.date_echeance)}.`,
          $('#vue-echeances')
        );
      } else if (resultat.statutEcheance === 'payee') {
        afficherSucces('Échéance entièrement encaissée.', $('#vue-echeances'));
      } else {
        afficherSucces('Encaissement partiel enregistré sur cette échéance.', $('#vue-echeances'));
      }
    });
  });

  $('#formulaire-echeance').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      await api(`/api/echeances/${etat.edition.echeance}`, {
        method: 'PUT', body: JSON.stringify({
          dateEcheance: $('#echeance-date').value,
          montant: Number($('#echeance-montant').value),
          statut: $('#echeance-statut').value,
        }),
      });
      $('#modale-echeance').close();
      await ouvrirFicheContrat(etat.contratId);
      afficherSucces('Échéance modifiée.', $('#vue-fiche-contrat'));
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

  $('#formulaire-utilisateur').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      const id = etat.edition.utilisateur;
      await api(id ? `/api/superadmin/utilisateurs/${id}` : '/api/superadmin/utilisateurs', {
        method: id ? 'PUT' : 'POST', body: JSON.stringify({
          nom: $('#utilisateur-nom').value.trim(), email: $('#utilisateur-email').value.trim(),
          role: $('#utilisateur-role').value, superAdmin: $('#utilisateur-super-admin').checked,
          motDePasse: id ? undefined : $('#utilisateur-mot-de-passe').value,
        }),
      });
      $('#modale-utilisateur').close(); await chargerUtilisateurs();
    });
  });

  $('#formulaire-mot-de-passe').addEventListener('submit', (event) => {
    event.preventDefault();
    soumettre(event.currentTarget, async () => {
      await api(`/api/superadmin/utilisateurs/${etat.edition.utilisateur}/mot-de-passe`, {
        method: 'PUT', body: JSON.stringify({ motDePasse: $('#nouveau-mot-de-passe').value }),
      });
      $('#modale-mot-de-passe').close();
      afficherSucces('Mot de passe modifié.', $('#vue-superadmin'));
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
  document.addEventListener('change', async (event) => {
    const controle = event.target.closest('input[data-retour-feuille-id]');
    if (!controle) return;
    const groupe = controle.closest('.controle-retour-feuille');
    const valeurPrecedente = !controle.checked;
    $$('input', groupe).forEach((input) => { input.disabled = true; });
    try {
      await api(`/api/contrats/${controle.dataset.retourFeuilleId}/retour-feuille-caisse`, {
        method: 'PATCH', body: JSON.stringify({ retourFeuilleCaisse: controle.checked }),
      });
      afficherSucces('Retour feuille de caisse mis à jour.', $('#vue-contrats'));
    } catch (erreur) {
      controle.checked = valeurPrecedente;
      afficherErreur(erreur.message, $('#vue-contrats'));
    } finally {
      $$('input', groupe).forEach((input) => { input.disabled = !peutEcrire(); });
    }
  });
  $$('[data-vue]').forEach((bouton) => bouton.addEventListener('click', () => changerVue(bouton.dataset.vue)));
  $$('[data-fermer-modale]').forEach((bouton) => bouton.addEventListener('click', () => bouton.closest('dialog').close()));
  $$('dialog').forEach((dialogue) => dialogue.addEventListener('click', (event) => {
    if (event.target === dialogue) dialogue.close();
  }));
  ['#filtre-fenetre', '#filtre-niveau', '#filtre-compagnie-echeance']
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
  ['#filtre-action-journal', '#filtre-table-journal']
    .forEach((id) => $(id).addEventListener('change', () => {
      etat.pages.journal = 1;
      chargerJournal().catch((e) => afficherErreur(e.message));
    }));
  $('#filtre-recherche-journal').addEventListener('input', debounce(() => {
    etat.pages.journal = 1;
    chargerJournal().catch((e) => afficherErreur(e.message));
  }));
  $('#bouton-nouveau-client').addEventListener('click', () => ouvrirModaleClient());
  $('#bouton-nouveau-contrat').addEventListener('click', () => ouvrirModaleContrat().catch((e) => afficherErreur(e.message)));
  $('#bouton-nouvelle-compagnie').addEventListener('click', () => ouvrirModaleCompagnie());
  $('#bouton-nouveau-produit').addEventListener('click', () => ouvrirModaleProduit());
  $('#contrat-prime').addEventListener('input', actualiserResumePrimeAvenant);
  ['#filtre-comptabilite-du', '#filtre-comptabilite-au'].forEach((id) => $(id).addEventListener('change', async () => {
    etat.pages.comptabilite = 1;
    etat.moisComptabilite = null;
    try {
      await chargerComptabilite();
      await chargerPaiementsComptabilite();
    } catch (erreur) { afficherErreur(erreur.message); }
  }));
  $('#client-type').addEventListener('change', () => {
    const physique = $('#client-type').value === 'personne_physique';
    $('#zone-client-date-naissance').hidden = !physique;
    if (!physique) $('#client-date-naissance').value = '';
  });
  $('#contrat-date-effet').addEventListener('change', () => {
    actualiserContrainteDateFin();
    calculerDateEcheance();
  });
  $('#contrat-fractionnement').addEventListener('change', calculerDateEcheance);
  $('#contrat-type-duree').addEventListener('change', appliquerReglesDureeContrat);
  $$('input[name="encaissement-feuille-caisse"]').forEach((radio) => {
    radio.addEventListener('change', appliquerReglesFeuilleCaisseEncaissement);
  });
  $('#contrat-client').addEventListener('change', () => {
    if (!etat.edition.contrat) {
      $('#contrat-souscripteur').value = $('#contrat-client').value;
      synchroniserSelectRecherchable($('#contrat-souscripteur'));
    }
  });
  brancherFormulaires();
}

async function initialiser() {
  initialiserSelectsRecherchables();
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
