'use strict';

require('dotenv').config();
const { executerNotificationsSms } = require('../src/notifications-sms');
const { pool } = require('../src/db');

executerNotificationsSms()
  .then((bilan) => console.log(JSON.stringify(bilan, null, 2)))
  .catch((erreur) => {
    console.error('Échec des notifications SMS :', erreur.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
