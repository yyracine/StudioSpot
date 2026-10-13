/**
 * Construction des prompts envoyes a Veo.
 *
 * Note importante : la documentation Veo precise que l'anglais est la seule
 * langue pleinement evaluee. Les consignes sont donc redigees en anglais,
 * mais le message publicitaire et le nom du produit sont repris MOT POUR MOT
 * (en francais) : c'est ce texte exact qui doit apparaitre a l'ecran.
 */
import { AMBIANCES, DURATIONS, MODELS, TEXT_MODES, VIDEO_TYPES, findById } from './config.js';

/** Nettoyage defensif : une seule ligne, espaces compresses. */
const oneLine = (value) => String(value || '').replace(/\s+/g, ' ').trim();

/**
 * Bloc "fidelite produit" : indispensable en image-to-video pour eviter que
 * Veo ne reinvente le produit (forme, couleur, logo, matiere).
 */
const productFidelity = (productName) =>
  [
    `The product is the exact product shown in the reference image: "${productName}".`,
    'Preserve it with absolute fidelity: identical shape, proportions, colour, material, texture, ' +
      'logo, labels, packaging and branding. Do not redesign, restyle, recolour or replace it, and ' +
      'do not add any other product to the scene.',
  ].join(' ');

/** Consignes de texte selon le mode de rendu choisi. */
const textBlock = (textMode, productName, adMessage) => {
  if (textMode === 'none') {
    return (
      'On-screen text: none. Do not render any text, letters, numbers, subtitles, captions, ' +
      'watermarks or fake logos anywhere in the frame.'
    );
  }

  if (textMode === 'veo') {
    return [
      'On-screen text: display the following promotional copy, rendered as clean, modern, perfectly ' +
        'legible typography integrated into the composition.',
      `Headline (spelled exactly like this, this exact string): "${oneLine(adMessage)}".`,
      `Smaller line just above it, in capital letters (spelled exactly like this): "${oneLine(
        productName,
      ).toUpperCase()}".`,
      'Both lines must be sharp, correctly spelled, in the same language as written here, with no ' +
        'typos, no extra words, no duplicated or garbled characters. Keep the text comfortably inside ' +
        'the frame with safe margins.',
    ].join(' ');
  }

  // Mode 'overlay' : on veut un cadre propre, le texte est incruste ensuite.
  return (
    'On-screen text: none. Do not render any text, letters, numbers, subtitles, captions, ' +
    'watermarks or fake logos in the video, because promotional typography will be composited on ' +
    'top of the footage afterwards. Keep the framing clean and uncluttered, and leave generous ' +
    'negative space in the lower third of the frame so that a caption can be added there later.'
  );
};

/** Bloc audio : pilote l'audio natif de Veo (toujours actif). */
const audioBlock = (ambiance) => ambiance.prompt;

/** Bloc technique : duree, cadrage, qualite, interdits. */
const technicalBlock = ({ durationSeconds, aspectRatio, resolution, extend }) =>
  [
    `The clip is a ${durationSeconds} second ${aspectRatio} vertical-or-landscape commercial shot at ${resolution}.`,
    extend
      ? 'This is the first part of a longer 15 second advert: it must end in a state that can be ' +
        'continued naturally and seamlessly in a following shot.'
      : 'The shot must be self-contained and feel complete.',
    'Motion must be perfectly smooth and continuous, with a stable, cinematic camera. No flicker, ' +
      'no jitter, no strobing, no morphing artefacts.',
    'Avoid: blurry or warped product, deformed geometry, melted or duplicated objects, extra or ' +
      'malformed fingers, text artefacts, gibberish letters, watermarks, on-screen UI elements, ' +
      'heavy compression artefacts, childish or cartoonish distortion.',
    'Photorealistic, high-end commercial advertising quality, professional studio production value.',
  ].join(' ');

/**
 * Prompt principal (premier plan de la video).
 *
 * @param {object} input
 * @param {string} input.videoTypeId
 * @param {string} input.ambianceId
 * @param {string} input.durationId
 * @param {string} input.textModeId
 * @param {string} input.productName
 * @param {string} input.adMessage
 * @param {string} input.aspectRatio   '16:9' | '9:16'
 * @param {string} input.resolution    '720p' | '1080p'
 * @returns {string}
 */
