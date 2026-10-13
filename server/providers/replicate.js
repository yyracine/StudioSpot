/**
 * Fournisseur Replicate (api.replicate.com).
 *
 * Cycle d’un appel, d’après la documentation Replicate :
 *   1. POST https://api.replicate.com/v1/predictions   → { id, status, urls }
 *      corps : { version | model, input }
 *   2. GET  https://api.replicate.com/v1/predictions/<id>
 *   3. `output` contient une URL (ou un tableau d’URLs) servie par replicate.delivery
 *
 * Authentification : `Authorization: Bearer <REPLICATE_API_TOKEN>`.
 *
 * Particularité : les modèles Replicate n’ont ni audio natif ni rendu de texte
 * (comme fal) — le pipeline ajoute l’habillage et la bande son en local.
 */
import { getKey, hasKey } from '../config.js';
import { ProviderError, downloadTo, fetchJson, findVideoUrl, pollUntil, toDataUri } from './http.js';

const API = 'https://api.replicate.com/v1';
const POLL_INTERVAL_MS = 4000;

/**
 * `REPLICATE_MODEL` accepte deux formes :
 *   - « owner/nom »    → modèle public officiel, résolu par l’API ;
 *   - « owner/nom:hash » → version figée, transmise telle quelle.
 */
const modelRef = () => process.env.REPLICATE_MODEL || 'wan-video/wan-2.2-i2v-fast';
const clipSeconds = () => Number(process.env.REPLICATE_CLIP_SECONDS || 5);

const headers = () => {
  const token = getKey('replicate');
  if (!token) {
    throw new ProviderError('Aucun jeton API Replicate configuré.', {
      hint: 'Créez un jeton sur https://replicate.com/account/api-tokens puis renseignez-le dans les réglages.',
    });
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    // Demande à Replicate de renvoyer aussi les journaux : utile en cas d’échec.
    Prefer: 'return-logs',
  };
};

/** Répartit la référence du modèle entre `model` (officiel) et `version`. */
function modelPayload(reference) {
  const [name, hash] = reference.split(':');
  return hash ? { version: hash } : { model: name };
}

export default {
  id: 'replicate',
  label: 'Replicate (Wan, LTX, autres)',
  shortLabel: 'Replicate',
  docsUrl: 'https://replicate.com/docs/reference/http',
  keyProvider: 'replicate',
  keyLabel: 'Jeton API Replicate',
  note:
    'Catalogue très large, facturé à la seconde. Utile pour comparer plusieurs modèles ouverts. ' +
    'Pas d’audio natif ni de texte rendu : ffmpeg s’en charge localement.',

  capabilities: {
    nativeAudio: false,
    rendersText: false,
    extension: false,
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
  },

  isConfigured: () => hasKey('replicate'),

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
        : `Une prédiction Replicate, clip de ${finalSeconds} s.`,
      limitedTo: limited ? clip : null,
    };
  },

  buildConfig(plan) {
    return { durationSeconds: plan.steps[0].seconds, aspectRatio: plan.aspectRatio, resolution: plan.resolution };
  },

  /** Entrées du modèle : les noms les plus courants sont fournis. */
  buildInput({ prompt, plan, imageDataUri }) {
    return {
      prompt,
      image: imageDataUri,
      // Variantes acceptées selon les modèles du catalogue.
      aspect_ratio: plan.aspectRatio,
      resolution: plan.resolution,
      duration: plan.steps[0].seconds,
    };
  },

  async generateClip({ imagePath, prompt, plan, outputPath, onProgress, stageLabel }) {
    const auth = headers();
    const imageDataUri = await toDataUri(imagePath);

    const created = await fetchJson(`${API}/predictions`, {
      method: 'POST',
      headers: auth,
      body: { ...modelPayload(modelRef()), input: this.buildInput({ prompt, plan, imageDataUri }) },
    });

    const predictionId = created?.id;
    if (!predictionId) {
      throw new ProviderError('Replicate n’a pas renvoyé d’identifiant de prédiction.', {
        details: JSON.stringify(created).slice(0, 400),
      });
    }

    const pollUrl = created.urls?.get || `${API}/predictions/${predictionId}`;

    const finished = await pollUntil({
      label: stageLabel,
      intervalMs: POLL_INTERVAL_MS,
      onProgress,
      step: async () => {
        const prediction = await fetchJson(pollUrl, { headers: auth });
        const state = prediction?.status;

        if (state === 'succeeded') return { done: true, result: prediction };
        if (state === 'failed' || state === 'canceled') {
          throw new ProviderError(`La prédiction Replicate a échoué (${state}).`, {
            details: [prediction.error, prediction.logs].filter(Boolean).join('\n').slice(-800),
          });
        }
        return { done: false };
      },
    });

    const videoUrl = findVideoUrl(finished.output);
    if (!videoUrl) {
      throw new ProviderError('Replicate n’a renvoyé aucune vidéo exploitable.', {
        details: JSON.stringify(finished.output).slice(0, 500),
      });
    }

    await downloadTo(videoUrl, outputPath);
    return { outputPath, ref: null };
  },

  describeRequest({ plan, prompt }) {
    return {
      transport: 'HTTP (api.replicate.com)',
      method: 'POST',
      url: `${API}/predictions`,
      headers: {
        Authorization: 'Bearer <REPLICATE_API_TOKEN>',
        'Content-Type': 'application/json',
        Prefer: 'return-logs',
      },
      body: {
        ...modelPayload(modelRef()),
        input: {
          prompt,
          image: '<data:image/jpeg;base64,…>',
          aspect_ratio: plan.aspectRatio,
          resolution: plan.resolution,
          duration: plan.steps[0].seconds,
        },
      },
      polling: [`GET ${API}/predictions/<prediction_id>`],
    };
  },
};
