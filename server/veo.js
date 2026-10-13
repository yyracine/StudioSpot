/**
 * Client Veo (API Gemini).
 *
 * Cycle reel d'une generation :
 *   1. `generateVideos` renvoie une operation longue duree (11 s a 6 min).
 *   2. On interroge l'operation jusqu'a `done`.
 *   3. On telecharge le mp4 sur le disque (Veo ne conserve les videos que 2 jours).
 *
 * Pour la duree de 15 s : on genere 8 s, puis on demande une extension de 7 s
 * a partir de la video precedente (`video`), ce qui donne exactement 15 s.
 */
import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getApiKey, hasApiKey, FORCE_DEMO } from './config.js';

const POLL_INTERVAL_MS = 10_000;
const MAX_WAIT_MS = 14 * 60 * 1000;

export class VeoError extends Error {
  constructor(message, { hint = null, cause = null, details = null } = {}) {
    super(message);
    this.name = 'VeoError';
    this.hint = hint;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

/** Indique si un appel Veo est possible. */
export const veoConfigured = () => hasApiKey() && !FORCE_DEMO;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createClient() {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new VeoError('Aucune clé API Gemini configurée.', {
      hint: 'Renseignez votre clé API Gemini (Google AI Studio) dans les réglages.',
    });
  }
  return new GoogleGenAI({ apiKey });
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

/** Traduit une erreur brute (API ou reseau) en message exploitable. */
function toVeoError(err, stage) {
  if (err instanceof VeoError) return err;
  const raw = String(err?.message || err);
  const details = err?.error?.message || err?.response?.data?.error?.message || null;

  if (/API key not valid|API_KEY_INVALID|permission|PERMISSION_DENIED|401|403/i.test(raw + details)) {
    return new VeoError('Clé API refusée par Google.', {
      hint: 'Vérifiez la clé dans les réglages. Veo nécessite un projet Google AI avec facturation activée.',
      details: details || raw,
      cause: err,
    });
  }
  if (/quota|RESOURCE_EXHAUSTED|429|rate limit/i.test(raw + details)) {
    return new VeoError('Quota Veo atteint ou débit trop élevé.', {
      hint: 'Patientez quelques minutes ou vérifiez votre palier de facturation Google AI.',
      details: details || raw,
      cause: err,
    });
  }
  if (/billing|payment|not available in your|location|region/i.test(raw + details)) {
    return new VeoError('Veo n’est pas disponible pour ce projet ou cette région.', {
      hint: 'Veo via l’API Gemini est réservé aux comptes avec facturation activée, hors régions non desservies.',
      details: details || raw,
      cause: err,
    });
  }
  return new VeoError(`Échec de l’étape « ${stage} ».`, { details: details || raw, cause: err });
}

/**
 * Genere un plan video a partir d'une image.
 *
 * @param {object} params
 * @param {string} params.imagePath  image deja normalisee
 * @param {string} params.prompt
 * @param {object} params.config      config Veo (duree, ratio, resolution…)
 * @param {string} params.model
 * @param {string} params.outputPath
 * @param {(info: {elapsedMs: number, stage: string}) => void} [params.onProgress]
 */
export async function generateClip({
  imagePath,
  prompt,
  config,
  model,
  outputPath,
  onProgress,
  stageLabel = 'Génération Veo',
}) {
  const ai = createClient();
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] || 'image/jpeg';
  const imageBytes = (await readFile(imagePath)).toString('base64');

  let operation;
  try {
    operation = await ai.models.generateVideos({
      model,
      prompt,
      image: { imageBytes, mimeType },
      config,
    });
  } catch (err) {
    throw toVeoError(err, 'envoi de la demande à Veo');
  }

  operation = await waitForOperation(ai, operation, { onProgress, stageLabel });
  const generated = extractVideo(operation);
  await download(ai, generated, outputPath);

  return { outputPath, operation, video: generated.video, promptUsed: prompt };
}

/**
 * Etend une video deja generee par Veo (+7 s, soit 15 s au total).
 * Contraintes API : la source doit etre un clip Veo de 8 s, en 720p, 16:9 ou 9:16.
 */
export async function extendClip({
  previousVideo,
  prompt,
  model,
  outputPath,
  onProgress,
  stageLabel = 'Extension Veo (+7 s)',
}) {
  const ai = createClient();

  let operation;
  try {
    operation = await ai.models.generateVideos({
      model,
      video: previousVideo,
      prompt,
      config: { numberOfVideos: 1, resolution: '720p' },
    });
  } catch (err) {
    throw toVeoError(err, 'envoi de la demande d’extension');
  }

  operation = await waitForOperation(ai, operation, { onProgress, stageLabel });
  const generated = extractVideo(operation);
  await download(ai, generated, outputPath);

  return { outputPath, operation, video: generated.video, promptUsed: prompt };
}

/** Interroge l'operation jusqu'a completion. */
async function waitForOperation(ai, operation, { onProgress, stageLabel }) {
  const startedAt = Date.now();
  let current = operation;

  while (!current?.done) {
    if (Date.now() - startedAt > MAX_WAIT_MS) {
      throw new VeoError('Veo n’a pas terminé dans le délai imparti (14 minutes).', {
        hint: 'Réessayez : aux heures de pointe, une génération peut dépasser 6 minutes.',
      });
    }
    onProgress?.({ elapsedMs: Date.now() - startedAt, stage: stageLabel });
    await sleep(POLL_INTERVAL_MS);

    try {
      current = await ai.operations.getVideosOperation({ operation: current });
    } catch (err) {
      throw toVeoError(err, 'suivi de la génération Veo');
    }
  }

  if (current?.error) {
    const message = current.error.message || JSON.stringify(current.error);
    throw new VeoError('Veo a signalé une erreur pendant la génération.', { details: message });
  }
  return current;
}

/** Recupere la video generee, ou explique pourquoi il n'y en a pas. */
function extractVideo(operation) {
  const response = operation?.response;
  const videos = response?.generatedVideos || [];

  if (videos.length === 0) {
    const reasons = response?.raiMediaFilteredReasons || [];
    if (reasons.length) {
      throw new VeoError('La génération a été bloquée par les filtres de sécurité de Google.', {
        hint: 'Essayez une autre photo, ou reformulez le message publicitaire (évitez les allégations santé, les marques tierces, les personnes identifiables).',
        details: reasons.join(' | '),
      });
    }
    throw new VeoError('Veo n’a renvoyé aucune vidéo.', {
      hint: 'Cause fréquente : l’audio a été bloqué par les filtres de sécurité. Relancez la génération.',
      details: JSON.stringify(response || {}).slice(0, 600),
    });
  }
  return videos[0];
}

/** Telecharge le mp4 genere (les fichiers Veo expirent au bout de 2 jours). */
async function download(ai, generated, outputPath) {
  if (!generated?.video) {
    throw new VeoError('Vidéo Veo absente de la réponse.');
  }
  try {
    await ai.files.download({ file: generated.video, downloadPath: outputPath });
  } catch (err) {
    throw toVeoError(err, 'téléchargement de la vidéo');
  }
  return outputPath;
}

/** Test leger de validite de la cle (sans lancer de generation). */
export async function verifyApiKey() {
  const ai = createClient();
  try {
    await ai.models.get({ model: 'veo-3.1-generate-preview' });
    return { ok: true };
  } catch (err) {
    throw toVeoError(err, 'vérification de la clé API');
  }
}
