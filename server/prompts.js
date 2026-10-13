/**
 * Construction des prompts envoyes a Veo.
 *
 * Note importante : la documentation Veo precise que l'anglais est la seule
 * langue pleinement evaluee. Les consignes sont donc redigees en anglais,
 * mais le message publicitaire et le nom du produit sont repris MOT POUR MOT
 * (en francais) : c'est ce texte exact qui doit apparaitre a l'ecran.
 */
import { AMBIANCES, TEXT_MODES, VIDEO_TYPES, findById } from './config.js';

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

/** Bloc audio : ne s'adresse qu'aux modeles a audio natif. */
const audioBlock = (ambiance, nativeAudio = true) => (nativeAudio ? ambiance.prompt : null);

/** Bloc technique : duree, cadrage, qualite, interdits. */
const technicalBlock = ({ durationSeconds, aspectRatio, resolution, extend }) =>
  [
    `The clip is a ${durationSeconds} second ${aspectRatio} vertical-or-landscape commercial shot at ${resolution}.`,
    extend
      ? 'This is the first part of a longer advert: it must end in a state that can be ' +
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
 * Le bloc technique est derive du PLAN DU FOURNISSEUR, pas d'une duree codee en
 * dur : c'est la seule facon de rester juste quand on change de moteur.
 *
 * @param {object} input
 * @param {string} input.videoTypeId
 * @param {string} input.ambianceId
 * @param {string} input.textModeId
 * @param {string} input.productName
 * @param {string} input.adMessage
 * @param {object} input.plan                 plan renvoye par le fournisseur
 * @param {boolean} [input.nativeAudio]       le modele genere-t-il son propre audio ?
 * @param {boolean} [input.rendersText]       le modele sait-il dessiner du texte ?
 * @returns {string}
 */
export function buildMainPrompt(input) {
  const videoType = findById(VIDEO_TYPES, input.videoTypeId) || VIDEO_TYPES[0];
  const ambiance = findById(AMBIANCES, input.ambianceId) || AMBIANCES[0];
  const textMode = findById(TEXT_MODES, input.textModeId) || TEXT_MODES[0];
  const plan = input.plan;

  const productName = oneLine(input.productName);
  const adMessage = oneLine(input.adMessage);

  return [
    videoType.scene,
    productFidelity(productName),
    videoType.motion,
    textBlock(textMode.id, productName, adMessage),
    audioBlock(ambiance, input.nativeAudio !== false),
    technicalBlock({
      durationSeconds: plan.steps[0].seconds,
      aspectRatio: plan.aspectRatio,
      resolution: plan.resolution,
      extend: plan.steps.some((step) => step.kind === 'extend'),
    }),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Prompt d'extension : segment supplementaire pour atteindre la duree visee
 * (Veo ajoute 7 s au clip precedent).
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
    audioBlock(ambiance, input.nativeAudio !== false),
    'The continuation lasts 7 seconds and must flow naturally out of the last frame of the ' +
      'previous clip, holding the product in a final hero framing with a smooth, stable camera. ' +
      'Photorealistic high-end advertising quality. Avoid: blurry or warped product, deformed ' +
      'geometry, text artefacts, gibberish letters, watermarks, flicker, morphing.',
  ]
    .filter(Boolean)
    .join('\n\n');
}
