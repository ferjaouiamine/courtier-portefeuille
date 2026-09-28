'use strict';

const { pool } = require('./db');

function determinerDeclencheur(joursRestants) {
  const jours = Number(joursRestants);
  if (!Number.isInteger(jours) || jours < 0 || jours > 30) return null;
  if (jours <= 5) return 'J-5';
  if (jours <= 15) return 'J-15';
  return 'J-30';
}

function formaterDateSms(valeur) {
  const iso = String(valeur || '').slice(0, 10);
  const correspondance = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return correspondance ? `${correspondance[3]}/${correspondance[2]}/${correspondance[1]}` : iso;
}

function formaterMontantSms(valeur) {
  const montant = Number(valeur);
  if (!Number.isFinite(montant)) return String(valeur || '');
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(montant).replace(/[\u00a0\u202f]/g, ' ');
}

function construireRappelEcheance({ numeroContrat, dateEcheance, montantPrime }) {
  return `Cher client(e),\nVotre contrat d'assurance numéro ${numeroContrat} arrive à échéance le ${formaterDateSms(dateEcheance)}.\nMerci de procéder au paiement de votre prime d'assurance de ${formaterMontantSms(montantPrime)} DT.\nFinasure\n26 17 94 10 / 29 27 98 78\nEmail : contact@finasure-solutions.com`;
}

function construireMessageAnniversaire(nomClient) {
  return `🎉 Joyeux anniversaire ${nomClient} !\nToute l’équipe Finasure vous souhaite une très belle journée.\nFinasure`;
}

function normaliserTelephone(telephone) {
  const chiffres = String(telephone || '').replace(/[^\d+]/g, '');
  if (/^\d{8}$/.test(chiffres)) return `+216${chiffres}`;
  if (/^216\d{8}$/.test(chiffres)) return `+${chiffres}`;
  if (/^\+216\d{8}$/.test(chiffres)) return chiffres;
  if (/^\+[1-9]\d{7,14}$/.test(chiffres)) return chiffres;
  return null;
}

function configurationWinSms() {
  const apiKey = process.env.WINSMS_API_KEY;
  const senderId = process.env.WINSMS_SENDER_ID || 'Finasure';
  return apiKey ? { apiKey, senderId } : null;
}

function analyserReponseWinSms(texte) {
  const contenu = String(texte || '').trim();
  let resultat;
  try {
    resultat = JSON.parse(contenu);
  } catch {
    resultat = null;
  }

  const erreur = resultat?.error || resultat?.erreur || resultat?.error_message
    || resultat?.errorMessage;
  const statut = String(resultat?.status || resultat?.statut || '').toLowerCase();
  if (erreur || resultat?.success === false || ['error', 'failed', 'echec'].includes(statut)
      || /\b(error|erreur|invalid|invalide|failed|echec|refus|denied|unauthorized)\b/i.test(contenu)) {
    throw new Error(String(erreur || resultat?.message || contenu || 'Message refuse par WinSMS.'));
  }

  const reference = resultat?.ref || resultat?.reference || resultat?.id
    || resultat?.data?.ref || resultat?.data?.reference || resultat?.data?.id;
  return String(reference || contenu || `winsms-${Date.now()}`).slice(0, 255);
}

async function envoyerAvecWinSms({ telephone, message }) {
  const config = configurationWinSms();
  if (!config) return { configure: false };
  const url = new URL('https://www.winsmspro.com/sms/sms/api');
  url.search = new URLSearchParams({
    action: 'send-sms',
    api_key: config.apiKey,
    to: telephone.replace(/^\+/, ''),
    sms: message,
    from: config.senderId,
  }).toString();

  const reponse = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json, text/plain;q=0.9' },
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(texte || `WinSMS HTTP ${reponse.status}`);
  return { configure: true, id: analyserReponseWinSms(texte) };
}

