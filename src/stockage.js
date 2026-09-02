const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const PILOTE = (process.env.STOCKAGE_DRIVER || 'local').toLowerCase();
const RACINE_LOCALE = path.join(__dirname, '..', 'uploads', 'contrats');

let clientS3;
if (PILOTE === 's3') {
  if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
    throw new Error('S3_BUCKET et S3_REGION sont obligatoires avec STOCKAGE_DRIVER=s3.');
  }
  clientS3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
} else if (PILOTE !== 'local') {
  throw new Error(`Pilote de stockage inconnu : ${PILOTE}`);
}

function nouvelleCle({ organisationId, contratId, nomOriginal }) {
  const extension = path.extname(nomOriginal).toLowerCase();
  return `organisations/${organisationId}/contrats/${contratId}/${crypto.randomUUID()}${extension}`;
}

function cheminLocal(cle) {
  const chemin = path.resolve(RACINE_LOCALE, ...cle.split('/'));
  const racine = `${path.resolve(RACINE_LOCALE)}${path.sep}`;
  if (!chemin.startsWith(racine)) throw new Error('Clé de stockage invalide.');
  return chemin;
}

async function enregistrer({ cle, contenu, typeMime }) {
  if (PILOTE === 's3') {
    await clientS3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: cle,
      Body: contenu,
      ContentType: typeMime,
      ServerSideEncryption: process.env.S3_SSE || 'AES256',
    }));
    return;
  }
  const chemin = cheminLocal(cle);
  await fs.promises.mkdir(path.dirname(chemin), { recursive: true });
  await fs.promises.writeFile(chemin, contenu, { flag: 'wx' });
}

async function lire(cle) {
  if (PILOTE === 's3') {
    const objet = await clientS3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: cle }));
    return { flux: objet.Body, taille: objet.ContentLength, typeMime: objet.ContentType };
  }
  const chemin = cheminLocal(cle);
  const informations = await fs.promises.stat(chemin);
  return { flux: fs.createReadStream(chemin), taille: informations.size };
}

async function supprimer(cle) {
  if (!cle) return;
  if (PILOTE === 's3') {
    await clientS3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: cle }));
    return;
  }
  try {
    await fs.promises.unlink(cheminLocal(cle));
  } catch (erreur) {
    if (erreur.code !== 'ENOENT') throw erreur;
  }
}

module.exports = { pilote: PILOTE, nouvelleCle, enregistrer, lire, supprimer };
