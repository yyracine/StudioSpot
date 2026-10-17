/**
 * Fournisseur fal.ai (file d'attente « queue.fal.run »).
 *
 * Cycle d'un appel :
 *   1. POST https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3
 *      → { upload_url, file_url }        puis PUT des octets sur upload_url
 *   2. POST https://queue.fal.run/<model-id>  → { request_id, status_url, response_url }
 *   3. GET  <status_url>  → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
 *   4. GET  <response_url> → { video: { url }, seed }
 *   5. téléchargement du mp4
 *
 * Authentification : en-tête `Authorization: Key <FAL_KEY>`.
 *
 * Points vérifiés sur le schéma OpenAPI publié par fal pour le modèle
 * `fal-ai/wan-i2v` (voir scripts/check-provider-schema.mjs) :
 *   - l'image attendue s'appelle bien `image_url` et elle est REQUISE ;
 *   - `resolution` n'accepte que « 480p » ou « 720p » (pas de 1080p) ;
 *   - il n'existe AUCUN paramètre `duration` : la durée se pilote par
 *     `num_frames` (81 à 100) et `frames_per_second` (5 à 24).
 *     Par défaut 81 images à 16 i/s, soit environ 5,06 s.
 *
 * Particularité : ces modèles n'ont ni audio natif ni rendu de texte.
 * L'habillage texte est incrusté par ffmpeg et la bande son ajoutée en local.
 */
import { readFile } from 'node:fs/promises';
import { getKey, hasKey } from '../config.js';
import { ProviderError, downloadTo, fetchJson, findVideoUrl, mimeFor, pollUntil } from './http.js';

const QUEUE_BASE = 'https://queue.fal.run';
const REST_BASE = 'https://rest.fal.ai';
const POLL_INTERVAL_MS = 4000;

/** Bornes imposées par le modèle (schéma OpenAPI). */
const MIN_FRAMES = 81;
const MAX_FRAMES = 100;
const MIN_FPS = 5;
const MAX_FPS = 24;

const model = () => process.env.FAL_MODEL || 'fal-ai/wan-i2v';
const framesPerSecond = () => {
  const value = Number(process.env.FAL_FRAMES_PER_SECOND || 16);
  return Number.isFinite(value) ? Math.min(MAX_FPS, Math.max(MIN_FPS, value)) : 16;
};

/** Nombre d'images visant une durée cible, borné à ce que le modèle accepte. */
const framesFor = (targetSeconds) => {
  const raw = Math.round(targetSeconds * framesPerSecond());
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, raw));
};

/** Durée réellement atteignable par le modèle, en secondes. */
const clipSeconds = () => Number(process.env.FAL_CLIP_SECONDS || framesFor(5) / framesPerSecond());

const credentials = () => {
  const key = getKey('fal');
  if (!key) {
    throw new ProviderError('Aucune clé API fal.ai configurée.', {
      hint: 'Créez une clé sur https://fal.ai/dashboard/keys puis renseignez-la dans les réglages.',
    });
  }
  return { 'Content-Type': 'application/json', Authorization: `Key ${key}` };
};

const round2 = (value) => Math.round(value * 100) / 100;

