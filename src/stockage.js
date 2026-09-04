const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');

const PILOTE = (process.env.STOCKAGE_DRIVER
  || (process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'local')).toLowerCase();
const RACINE_LOCALE = path.join(__dirname, '..', 'uploads', 'contrats');

let clientS3;
let clientVercelBlob;
if (PILOTE === 's3') {
  if (!process.env.S3_BUCKET || !process.env.S3_REGION) {
    throw new Error('S3_BUCKET et S3_REGION sont obligatoires avec STOCKAGE_DRIVER=s3.');
  }
  clientS3 = new S3Client({
    region: process.env.S3_REGION,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
} else if (PILOTE === 'vercel-blob') {
  clientVercelBlob = require('@vercel/blob');
} else if (PILOTE !== 'local') {
  throw new Error(`Pilote de stockage inconnu : ${PILOTE}`);
}

function verifierStockageVercel() {
  if (PILOTE === 'local' && process.env.VERCEL) {
    const erreur = new Error('Le stockage des pièces jointes n’est pas configuré sur Vercel. Ajoutez un stockage Blob privé au projet.');
    erreur.status = 503;
    throw erreur;
  }
  if (PILOTE === 'vercel-blob' && !process.env.BLOB_READ_WRITE_TOKEN) {
    const erreur = new Error('La variable BLOB_READ_WRITE_TOKEN est absente. Reconnectez le stockage Blob au projet Vercel.');
    erreur.status = 503;
    throw erreur;
  }
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
  verifierStockageVercel();
  if (PILOTE === 'vercel-blob') {
    await clientVercelBlob.put(cle, contenu, {
      access: 'private',
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: typeMime,
    });
    return;
  }
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
  verifierStockageVercel();
  if (PILOTE === 'vercel-blob') {
    const objet = await clientVercelBlob.get(cle, { access: 'private' });
    if (!objet || objet.statusCode !== 200) {
      const erreur = new Error('Pièce jointe introuvable dans le stockage.');
      erreur.status = 404;
      throw erreur;
    }
    return {
      flux: Readable.fromWeb(objet.stream),
      taille: objet.blob.size,
      typeMime: objet.blob.contentType,
    };
  }
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
  verifierStockageVercel();
  if (PILOTE === 'vercel-blob') {
    await clientVercelBlob.del(cle);
    return;
  }
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
