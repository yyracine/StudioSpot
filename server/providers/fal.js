/**
 * Fournisseur fal.ai (file d’attente « queue.fal.run »).
 *
 * Cycle d’un appel, d’après la documentation fal :
 *   1. POST https://queue.fal.run/<model-id>          → { request_id, status_url, response_url }
 *   2. GET  <status_url>                              → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
 *   3. GET  <response_url>                            → charge utile du modèle
 *   4. téléchargement du mp4 depuis l’URL renvoyée
 *
 * L’authentification se fait par l’en-tête `Authorization: Key <FAL_KEY>`.
 *
 * Particularité importante : les modèles fal n’ont ni audio natif ni rendu de
 * texte. L’habillage texte est donc incrusté par ffmpeg, et la bande son est
 * ajoutée localement (voir le pipeline).
 */
import { getKey, hasKey } from '../config.js';
import { ProviderError, downloadTo, fetchJson, findVideoUrl, pollUntil, toDataUri } from './http.js';

const QUEUE_BASE = 'https://queue.fal.run';
const POLL_INTERVAL_MS = 4000;

const model = () => process.env.FAL_MODEL || 'fal-ai/wan-i2v';
/** Durée d’un clip produite par le modèle choisi (propre au modèle fal). */
const clipSeconds = () => Number(process.env.FAL_CLIP_SECONDS || 5);

const credentials = () => {
  const key = getKey('fal');
  if (!key) {
    throw new ProviderError('Aucune clé API fal.ai configurée.', {
      hint: 'Créez une clé sur https://fal.ai/dashboard/keys puis renseignez-la dans les réglages.',
    });
  }
  return { 'Content-Type': 'application/json', Authorization: `Key ${key}` };
};

export default {
  id: 'fal',
  label: 'fal.ai (Wan, Kling, LTX…)',
  shortLabel: 'fal.ai',
  docsUrl: 'https://docs.fal.ai/model-endpoints/queue',
  keyProvider: 'fal',
  keyLabel: 'Clé API fal.ai',
  note:
    'Des crédits sont offerts à l’inscription. Modèles ouverts (Wan, LTX) ou propriétaires (Kling, Hailuo), ' +
    'bien moins chers à la seconde que Veo. Pas d’audio natif ni de texte rendu : c’est ffmpeg qui s’en charge.',

  capabilities: {
    nativeAudio: false,
    rendersText: false,
    extension: false,
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
  },

  isConfigured: () => hasKey('fal'),

  /**
   * Sans extension possible, la durée finale est plafonnée à ce que le modèle
   * sait produire. On le dit explicitement au lieu de faire croire à 15 s.
   */
  buildPlan({ durationId, aspectRatio, resolution }) {
    const requested = Number(durationId) || 8;
    const clip = clipSeconds();
    const finalSeconds = Math.min(requested, clip);
    const limited = requested > clip;

    return {
      seconds: finalSeconds,
      steps: [{ kind: 'generate', seconds: finalSeconds }],
      trimTo: requested < clip ? requested : null,
      aspectRatio,
      resolution: resolution === '1080p' ? '1080p' : '720p',
      calls: 1,
      note: limited
        ? `Ce modèle produit ${clip} s : la durée est ramenée de ${requested} s à ${clip} s.`
        : `Un appel fal, clip de ${finalSeconds} s.`,
      limitedTo: limited ? clip : null,
    };
  },

  buildConfig(plan) {
    return { durationSeconds: plan.steps[0].seconds, aspectRatio: plan.aspectRatio, resolution: plan.resolution };
  },

  /** Corps envoyé à fal : l’image part en data URI, comme le permettent ses API. */
  buildBody({ prompt, plan, imageDataUri }) {
    return {
      prompt,
      image_url: imageDataUri,
      aspect_ratio: plan.aspectRatio,
      resolution: plan.resolution,
    };
  },

  async generateClip({ imagePath, prompt, plan, outputPath, onProgress, stageLabel }) {
    const headers = credentials();
    const endpoint = `${QUEUE_BASE}/${model()}`;
    const imageDataUri = await toDataUri(imagePath);
    const body = this.buildBody({ prompt, plan, imageDataUri });

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
          // La charge utile du modèle n’est disponible qu’une fois l’état COMPLETED.
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
      method: 'POST',
      url: endpoint,
      headers: { Authorization: 'Key <FAL_KEY>', 'Content-Type': 'application/json' },
      body: {
        prompt,
        image_url: '<data:image/jpeg;base64,…>',
        aspect_ratio: plan.aspectRatio,
        resolution: plan.resolution,
      },
      polling: [`GET ${endpoint}/requests/<request_id>/status`, `GET ${endpoint}/requests/<request_id>`],
    };
  },
};
