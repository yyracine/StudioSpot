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
  KEY_SOURCES,
  LIMITS,
  OUTPUT_DIR,
  PORT,
  PUBLIC_DIR,
  RESOLUTIONS,
  ROOT,
  TEXT_MODES,
  UPLOAD_DIR,
  VIDEO_TYPES,
  findById,
  getKey,
  getOptions,
  hasKey,
  setKey,
} from './config.js';
import { acceptedFormats, detectKeySource } from './api-keys.js';
import { boldFontPath, ffmpegPath, run as runFfmpeg } from './ffmpeg.js';
import { createJob, getJob, listJobs, publicView, subscribe, updateJob } from './jobs.js';
import { runJob } from './pipeline.js';
import { PROVIDERS, getProvider, listProviders, resolveProvider } from './providers/index.js';
import { suggestMessages } from './suggest.js';
import { ProviderError } from './providers/http.js';

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

/**
 * Enregistre une cle dans .env pour les prochains demarrages.
 * @returns {Promise<boolean>} true si la persistance a reussi
 */
async function persistKey(keyId, value) {
  const envVar = KEY_SOURCES[keyId].envVars[0];
  try {
    const envPath = path.join(ROOT, '.env');
    let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
    const pattern = new RegExp(`^${envVar}=.*$`, 'm');

    if (pattern.test(content)) {
      content = content.replace(pattern, `${envVar}=${value}`);
    } else {
      content += `${!content || content.endsWith('\n') ? '' : '\n'}${envVar}=${value}\n`;
    }

    await writeFile(envPath, content, 'utf8');
    return true;
  } catch {
    // La cle reste active en memoire meme si .env n'est pas inscriptible.
    return false;
  }
}

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
  if (!adMessage && textModeId === 'model') {
    errors.push('Le message publicitaire est obligatoire pour un texte généré par le modèle.');
  }

  const videoTypeId = findById(VIDEO_TYPES, req.body.videoTypeId)?.id || VIDEO_TYPES[0].id;
  const ambianceId = findById(AMBIANCES, req.body.ambianceId)?.id || AMBIANCES[0].id;
  const durationId = findById(DURATIONS, req.body.durationId)?.id || DURATIONS[1].id;
  const aspectRatio = findById(ASPECT_RATIOS, req.body.aspectRatio)?.id || 'auto';
  const resolution = findById(RESOLUTIONS, req.body.resolution)?.id || '720p';

  const seedRaw = Number.parseInt(req.body.seed, 10);
  const seed = Number.isInteger(seedRaw) && seedRaw >= 0 ? seedRaw : null;

  // `mode: 'demo'` force un rendu local : utilisé comme repli quand un
  // fournisseur refuse la requête (quota, accès), pour ne pas laisser
  // l'utilisateur bloqué.
  const demoRequested = req.body.mode === 'demo';

  // Fournisseur demandé : identifiant reconnu, sinon null (choix automatique).
  const providerId = getProvider(req.body.providerId)?.id || null;

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
      providerId,
      seed,
      sourcePath,
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

  const active = resolveProvider();
  res.json({
    ok: true,
    // « provider » dès qu'un moteur distant est utilisable, sinon rendu local.
    mode: active ? 'provider' : 'demo',
    provider: active ? { id: active.id, label: active.label } : null,
    providers: listProviders(),
    keys: Object.fromEntries(
      Object.entries(KEY_SOURCES).map(([id, source]) => [
        id,
        {
          label: source.label,
          purpose: source.purpose,
          configured: hasKey(id),
          docsUrl: source.docsUrl,
        },
      ]),
    ),
    ffmpeg: ffmpegOk,
    ffmpegPath: ffmpegPath(),
    font: boldFontPath(),
    limits: LIMITS,
  });
});

app.get('/api/options', (req, res) =>
  res.json({ ...getOptions(), providers: listProviders(), keyFormats: acceptedFormats() }),
);

/**
 * Enregistre LA clé collée par l'utilisateur.
 *
 * Aucun fournisseur à choisir : la forme de la clé détermine à qui elle
 * appartient (voir server/api-keys.js). Corps : { value }.
 */
app.post('/api/settings/key', async (req, res) => {
  const value = String(req.body?.value ?? req.body?.apiKey ?? '').trim();
  if (!value) return res.status(400).json({ error: 'Clé vide.' });

  const detected = detectKeySource(value);
  if (!detected) {
    return res.status(422).json({
      error: 'Format de clé non reconnu.',
      hint: `Formes acceptées : ${acceptedFormats()
        .map((format) => `${format.label} (${format.describe})`)
        .join(' · ')}.`,
      formats: acceptedFormats(),
    });
  }

  const { source, key } = detected;
  const previous = getKey(source);
  setKey(source, key);

  // Le fournisseur associé valide la clé lorsqu'il sait le faire.
  const owner = PROVIDERS.find((provider) => provider.keyProvider === source);
  let warning = null;

  if (typeof owner?.verifyKey === 'function') {
    try {
      await owner.verifyKey();
    } catch (err) {
      // On ne rejette que si le service refuse explicitement la clé : une erreur
      // d'accès (solde, droits) ne doit pas empêcher de la saisir.
      if (/refusée/i.test(err.message)) {
        setKey(source, previous);
        return res.status(400).json({ error: err.message, hint: err.hint, details: err.details });
      }
      warning = err.details ? `${err.message} (${String(err.details).slice(0, 200)})` : err.message;
    }
  }

  const persisted = await persistKey(source, key);
  res.json({
    ok: true,
    source,
    label: KEY_SOURCES[source].label,
    purpose: KEY_SOURCES[source].purpose,
    persisted,
    warning,
  });
});