export default {
  id: 'fal',
  label: 'fal.ai (Wan, Kling, LTX…)',
  shortLabel: 'fal.ai',
  docsUrl: 'https://docs.fal.ai/model-endpoints/queue',
  keyProvider: 'fal',
  keyLabel: 'Clé API fal.ai',
  note:
    'Des crédits sont offerts à l’inscription. Modèles ouverts (Wan, LTX) ou propriétaires (Kling, Hailuo), ' +
    'facturés à la seconde. Pas d’audio natif ni de texte rendu : c’est ffmpeg qui s’en charge.',

  capabilities: {
    nativeAudio: false,
    rendersText: false,
    extension: false,
    aspectRatios: ['16:9', '9:16'],
    // Ce modèle ne produit que du 480p ou du 720p : pas de 1080p.
    resolutions: ['720p'],
  },

  isConfigured: () => hasKey('fal'),

  /**
   * La durée se pilote par le nombre d'images et la cadence, pas par une
   * seconde cible. Le plan annonce donc la durée RÉELLEMENT atteignable, et
   * signale soit une limitation, soit une coupe de précision.
   */
  buildPlan({ durationId, aspectRatio, resolution }) {
    const requested = Number(durationId) || 8;
    const fps = framesPerSecond();
    const frames = framesFor(requested);
    const achievable = frames / fps;

    const limitedTo = achievable < requested - 0.05 ? round2(achievable) : null;
    const trimTo = achievable > requested + 0.05 ? requested : null;
    const downgraded = resolution === '1080p';

    const parts = [`${frames} images à ${fps} i/s, soit ${round2(achievable)} s.`];
    if (limitedTo) {
      parts.push(`Ce modèle est plafonné à ${MAX_FRAMES} images : la durée est ramenée de ${requested} s à ${round2(achievable)} s.`);
    }
    if (trimTo) parts.push(`Coupé précisément à ${requested} s.`);
    if (downgraded) parts.push('Le 1080p n’est pas proposé par ce modèle : la vidéo sera en 720p.');

    return {
      seconds: round2(achievable),
      steps: [{ kind: 'generate', seconds: round2(achievable) }],
      trimTo,
      aspectRatio,
      resolution: '720p',
      calls: 1,
      frames,
      framesPerSecond: fps,
      note: parts.join(' '),
      limitedTo,
    };
  },

  buildConfig(plan) {
    return {
      durationSeconds: plan.seconds,
      aspectRatio: plan.aspectRatio,
      resolution: plan.resolution,
      numFrames: plan.frames,
      framesPerSecond: plan.framesPerSecond,
    };
  },

  /**
   * Corps envoyé au modèle : uniquement des champs déclarés par son schéma.
   * Toute clé inconnue serait rejetée par l'API.
   */
  buildBody({ prompt, plan, imageUrl }) {
    return {
      prompt,
      image_url: imageUrl,
      aspect_ratio: plan.aspectRatio,
      resolution: plan.resolution,
      num_frames: plan.frames,
      frames_per_second: plan.framesPerSecond,
    };
  },

  /**
   * Téléverse l'image sur le stockage fal et renvoie son URL publique.
   * `image_url` attend une URL : on ne peut pas se contenter d'un data URI.
   */
  async uploadImage(imagePath) {
    const auth = credentials();
    const contentType = mimeFor(imagePath);
    const fileName = `produit-${Date.now()}.${contentType.split('/')[1] || 'jpg'}`;

    const initiated = await fetchJson(
      `${REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3`,
      { method: 'POST', headers: auth, body: { content_type: contentType, file_name: fileName } },
    );

    const uploadUrl = initiated?.upload_url;
    const fileUrl = initiated?.file_url;
    if (!uploadUrl || !fileUrl) {
      throw new ProviderError('fal.ai n’a pas renvoyé d’URL de téléversement.', {
        details: JSON.stringify(initiated).slice(0, 400),
      });
    }

    const bytes = await readFile(imagePath);
    let response;
    try {
      response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: bytes,
      });
    } catch (err) {
      throw new ProviderError('Téléversement de la photo vers fal.ai impossible.', {
        details: err.message,
      });
    }

    if (!response.ok) {
      throw new ProviderError(`fal.ai a refusé la photo (HTTP ${response.status}).`, {
        details: (await response.text().catch(() => '')).slice(0, 300),
      });
    }

    return fileUrl;
  },

  async generateClip({ imagePath, prompt, plan, outputPath, onProgress, stageLabel }) {
    const headers = credentials();
    const endpoint = `${QUEUE_BASE}/${model()}`;

    const imageUrl = await this.uploadImage(imagePath);
    const body = this.buildBody({ prompt, plan, imageUrl });

    const submitted = await fetchJson(endpoint, { method: 'POST', headers, body });
    const requestId = submitted?.request_id;
    if (!requestId) {
      throw new ProviderError('fal.ai n’a pas renvoyé d’identifiant de requête.', {
        details: JSON.stringify(submitted).slice(0, 400),
      });
    }

    const statusUrl = submitted.status_url || `${endpoint}/requests/${requestId}/status`;
    const responseUrl = submitted.response_url || `${endpoint}/requests/${requestId}`;

    const payload = await pollUntil({
      label: stageLabel,
      intervalMs: POLL_INTERVAL_MS,
      onProgress,
      step: async () => {
        const status = await fetchJson(statusUrl, { headers });
        const state = status?.status;

        if (state === 'COMPLETED') {
          // La charge utile n'est disponible qu'une fois l'état COMPLETED.
          return { done: true, result: await fetchJson(responseUrl, { headers }) };
        }
        if (state && !['IN_QUEUE', 'IN_PROGRESS'].includes(state)) {
          throw new ProviderError(`fal.ai a renvoyé l’état « ${state} ».`, {
            details: JSON.stringify(status).slice(0, 400),
          });
        }
        return { done: false };
      },
    });

    const videoUrl = findVideoUrl(payload);
    if (!videoUrl) {
      throw new ProviderError('fal.ai n’a renvoyé aucune vidéo exploitable.', {
        details: JSON.stringify(payload).slice(0, 500),
      });
    }

    await downloadTo(videoUrl, outputPath);
    return { outputPath, ref: null };
  },

  describeRequest({ plan, prompt }) {
    const endpoint = `${QUEUE_BASE}/${model()}`;
    return {
      transport: 'HTTP (file d’attente queue.fal.run)',
      etape1_televersement: {
        method: 'POST',
        url: `${REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3`,
        headers: { Authorization: 'Key <FAL_KEY>', 'Content-Type': 'application/json' },
        body: { content_type: 'image/jpeg', file_name: 'produit-<horodatage>.jpg' },
        puis: 'PUT <upload_url> avec les octets de l’image',
      },
      etape2_generation: {
        method: 'POST',
        url: endpoint,
        headers: { Authorization: 'Key <FAL_KEY>', 'Content-Type': 'application/json' },
        body: this.buildBody({ prompt, plan, imageUrl: '<file_url renvoyé par fal>' }),
      },
      suivi: [`GET ${endpoint}/requests/<request_id>/status`, `GET ${endpoint}/requests/<request_id>`],
    };
  },
};
