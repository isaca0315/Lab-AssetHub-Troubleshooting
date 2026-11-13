'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { Pool } = require('pg');
const { version } = require('./package.json');

const PORT = Number(process.env.APP_PORT || 3000);
const S3_ENDPOINT = process.env.S3_ENDPOINT;
const S3_BUCKET = process.env.S3_BUCKET;

// pg toma PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE del entorno.
const db = new Pool();

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION || 'garage',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_KEY,
  },
});

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR }),
  limits: { fileSize: 512 * 1024 * 1024 },
});

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`);
  });
  next();
});

app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', version, s3_endpoint: S3_ENDPOINT, bucket: S3_BUCKET });
  } catch (err) {
    res.status(503).json({ status: 'db_unreachable', error: err.message });
  }
});

app.get('/files', async (_req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, original_name, s3_key, size_bytes, uploaded_at FROM assets_v2 ORDER BY id DESC LIMIT 50'
    );
    res.json(rows);
  } catch (err) {
    console.error(`[files] fallo consultando assets_v2: code=${err.code || err.name} message=${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el campo "file" (multipart/form-data)' });
  }

  const key = `${Date.now()}-${path.basename(req.file.originalname)}`;

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: fs.createReadStream(req.file.path),
        ContentLength: req.file.size,
        ContentType: req.file.mimetype,
      })
    );
  } catch (err) {
    console.error(
      `[upload] fallo subiendo a S3 endpoint=${S3_ENDPOINT} bucket=${S3_BUCKET} ` +
        `code=${err.Code || err.code || err.name} message=${err.message}`
    );
    return res.status(500).json({ error: 'Error interno al subir el archivo', stage: 's3', detail: err.message });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO assets_v2 (original_name, s3_key, size_bytes)
       VALUES ($1, $2, $3)
       RETURNING id, original_name, s3_key, size_bytes, uploaded_at`,
      [req.file.originalname, key, req.file.size]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    // El objeto ya está en S3: sin metadatos queda huérfano.
    console.error(
      `[upload] fallo guardando metadatos en Postgres tabla=assets_v2 ` +
        `code=${err.code || err.name} message=${err.message}`
    );
    res.status(500).json({ error: 'Error interno al guardar metadatos', stage: 'db', detail: err.message });
  }
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  console.error(`[unhandled] ${err.stack || err}`);
  res.status(500).json({ error: 'Error interno' });
});

async function initDb() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS assets (
          id BIGSERIAL PRIMARY KEY,
          original_name TEXT NOT NULL,
          s3_key TEXT NOT NULL,
          size_bytes BIGINT NOT NULL,
          uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `);
      return;
    } catch (err) {
      console.error(`[db] intento ${attempt}/10 fallido: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('PostgreSQL no disponible tras 10 intentos');
}

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[app] AssetHub ${version} escuchando en :${PORT} | S3 endpoint: ${S3_ENDPOINT}`);
    });
  })
  .catch((err) => {
    console.error(`[app] no pudo inicializar: ${err.message}`);
    process.exit(1);
  });
