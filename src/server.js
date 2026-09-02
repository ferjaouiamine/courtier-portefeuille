require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { pool } = require('./db');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // page unique servie en local, sans script externe
}));
app.use(express.json());
app.use(cookieParser());

const limiteurApi = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiteurApi);

app.get('/api/sante', async (req, res) => {
  try {
    await pool.query('select 1');
    res.json({ ok: true, base: 'connectee' });
  } catch (erreur) {
    res.status(503).json({ ok: false, erreur: 'Base de données injoignable.' });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/contrats', require('./routes/contrats'));
app.use('/api/echeances', require('./routes/echeances'));
app.use('/api', require('./routes/divers'));

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Gestionnaire d'erreurs de dernier recours : ne jamais exposer de détail technique au client.
app.use((erreur, req, res, next) => {
  console.error('[erreur non interceptée]', erreur);
  res.status(500).json({ erreur: 'Une erreur inattendue est survenue. Réessayez, et contactez le support si le problème persiste.' });
});

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => {
    console.log(`Serveur démarré sur http://localhost:${port}`);
  });
}

module.exports = app;