export function buildMainPrompt(input) {
  const videoType = findById(VIDEO_TYPES, input.videoTypeId) || VIDEO_TYPES[0];
  const ambiance = findById(AMBIANCES, input.ambianceId) || AMBIANCES[0];
  const duration = findById(DURATIONS, input.durationId) || DURATIONS[1];
  const textMode = findById(TEXT_MODES, input.textModeId) || TEXT_MODES[0];

  const productName = oneLine(input.productName);
  const adMessage = oneLine(input.adMessage);

  return [
    videoType.scene,
    productFidelity(productName),
    videoType.motion,
    textBlock(textMode.id, productName, adMessage),
    audioBlock(ambiance),
    technicalBlock({
      durationSeconds: duration.veoDurationSeconds,
      aspectRatio: input.aspectRatio,
      resolution: input.resolution,
      extend: duration.extend,
    }),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Prompt d'extension : deuxieme segment de la video de 15 s.
 * Veo ajoute 7 s au clip precedent, ce qui porte 8 s + 7 s a exactement 15 s.
 */
export function buildExtensionPrompt(input) {
  const videoType = findById(VIDEO_TYPES, input.videoTypeId) || VIDEO_TYPES[0];
  const ambiance = findById(AMBIANCES, input.ambianceId) || AMBIANCES[0];
  const textMode = findById(TEXT_MODES, input.textModeId) || TEXT_MODES[0];

  return [
    'Continue this exact same commercial shot seamlessly, as one uninterrupted take: same product, ' +
      'same set, same lighting, same camera language, same colour grade. Do not cut to a different ' +
      'scene and do not restart the action.',
    videoType.motion,
    productFidelity(oneLine(input.productName)),
    textBlock(textMode.id, oneLine(input.productName), oneLine(input.adMessage)),
    ambiance.prompt,
    'The continuation lasts 7 seconds and must flow naturally out of the last frame of the ' +
      'previous clip, holding the product in a final hero framing with a smooth, stable camera. ' +
      'Photorealistic high-end advertising quality. Avoid: blurry or warped product, deformed ' +
      'geometry, text artefacts, gibberish letters, watermarks, flicker, morphing.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Configuration d'appel Veo.
 * On ne transmet que les champs documentes comme supportes par l'API Gemini
 * (generateAudio / lastFrame ne sont pas supportes pour Veo 3.x cote Gemini).
 */
export function buildVeoConfig({ durationId, aspectRatio, resolution, seed }) {
  const duration = findById(DURATIONS, durationId) || DURATIONS[1];
  const config = {
    numberOfVideos: 1,
    durationSeconds: duration.veoDurationSeconds,
    aspectRatio,
    resolution,
    // L'image-to-video Veo n'accepte que "allow_adult".
    personGeneration: 'allow_adult',
  };
  if (Number.isInteger(seed)) config.seed = seed;

  // L'extension impose 8 s et du 720p : on verrouille ces valeurs.
  if (duration.extend) {
    config.durationSeconds = 8;
    config.resolution = '720p';
  } else if (config.durationSeconds !== 8) {
    // Veo n'autorise le 1080p/4k que sur des clips de 8 s.
    config.resolution = '720p';
  }
  return config;
}

/** Resume lisible de la production, affiche dans l'interface. */
export function describePlan({ durationId, modelId, resolution }) {
  const duration = findById(DURATIONS, durationId) || DURATIONS[1];
  const model = findById(MODELS, modelId) || MODELS[0];

  // Veo ne permet le 1080p que sur des clips de 8 s, et l'extension impose 720p.
  const effectiveResolution =
    duration.extend || duration.veoDurationSeconds !== 8 || resolution !== '1080p' ? '720p' : '1080p';

  return {
    seconds: duration.seconds,
    veoDurationSeconds: duration.veoDurationSeconds,
    calls: duration.extend ? 2 : 1,
    trimsTo: duration.trimTo,
    extended: duration.extend,
    resolution: effectiveResolution,
    model: model.label,
    note: duration.note,
  };
}