async function preparerNotifications(client) {
  const aujourdHui = await client.query("select (now() at time zone 'Africa/Tunis')::date as date");
  const date = aujourdHui.rows[0].date;
  const echeances = await client.query(
    `select e.id as echeance_id, e.date_echeance, e.montant_prime,
            c.id as contrat_id, c.numero_contrat,
            cl.id as client_id, cl.nom, cl.telephone
     from echeances e
     join contrats c on c.id = e.contrat_id and c.supprime_le is null and c.statut = 'en_cours'
     join clients cl on cl.id = coalesce(c.payeur_id, c.souscripteur_id, c.client_id)
       and cl.supprime_le is null and cl.sms_autorise
     where e.supprime_le is null and e.statut <> 'payee'
       and (e.date_echeance - $1::date) between 0 and 30`,
    [date]
  );
  let creees = 0;
  for (const ligne of echeances.rows) {
    const telephone = normaliserTelephone(ligne.telephone);
    if (!telephone) continue;
    const jours = Math.round((new Date(`${ligne.date_echeance}T00:00:00Z`) - new Date(`${date}T00:00:00Z`)) / 86400000);
    const declencheur = determinerDeclencheur(jours);
    if (!declencheur) continue;
    const message = construireRappelEcheance({
      numeroContrat: ligne.numero_contrat,
      dateEcheance: ligne.date_echeance,
      montantPrime: ligne.montant_prime,
    });
    const resultat = await client.query(
      `insert into notifications_sms
         (client_id, contrat_id, echeance_id, type_notification, declencheur, date_cible, telephone, message)
       values ($1, $2, $3, 'echeance', $4, $5, $6, $7)
       on conflict do nothing returning id`,
      [ligne.client_id, ligne.contrat_id, ligne.echeance_id, declencheur, ligne.date_echeance, telephone, message]
    );
    creees += resultat.rowCount;
  }

  const anniversaires = await client.query(
    `select id as client_id, nom, telephone
     from clients
     where supprime_le is null and sms_autorise and date_naissance is not null
       and extract(month from date_naissance) = extract(month from $1::date)
       and extract(day from date_naissance) = extract(day from $1::date)`,
    [date]
  );
  for (const ligne of anniversaires.rows) {
    const telephone = normaliserTelephone(ligne.telephone);
    if (!telephone) continue;
    const message = construireMessageAnniversaire(ligne.nom);
    const resultat = await client.query(
      `insert into notifications_sms
         (client_id, type_notification, declencheur, date_cible, telephone, message)
       values ($1, 'anniversaire', 'ANNIVERSAIRE', $2, $3, $4)
       on conflict do nothing returning id`,
      [ligne.client_id, date, telephone, message]
    );
    creees += resultat.rowCount;
  }
  return creees;
}

async function traiterOrganisation(organisationId) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('app.organisation_id', $1, true)", [organisationId]);
    const creees = await preparerNotifications(client);
    const config = configurationWinSms();
    if (!config) {
      await client.query('commit');
      return { creees, envoyees: 0, echecs: 0, configurationSms: false };
    }
    const attente = await client.query(
      `select * from notifications_sms
       where statut in ('en_attente', 'echec') and tentatives < 3
       order by cree_le limit 50 for update skip locked`
    );
    let envoyees = 0;
    let echecs = 0;
    for (const notification of attente.rows) {
      await client.query(
        `update notifications_sms set statut = 'en_cours', tentatives = tentatives + 1,
             derniere_tentative = now(), erreur = null where id = $1`,
        [notification.id]
      );
      try {
        const envoi = await envoyerAvecWinSms(notification);
        await client.query(
          `update notifications_sms set statut = 'envoyee', fournisseur_id = $2,
               envoye_le = now() where id = $1`,
          [notification.id, envoi.id]
        );
        envoyees += 1;
      } catch (erreur) {
        await client.query(
          `update notifications_sms set statut = 'echec', erreur = left($2, 500) where id = $1`,
          [notification.id, erreur.message]
        );
        echecs += 1;
      }
    }
    await client.query('commit');
    return { creees, envoyees, echecs, configurationSms: true };
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  } finally {
    client.release();
  }
}

async function executerNotificationsSms() {
  const organisations = await pool.query('select id from organisations');
  const bilan = { organisations: 0, creees: 0, envoyees: 0, echecs: 0, configurationSms: true };
  for (const organisation of organisations.rows) {
    const resultat = await traiterOrganisation(organisation.id);
    bilan.organisations += 1;
    bilan.creees += resultat.creees;
    bilan.envoyees += resultat.envoyees;
    bilan.echecs += resultat.echecs;
    bilan.configurationSms &&= resultat.configurationSms;
  }
  return bilan;
}

module.exports = {
  normaliserTelephone,
  determinerDeclencheur,
  construireRappelEcheance,
  construireMessageAnniversaire,
  envoyerAvecWinSms,
  preparerNotifications,
  executerNotificationsSms,
};
