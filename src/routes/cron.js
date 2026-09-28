'use strict';

const express = require('express');
const { executerNotificationsSms } = require('../notifications-sms');

const routeur = express.Router();

routeur.get('/notifications-sms', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.get('authorization') !== `Bearer ${secret}`) {
    return res.status(401).json({ erreur: 'Accès refusé.' });
  }
  try {
    return res.json({ ok: true, ...(await executerNotificationsSms()) });
  } catch (erreur) {
    console.error('[cron.notifications-sms]', erreur);
    return res.status(500).json({ ok: false, erreur: 'Échec du traitement des notifications SMS.' });
  }
});

module.exports = routeur;
