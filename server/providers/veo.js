/**
 * Fournisseur Veo (API Gemini, Google).
 *
 * Spécificités encapsulées ici :
 *  - durées réellement disponibles : 4, 6 ou 8 s ;
 *  - extension de +7 s pour atteindre 15 s ;
 *  - audio natif généré par le modèle ;
 *  - 1080p uniquement sur des clips de 8 s ;
 *  - image-to-video impose `personGeneration: "allow_adult"`.
 */
import { GoogleGenAI } from '@google/genai';
import { readFile } from 'node:fs/promises';
import { getKey, hasKey } from '../config.js';
import { ProviderError, mimeFor, pollUntil } from './http.js';

const POLL_INTERVAL_MS = 10_000;
const MODEL_CONFIGURED = 'veo-3.1-generate-preview';

/** Traduit une erreur brute (SDK, API, réseau) en message exploitable. */
function toVeoError(err, stage) {
  if (err instanceof ProviderError) return err;

  const raw = String(err?.message || err);
  const details = err?.error?.message || err?.response?.data?.error?.message || null;
  const haystack = `${raw} ${details || ''}`;

  if (/API key not valid|API_KEY_INVALID|permission|PERMISSION_DENIED|401|403/i.test(haystack)) {
    return new ProviderError('Clé API refusée par Google.', {
      hint: 'Vérifiez la clé dans les réglages. Veo nécessite un projet Google avec facturation activée.',
      details: details || raw,
      cause: err,
    });
  }

  if (/quota|RESOURCE_EXHAUSTED|429|rate limit/i.test(haystack)) {
    return new ProviderError('Veo a refusé la requête : quota ou accès indisponible (429).', {
      hint:
        'Cause la plus fréquente : le projet Google lié à la clé n’est pas sur un palier payant. ' +
        'Veo est un modèle « preview » qui exige un compte de facturation actif (palier Tier 1). ' +
        'Vérifiez vos limites réelles sur https://aistudio.google.com/rate-limit : si Veo y affiche 0, ' +
        'il faut activer la facturation sur le projet. Sinon, patientez une minute et réessayez. ' +
        'En attendant, vous pouvez produire la vidéo en mode démo local, ou choisir un autre fournisseur.',
      details: details || raw,
      cause: err,
    });
  }

  if (/billing|payment|not available in your|location|region/i.test(haystack)) {
    return new ProviderError('Veo n’est pas disponible pour ce projet ou cette région.', {
      hint: 'Veo via l’API Gemini est réservé aux comptes avec facturation activée, hors régions non desservies.',
      details: details || raw,
      cause: err,
    });
  }

  return new ProviderError(`Échec de l’étape « ${stage} ».`, { details: details || raw, cause: err });
}

const createClient = () => {
  const apiKey = getKey('gemini');
  if (!apiKey) {
    throw new ProviderError('Aucune clé API Gemini configurée.', {
      hint: 'Renseignez votre clé API Gemini (Google AI Studio) dans les réglages.',
    });
  }
  return new GoogleGenAI({ apiKey });
};

/** Récupère la vidéo générée, ou explique pourquoi il n’y en a pas. */
function extractVideo(operation) {
  const response = operation?.response;
  const videos = response?.generatedVideos || [];

  if (videos.length === 0) {
    const reasons = response?.raiMediaFilteredReasons || [];
    if (reasons.length) {
      throw new ProviderError('La génération a été bloquée par les filtres de sécurité de Google.', {
        hint:
          'Essayez une autre photo, ou reformulez le message publicitaire (évitez les allégations santé, ' +
          'les marques tierces, les personnes identifiables).',
        details: reasons.join(' | '),
      });
    }
    throw new ProviderError('Veo n’a renvoyé aucune vidéo.', {
      hint: 'Cause fréquente : l’audio a été bloqué par les filtres de sécurité. Relancez la génération.',
      details: JSON.stringify(response || {}).slice(0, 600),
    });
  }
  return videos[0];
}

/** Interroge l’opération longue durée jusqu’à completion. */
async function waitForOperation(ai, operation, { onProgress, stageLabel }) {
  return pollUntil({
    label: stageLabel,
    intervalMs: POLL_INTERVAL_MS,
    onProgress,
    step: async () => {
      if (!operation?.done) {
        operation = await ai.operations.getVideosOperation({ operation });
      }
      if (!operation?.done) return { done: false };
      if (operation.error) {
        throw new ProviderError('Veo a signalé une erreur pendant la génération.', {
          details: operation.error.message || JSON.stringify(operation.error),
        });
      }
      return { done: true, result: operation };
    },
  });
}

