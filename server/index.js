/**
 * Animateur de Photos Produit — serveur HTTP.
 *
 * Expose l'interface, l'API de production et la diffusion de l'avancement.
 * Le serveur n'ecoute que sur la boucle locale par defaut : les videos et les
 * cles API ne doivent pas sortir de la machine.
 */
import express from 'express';
import multer from 'multer';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AMBIANCES,
  ASPECT_RATIOS,
  DURATIONS,
  HOST,
  LIMITS,
  MODELS,
  OUTPUT_DIR,
  PORT,
  PUBLIC_DIR,
  RESOLUTIONS,
  ROOT,
  TEXT_MODES,
  UPLOAD_DIR,
  VIDEO_TYPES,
  findById,
  getApiKey,
  getOptions,
  hasApiKey,
  setApiKey,
} from './config.js';
import { boldFontPath, ffmpegPath, run as runFfmpeg } from './ffmpeg.js';
import { createJob, getJob, listJobs, publicView, subscribe, updateJob } from './jobs.js';
import { runJob } from './pipeline.js';
import { veoConfigured, verifyApiKey } from './veo.js';
import { describePlan } from './prompts.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

await mkdir(UPLOAD_DIR, { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: LIMITS.uploadMaxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (LIMITS.acceptedMime.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Format d’image non supporté. Utilisez un JPEG, un PNG ou un WebP.'));
  },
}).single('photo');

/** Enveloppe multer pour renvoyer une erreur JSON propre. */
const handleUpload = (req, res, next) =>
  upload(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `Photo trop lourde (maximum ${Math.round(LIMITS.uploadMaxBytes / 1048576)} Mo).`
        : err.message || 'Envoi de la photo impossible.';
    res.status(400).json({ error: message });
  });

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */
const cleanText = (value, max) =>
  String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function readForm(req, { sourcePath = null } = {}) {
  const productName = cleanText(req.body.productName, LIMITS.productNameMax);
  const adMessage = cleanText(req.body.adMessage, LIMITS.adMessageMax);
  const textModeId = findById(TEXT_MODES, req.body.textModeId) ? req.body.textModeId : TEXT_MODES[0].id;

  const errors = [];
  if (!productName) errors.push('Le nom du produit est obligatoire.');
  if (!adMessage && textModeId === 'veo') {
    errors.push('Le message publicitaire est obligatoire pour un texte généré par Veo.');
  }

  const videoTypeId = findById(VIDEO_TYPES, req.body.videoTypeId)?.id || VIDEO_TYPES[0].id;
  const ambianceId = findById(AMBIANCES, req.body.ambianceId)?.id || AMBIANCES[0].id;
  const durationId = findById(DURATIONS, req.body.durationId)?.id || DURATIONS[1].id;
  const modelId = findById(MODELS, req.body.model)?.id || MODELS[0].id;
  const aspectRatio = findById(ASPECT_RATIOS, req.body.aspectRatio)?.id || 'auto';
  const resolution = findById(RESOLUTIONS, req.body.resolution)?.id || '720p';

  const seedRaw = Number.parseInt(req.body.seed, 10);
  const seed = Number.isInteger(seedRaw) && seedRaw >= 0 ? seedRaw : null;

  // `mode: 'demo'` force un rendu local : utilisé comme repli quand Veo refuse
  // la requête (quota, accès), pour ne pas laisser l'utilisateur bloqué.
  const demoRequested = req.body.mode === 'demo';

  return {
    input: {
      productName,
      adMessage,
      videoTypeId,
      ambianceId,
      durationId,
      textModeId,
      aspectRatio,
      resolution,
      model: modelId,
      seed,
      sourcePath,
      useVeo: hasApiKey() && !demoRequested,
      demoRequested,
    },
    errors,
  };
}

/* ------------------------------------------------------------------ *
 * API
 * ------------------------------------------------------------------ */