/** Retire la clé d'un fournisseur. Corps : { source }. */
app.post('/api/settings/key/clear', (req, res) => {
  const source = String(req.body?.source || req.body?.key || '').trim();
  if (!(source in KEY_SOURCES)) {
    return res.status(400).json({ error: `Source de clé inconnue : « ${source} ».` });
  }
  setKey(source, '');
  res.json({ ok: true, source });
});

/** Teste une clé sans l'enregistrer. Corps : { value }. */
app.post('/api/settings/key/test', async (req, res) => {
  const value = String(req.body?.value ?? req.body?.apiKey ?? '').trim();
  const detected = detectKeySource(value);

  if (!detected) {
    return res.status(422).json({
      error: 'Format de clé non reconnu.',
      formats: acceptedFormats(),
    });
  }

  const owner = PROVIDERS.find((provider) => provider.keyProvider === detected.source);
  if (typeof owner?.verifyKey !== 'function') {
    return res.json({
      ok: true,
      source: detected.source,
      label: detected.label,
      warning: 'Ce fournisseur ne permet pas de tester la clé sans lancer une génération.',
    });
  }

  const previous = getKey(detected.source);
  setKey(detected.source, detected.key);
  try {
    await owner.verifyKey();
    res.json({ ok: true, source: detected.source, label: detected.label });
  } catch (err) {
    res.status(400).json({ error: err.message, hint: err.hint, details: err.details });
  } finally {
    setKey(detected.source, previous);
  }
});

/** Suggestions de messages publicitaires (modele texte, gratuit). */
app.post('/api/suggest-messages', async (req, res) => {
  const videoType = findById(VIDEO_TYPES, req.body?.videoTypeId);
  const ambiance = findById(AMBIANCES, req.body?.ambianceId);
  try {
    const result = await suggestMessages({
      productName: req.body?.productName,
      videoTypeId: videoType?.id,
      videoTypeLabel: videoType?.label,
      ambianceLabel: ambiance?.label,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, hint: err.hint });
  }
});

/** Estimation affichee avant lancement : plan reel du fournisseur retenu. */
app.get('/api/plan', (req, res) => {
  const durationId = findById(DURATIONS, String(req.query.duration || ''))?.id || DURATIONS[1].id;
  const aspectRatio = findById(ASPECT_RATIOS, String(req.query.aspectRatio || ''))?.id || '16:9';
  const resolution = findById(RESOLUTIONS, String(req.query.resolution || ''))?.id || '720p';

  // `provider` absent = choix automatique ; `provider=demo` = rendu local imposé.
  const requestedId = String(req.query.provider || '').trim();
  const demoWanted = requestedId === 'demo' || String(req.query.mode || '') === 'demo';
  const requested = demoWanted ? null : getProvider(requestedId);
  const provider = demoWanted ? null : requested && requested.isConfigured() ? requested : resolveProvider();

  if (!provider) {
    const seconds = findById(DURATIONS, durationId)?.seconds || 8;
    return res.json({
      providerId: null,
      providerLabel: 'Rendu local (démonstration)',
      seconds,
      calls: 0,
      resolution: '720p',
      note: 'Rendu local : animation de la photo et habillage, sans modèle distant.',
      limitedTo: null,
      available: false,
    });
  }

  const plan = provider.buildPlan({
    durationId,
    aspectRatio: aspectRatio === 'auto' ? '16:9' : aspectRatio,
    resolution,
  });

  res.json({
    ...plan,
    providerId: provider.id,
    providerLabel: provider.label,
    available: true,
    nativeAudio: provider.capabilities.nativeAudio,
    rendersText: provider.capabilities.rendersText,
  });
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
 *  Chaque appel au moteur est facture : l'interface demande confirmation.
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
  const active = resolveProvider();
  const configured = PROVIDERS.filter((provider) => provider.isConfigured());

  console.log('');
  console.log('  ▸ Animateur de Photos Produit');
  console.log(`    Interface   http://${HOST}:${PORT}`);
  console.log(`    Moteur      ${active ? `${active.label} (${active.id})` : 'rendu local de démonstration'}`);
  console.log(
    `    Fournisseurs configurés : ${configured.length ? configured.map((p) => p.id).join(', ') : 'aucun'}`,
  );
  console.log(`    ffmpeg      ${ffmpegPath()}`);
  console.log('');

  if (!active) {
    console.log('    Astuce : cliquez sur « Réglages » dans l’interface, puis collez la clé API');
    console.log('    de votre fournisseur (elle est reconnue automatiquement).');
    console.log('');
  }
});

export { app };