export default {
  id: 'veo',
  label: 'Veo 3.1 (Google)',
  shortLabel: 'Veo',
  docsUrl: 'https://ai.google.dev/gemini-api/docs/veo',
  keyProvider: 'gemini',
  keyLabel: 'Clé API Gemini (Google AI Studio)',
  note: 'Meilleur rendu pour du produit : audio natif et texte bien intégré. Nécessite un projet Google avec facturation.',

  capabilities: {
    nativeAudio: true,
    rendersText: true,
    extension: true,
    aspectRatios: ['16:9', '9:16'],
    resolutions: ['720p', '1080p'],
  },

  isConfigured: () => hasKey('gemini'),

  /**
   * Traduit une durée demandée en plan de production réel.
   * Veo n’accepte que 4, 6 ou 8 s : 5 s → 6 s coupées à 5,00 s ;
   * 15 s → 8 s puis extension de +7 s.
   */
  buildPlan({ durationId, aspectRatio, resolution }) {
    const plans = {
      5: { steps: [{ kind: 'generate', seconds: 6 }], trimTo: 5, note: 'Généré en 6 s puis coupé à 5,0 s.' },
      8: { steps: [{ kind: 'generate', seconds: 8 }], trimTo: null, note: 'Durée native du modèle Veo.' },
      15: {
        steps: [
          { kind: 'generate', seconds: 8 },
          { kind: 'extend', seconds: 7 },
        ],
        trimTo: null,
        note: '8 s générées puis étendues de 7 s (2 appels Veo).',
      },
    };

    const chosen = plans[durationId] || plans[8];
    const seconds = Number(durationId) || 8;
    const hasExtension = chosen.steps.some((step) => step.kind === 'extend');

    // Veo n’autorise le 1080p que sur des clips de 8 s, et l’extension impose 720p.
    const effectiveResolution =
      hasExtension || chosen.steps[0].seconds !== 8 || resolution !== '1080p' ? '720p' : '1080p';

    return {
      seconds,
      steps: chosen.steps,
      trimTo: chosen.trimTo,
      aspectRatio,
      resolution: effectiveResolution,
      calls: chosen.steps.length,
      note: chosen.note,
      // Conséquence à afficher si le fournisseur ne peut pas atteindre la durée demandée.
      limitedTo: null,
    };
  },

  /** Configuration transmise au SDK (champs supportés par l’API Gemini). */
  buildConfig(plan, { seed } = {}) {
    const config = {
      numberOfVideos: 1,
      durationSeconds: plan.steps[0].seconds,
      aspectRatio: plan.aspectRatio,
      resolution: plan.resolution,
      // L’image-to-video Veo n’accepte que « allow_adult ».
      personGeneration: 'allow_adult',
    };
    if (plan.steps.some((s) => s.kind === 'extend')) {
      config.durationSeconds = 8;
      config.resolution = '720p';
    }
    if (Number.isInteger(seed)) config.seed = seed;
    return config;
  },

  async generateClip({ imagePath, prompt, config, model, outputPath, onProgress, stageLabel }) {
    const ai = createClient();
    const imageBytes = (await readFile(imagePath)).toString('base64');

    let operation;
    try {
      operation = await ai.models.generateVideos({
        model,
        prompt,
        image: { imageBytes, mimeType: mimeFor(imagePath) },
        config,
      });
    } catch (err) {
      throw toVeoError(err, 'envoi de la demande à Veo');
    }

    try {
      operation = await waitForOperation(ai, operation, { onProgress, stageLabel });
    } catch (err) {
      throw toVeoError(err, 'suivi de la génération Veo');
    }

    const generated = extractVideo(operation);
    if (!generated?.video) throw new ProviderError('Vidéo Veo absente de la réponse.');

    try {
      await ai.files.download({ file: generated.video, downloadPath: outputPath });
    } catch (err) {
      throw toVeoError(err, 'téléchargement de la vidéo');
    }

    // `ref` sert à l’extension : la vidéo doit rester référençable côté Google.
    return { outputPath, ref: generated.video };
  },

  async extendClip({ previousRef, prompt, model, outputPath, onProgress, stageLabel }) {
    const ai = createClient();

    let operation;
    try {
      operation = await ai.models.generateVideos({
        model,
        video: previousRef,
        prompt,
        config: { numberOfVideos: 1, resolution: '720p' },
      });
    } catch (err) {
      throw toVeoError(err, 'envoi de la demande d’extension');
    }

    try {
      operation = await waitForOperation(ai, operation, { onProgress, stageLabel });
    } catch (err) {
      throw toVeoError(err, 'suivi de l’extension Veo');
    }

    const generated = extractVideo(operation);
    if (!generated?.video) throw new ProviderError('Vidéo étendue absente de la réponse.');

    try {
      await ai.files.download({ file: generated.video, downloadPath: outputPath });
    } catch (err) {
      throw toVeoError(err, 'téléchargement de la vidéo étendue');
    }

    return { outputPath, ref: null };
  },

  /**
   * Décrit la requête qui SERAIT envoyée, sans rien envoyer.
   * Veo passe par le SDK : on décrit donc ses arguments, pas du HTTP brut.
   */
  describeRequest({ plan, model, prompt, imagePath }) {
    return {
      transport: 'sdk @google/genai',
      model,
      method: 'models.generateVideos',
      prompt,
      config: this.buildConfig(plan),
      image: imagePath ? { mimeType: mimeFor(imagePath), encoding: 'base64 inline' } : '<image normalisée, base64>',
      extension: plan.steps.some((s) => s.kind === 'extend'),
    };
  },

  /** Contrôle léger de la clé, sans lancer de génération. */
  async verifyKey() {
    const ai = createClient();
    try {
      await ai.models.get({ model: MODEL_CONFIGURED });
      return { ok: true };
    } catch (err) {
      throw toVeoError(err, 'vérification de la clé API');
    }
  },
};