app.get('/api/health', (req, res) => {
  let ffmpegOk = false;
  try {
    ffmpegOk = Boolean(ffmpegPath());
  } catch {
    ffmpegOk = false;
  }
  res.json({
    ok: true,
    veo: veoConfigured(),
    apiKey: hasApiKey(),
    mode: veoConfigured() ? 'veo' : 'demo',
    ffmpeg: ffmpegOk,
    ffmpegPath: ffmpegPath(),
    font: boldFontPath(),
    limits: LIMITS,
  });
});

app.get('/api/options', (req, res) => res.json(getOptions()));

/** Enregistre la cle API Gemini (conservée cote serveur, jamais renvoyee). */
app.post('/api/settings/api-key', async (req, res) => {
  const key = String(req.body?.apiKey || '').trim();
  if (!key) return res.status(400).json({ error: 'Clé API vide.' });

  const previous = getApiKey();
  setApiKey(key);

  // On ne rejette la cle que si Google la refuse explicitement : une erreur
  // d'acces Veo (facturation, region) ne doit pas bloquer la saisie.
  let warning = null;
  try {
    await verifyApiKey();
  } catch (err) {
    if (/Clé API refusée/.test(err.message)) {
      setApiKey(previous);
      return res.status(400).json({ error: err.message, hint: err.hint, details: err.details });
    }
    warning = err.details ? `${err.message} (${String(err.details).slice(0, 200)})` : err.message;
  }

  // Persiste la cle dans .env pour les prochains demarrages.
  try {
    const envPath = path.join(ROOT, '.env');
    let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    if (/^GEMINI_API_KEY=/m.test(content)) {
      content = content.replace(/^GEMINI_API_KEY=.*$/m, `GEMINI_API_KEY=${key}`);
    } else {
      content += `${!content || content.endsWith('\n') ? '' : '\n'}GEMINI_API_KEY=${key}\n`;
    }
    await writeFile(envPath, content, 'utf8');
  } catch {
    /* la cle reste active en memoire meme si .env n'est pas inscriptible */
  }

  res.json({ ok: true, veo: true, warning });
});

/** Supprime la cle API de la memoire (mode demo). */
app.post('/api/settings/api-key/clear', (req, res) => {
  setApiKey('');
  res.json({ ok: true, mode: 'demo' });
});

/** Test de cle sans enregistrement. */
app.post('/api/settings/api-key/test', async (req, res) => {
  const key = String(req.body?.apiKey || '').trim();
  const previous = getApiKey();
  setApiKey(key);
  try {
    await verifyApiKey();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message, hint: err.hint, details: err.details });
  } finally {
    setApiKey(previous);
  }
});

/** Estimation affichee avant lancement (nombre d'appels Veo, duree cible). */
app.get('/api/plan', (req, res) => {
  const durationId = findById(DURATIONS, String(req.query.duration || ''))?.id || DURATIONS[1].id;
  const modelId = findById(MODELS, String(req.query.model || ''))?.id || MODELS[0].id;
  res.json(
    describePlan({
      durationId,
      modelId,
      resolution: findById(RESOLUTIONS, String(req.query.resolution || ''))?.id || '720p',
    }),
  );
});

/** Cree une tache de production. */
app.post('/api/jobs', handleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Ajoutez une photo de produit.' });
  }

  const { input, errors } = readForm(req, { sourcePath: req.file.path });
  if (errors.length) {
    await rm(req.file.path, { force: true }).catch(() => {});
    return res.status(400).json({ error: errors.join(' ') });
  }

  const job = createJob(input);
  res.status(202).json({ job: publicView(job) });

  // La production continue meme si le client se deconnecte.
  setImmediate(() => {
    runJob(job).catch(() => {
      /* les erreurs sont deja journalisees dans la tache */
    });
  });
});

app.get('/api/jobs', (req, res) => res.json({ jobs: listJobs() }));

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche inconnue.' });
  res.json({ job: publicView(job) });
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche inconnue.' });
  subscribe(job, req, res);
});

