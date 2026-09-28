'use strict';

const { pool } = require('./db');

const DECLENCHEURS = new Map([[30, 'J-30'], [15, 'J-15'], [5, 'J-5']]);

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
  return apiKey ? { apiKey } : null;
}

async function envoyerAvecWinSms({ telephone, message }) {
  const config = configurationWinSms();
  if (!config) return { configure: false };
  const reponse = await fetch(
    'https://api.winsms.co.za/api/rest/v1/sms/outgoing/send',
    {
      method: 'POST',
      headers: {
        AUTHORIZATION: config.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message,
        recipients: [{ mobileNumber: telephone.replace(/^\+/, '') }],
        maxSegments: 1,
      }),
    }
  );
  const resultat = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw new Error(resultat.errorMessage || `WinSMS HTTP ${reponse.status}`);
  const destinataire = resultat.recipients?.[0];
  if (!destinataire?.accepted) {
    throw new Error(destinataire?.acceptError || 'Message refusé par WinSMS.');
  }
  return { configure: true, id: String(destinataire.apiMessageId) };
}

async function preparerNotifications(client) {
  const aujourdHui = await client.query("select (now() at time zone 'Africa/Tunis')::date as date");
  const date = aujourdHui.rows[0].date;
  const echeances = await client.query(
    `select e.id as echeance_id, e.date_echeance, c.id as contrat_id, c.numero_contrat,
            cl.id as client_id, cl.nom, cl.telephone
     from echeances e
     join contrats c on c.id = e.contrat_id and c.supprime_le is null and c.statut = 'en_cours'
     join clients cl on cl.id = coalesce(c.payeur_id, c.souscripteur_id, c.client_id)
       and cl.supprime_le is null and cl.sms_autorise
     where e.supprime_le is null and e.statut <> 'payee'
       and (e.date_echeance - $1::date) in (30, 15, 5)`,
    [date]
  );
  let creees = 0;
  for (const ligne of echeances.rows) {
    const telephone = normaliserTelephone(ligne.telephone);
    if (!telephone) continue;
    const jours = Math.round((new Date(`${ligne.date_echeance}T00:00:00Z`) - new Date(`${date}T00:00:00Z`)) / 86400000);
    const declencheur = DECLENCHEURS.get(jours);
    const message = `Finasure : rappel, l'echeance du contrat ${ligne.numero_contrat} est prevue le ${ligne.date_echeance}.`;
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
    const message = `Finasure vous souhaite un joyeux anniversaire, ${ligne.nom}.`;
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
  envoyerAvecWinSms,
  preparerNotifications,
  executerNotificationsSms,
};