/** Photo source (apercu et habillage cote client). */
app.get('/api/jobs/:id/source', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche inconnue.' });
  res.sendFile(path.resolve(job.input.sourcePath), { headers: { 'Cache-Control': 'private, max-age=3600' } });
});

app.get('/api/jobs/:id/video', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche inconnue.' });
  if (job.status !== 'done') return res.status(409).json({ error: 'Vidéo pas encore disponible.' });

  const file = path.join(job.dir, 'final.mp4');
  if (!existsSync(file)) return res.status(410).json({ error: 'Vidéo supprimée ou expirée.' });

  const headers = { 'Content-Type': 'video/mp4', 'Cache-Control': 'private, max-age=86400' };
  if (req.query.download) {
    const safeName = slug(job.input.productName) || 'video-produit';
    headers['Content-Disposition'] = `attachment; filename="${safeName}-${job.input.durationId}s.mp4"`;
  }
  res.sendFile(file, { headers, acceptRanges: true });
});

app.get('/api/jobs/:id/poster', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche inconnue.' });
  const file = path.join(job.dir, 'poster.jpg');
  if (existsSync(file)) return res.sendFile(file);
  return res.sendFile(path.resolve(job.input.sourcePath));
});

app.get('/api/jobs/:id/meta', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Tâche inconnue.' });
  const file = path.join(job.dir, 'meta.json');
  if (!existsSync(file)) return res.status(409).json({ error: 'Métadonnées indisponibles.' });
  res.sendFile(file);
});

/** Relance une production a partir de la meme photo.
 *  Chaque appel Veo est facture : l'interface demande confirmation.
 */
app.post('/api/jobs/:id/retry', async (req, res) => {
  const previous = getJob(req.params.id);
  if (!previous) return res.status(404).json({ error: 'Tâche inconnue.' });
  if (!existsSync(previous.input.sourcePath)) {
    return res.status(410).json({ error: 'Photo source indisponible, envoyez-la de nouveau.' });
  }

  const { input, errors } = readForm(
    { body: { ...previous.input, ...req.body } },
    { sourcePath: previous.input.sourcePath },
  );
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const job = createJob(input);
  res.status(202).json({ job: publicView(job) });
  setImmediate(() => runJob(job).catch(() => {}));
});

/** Diagnostic ffmpeg (verifie que la post-production est operationnelle). */
app.get('/api/diagnostics', async (req, res) => {
  const result = {
    ffmpeg: { path: ffmpegPath(), ok: false, version: null, error: null },
    font: boldFontPath(),
  };
  try {
    const { log } = await runFfmpeg(['-version'], {
      logPath: path.join(OUTPUT_DIR, 'ffmpeg-check.log'),
      cwd: OUTPUT_DIR,
      timeoutMs: 30_000,
    });
    result.ffmpeg.ok = true;
    result.ffmpeg.version = String(log || '').split('\n')[0] || 'version inconnue';
  } catch (err) {
    result.ffmpeg.error = err.message;
    result.ffmpeg.log = (err.log || '').slice(-1500);
  }
  res.json(result);
});

/* ------------------------------------------------------------------ *
 * Interface
 * ------------------------------------------------------------------ */
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use((req, res) => res.status(404).json({ error: 'Ressource introuvable.' }));

app.use((err, req, res, _next) => {
  console.error('[erreur]', err);
  res.status(500).json({ error: 'Erreur interne du serveur.', details: err.message });
});

const slug = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);

app.listen(PORT, HOST, () => {
  const mode = veoConfigured() ? 'Veo (API Gemini)' : 'démo local (aucune clé API)';
  console.log('');
  console.log('  ▸ Animateur de Photos Produit');
  console.log(`    Interface   http://${HOST}:${PORT}`);
  console.log(`    Mode        ${mode}`);
  console.log(`    ffmpeg      ${ffmpegPath()}`);
  console.log('');
  if (!veoConfigured()) {
    console.log('    Astuce : cliquez sur « Réglages » dans l’interface pour ajouter');
    console.log('    votre clé API Gemini et activer la génération Veo.');
    console.log('');
  }
});

export { app };
