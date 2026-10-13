/**
 * Configuration centrale de l'application.
 *
 * Ce module est l'unique source de verite pour :
 *  - les chemins de travail (uploads / outputs)
 *  - les catalogues proposes dans l'interface (types de video, ambiances, durees)
 *  - les correspondances avec les contraintes reelles de l'API Veo
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const UPLOAD_DIR = path.join(ROOT, 'uploads');
export const OUTPUT_DIR = path.join(ROOT, 'outputs');

export const PORT = Number(process.env.PORT || 5178);
export const HOST = process.env.HOST || '127.0.0.1';

/* ------------------------------------------------------------------ *
 * Types de video
 * ------------------------------------------------------------------ *
 * `scene`      : description du sujet / de l'action confiee a Veo.
 * `motion`     : consignes de mouvement et de camera (animation fluide).
 * `needsPerson`: si vrai, on autorise la generation de personnes adultes
 *                (obligatoire et suffisant pour l'image-to-video Veo 3.x).
 */
export const VIDEO_TYPES = [
  {
    id: 'rotation360',
    label: 'Rotation 360° élégante',
    hint: 'Le produit tourne sur lui-même, fond studio, reflets soyeux.',
    scene:
      'The product stands on a motorised turntable in a seamless infinity studio with a soft ' +
      'light grey gradient backdrop and a subtle touch of its own reflection on a glossy floor.',
    motion:
      'The turntable performs one continuous, perfectly smooth 360 degree rotation that reveals ' +
      'every side of the product. Elegant, unhurried, premium pacing. The silhouette stays razor ' +
      'sharp and the geometry of the product never distorts while it turns.',
    needsPerson: false,
  },
  {
    id: 'action',
    label: "Produit en action / utilisation",
    hint: 'Le produit est utilisé naturellement dans un contexte de vie réel.',
    scene:
      'A real-life lifestyle scene where the product is being used naturally by a young adult, ' +
      'in a bright modern interior with tasteful, uncluttered styling and shallow depth of field.',
    motion:
      'Natural, believable human movement: the hands and the person interact with the product the ' +
      'way a real customer would. The camera follows the gesture with a slow, confident push-in, ' +
      'then a gentle parallax drift. The product always stays the visual hero of the frame, ' +
      'perfectly readable, with a premium commercial finish.',
    needsPerson: true,
  },
  {
    id: 'unboxing',
    label: 'Unboxing dramatique',
    hint: 'Ouverture du packaging, révélation produit, éclairage spectaculaire.',
    scene:
      'A premium unboxing on a dark elegant surface: hands open a refined package, lifting the lid ' +
      'to reveal the product nested in textured tissue paper.',
    motion:
      'Dramatic, cinematic reveal: precise close-ups of the packaging texture, the lid lifting, the ' +
      'tissue unfolding, then a light sweep that grazes the surface and reveals the product in all ' +
      'its detail. Slow-motion feel, confident and suspenseful, ending on a hero shot of the product.',
    needsPerson: true,
  },
  {
    id: 'beforeAfter',
    label: 'Avant/Après transformation',
    hint: 'Transformation spectaculaire, transition nette, effet satisfaisant.',
    scene:
      'A before/after transformation built around the product: the "before" state is plain, mundane ' +
      'and slightly desaturated, the "after" state is styled, vibrant and clearly desirable thanks to ' +
      'the product.',
    motion:
      'A match cut on the same framing: the mundane before state transforms into the desirable after ' +
      'state at the exact moment a bright light sweep crosses the frame. The transformation is clean, ' +
      'satisfying and perfectly aligned, with a crisp modern advertising rhythm, then a short hero hold ' +
      'on the transformed result.',
    needsPerson: false,
  },
];

/* ------------------------------------------------------------------ *
 * Ambiances sonores
 * ------------------------------------------------------------------ *
 * L'audio de Veo 3.x est TOUJOURS actif : il se pilote uniquement par le
 * prompt. Pour l'option "Pas de son", on demande le silence dans le prompt
 * ET on supprime la piste audio en post-production (assurance totale).
 *
 * `demoTone` sert au mode demo local (sans cle API) : un accord synthetise
 * par ffmpeg pour illustrer la place de la bande son.
 */
export const AMBIANCES = [
  {
    id: 'corporate',
    label: 'Corporate professionnel',
    hint: 'Nappe propre, piano doux, tempo posé.',
    prompt:
      'Audio: clean corporate background music, warm piano chords over soft synth pads, a calm and ' +
      'confident tempo, discreet whoosh on the transitions. Instrumental only: no dialogue, no ' +
      'voice-over, no lyrics, no singing.',
    demo: { freqs: [220, 261.63, 329.63], tremoloHz: 0.6, tremoloDepth: 0.12, volume: 0.16 },
  },
  {
    id: 'energique',
    label: 'Énergique et fun',
    hint: 'Beat marqué, percussions punchy, dynamique.',
    prompt:
      'Audio: upbeat energetic pop track with a driving punchy beat, crisp claps and a bright synth ' +
      'hook, fun, dynamic and youthful. Instrumental only: no dialogue, no voice-over, no lyrics, ' +
      'no singing.',
    demo: { freqs: [293.66, 369.99, 440], tremoloHz: 2.4, tremoloDepth: 0.45, volume: 0.2 },
  },
  {
    id: 'luxe',
    label: 'Luxe et élégant',
    hint: 'Cordes soyeuses, nappe raffinée, tempo lent.',
    prompt:
      'Audio: elegant and luxurious soundtrack, soft orchestral strings blended with a refined ambient ' +
      'pad and a subtle shimmer, slow and sophisticated tempo, spacious and expensive sounding. ' +
      'Instrumental only: no dialogue, no voice-over, no lyrics, no singing.',
    demo: { freqs: [440, 554.37, 659.25], tremoloHz: 0.4, tremoloDepth: 0.15, volume: 0.14 },
  },
  {
    id: 'aucun',
    label: 'Pas de son',
    hint: 'Vidéo totalement muette (piste audio supprimée).',
    prompt:
      'Audio: absolutely silent. No music, no sound effects, no ambient noise, no dialogue, no ' +
      'voice-over. The clip must contain no audio content whatsoever.',
    demo: null,
    mute: true,
  },
];

/* ------------------------------------------------------------------ *
 * Durees proposees
 * ------------------------------------------------------------------ *
 * Ce sont les durees DEMANDEES par le client (5, 8 ou 15 s). Leur traduction
 * en production reelle depend du fournisseur choisi : c'est le « plan » de
 * chaque fournisseur qui la calcule (server/providers/*.js), car les modeles
 * n'acceptent ni les memes durees ni les memes extensions.
 *
 * Exemples :
 *   Veo        5 s -> 6 s generees puis coupees a 5,00 s ;
 *              15 s -> 8 s + extension de 7 s.
 *   fal/Replic. la duree est plafonnee a ce que le modele sait produire.
 */
export const DURATIONS = [
  { id: '5', label: '5 secondes', seconds: 5 },
  { id: '8', label: '8 secondes', seconds: 8 },
  { id: '15', label: '15 secondes', seconds: 15 },
];

/* ------------------------------------------------------------------ *
 * Modeles Veo
 * ------------------------------------------------------------------ */
export const MODELS = [
  {
    id: 'veo-3.1-generate-preview',
    label: 'Veo 3.1 — qualité maximale',
    supportsExtension: true,
  },
  {
    id: 'veo-3.1-fast-generate-preview',
    label: 'Veo 3.1 Fast — plus rapide et économique',
    supportsExtension: true,
  },
];
export const DEFAULT_MODEL = MODELS[0].id;

/* ------------------------------------------------------------------ *
 * Rendu du texte promotionnel
 * ------------------------------------------------------------------ *
 *  overlay : Veo tourne une image propre, ffmpeg incruste le texte exact
 *            (typographie nette et orthographe garantie) -> recommande.
 *  veo     : Veo dessine lui-meme le texte dans la video.
 *  none    : aucun texte.
 */
export const TEXT_MODES = [
  {
    id: 'overlay',
    label: 'Incrustation nette (recommandé)',
    hint: 'Veo filme un cadre propre, le texte exact est incrusté en post-production.',
  },
  { id: 'veo', label: 'Texte généré par Veo', hint: 'Veo dessine lui-même le texte dans l’image.' },
  { id: 'none', label: 'Aucun texte', hint: 'Vidéo produit sans message publicitaire.' },
];
export const DEFAULT_TEXT_MODE = 'overlay';

export const ASPECT_RATIOS = [
  { id: 'auto', label: 'Automatique (d’après la photo)' },
  { id: '16:9', label: '16:9 — paysage (YouTube, site)' },
  { id: '9:16', label: '9:16 — vertical (Reels, TikTok, Shorts)' },
];
export const DEFAULT_ASPECT_RATIO = 'auto';

export const RESOLUTIONS = [
  { id: '720p', label: '720p' },
  { id: '1080p', label: '1080p — 8 s uniquement' },
];
export const DEFAULT_RESOLUTION = '720p';

/* ------------------------------------------------------------------ *
 * Bornes de saisie
 * ------------------------------------------------------------------ */
export const LIMITS = {
  productNameMax: 60,
  adMessageMax: 120,
  uploadMaxBytes: 25 * 1024 * 1024,
  acceptedMime: ['image/jpeg', 'image/png', 'image/webp'],
};

export const JOB_RETENTION = 40;

/* ------------------------------------------------------------------ *
 * Cles API des fournisseurs (modifiables a chaud depuis l'interface)
 * ------------------------------------------------------------------ *
 * Chaque fournisseur declare son propre emplacement de cle, ce qui permet
 * d'en avoir plusieurs configurees et de basculer de l'un a l'autre.
 */
export const KEY_SOURCES = {
  gemini: {
    label: 'Clé API Gemini (Google AI Studio)',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    docsUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza… ou AQ.…',
  },
  fal: {
    label: 'Clé API fal.ai',
    envVars: ['FAL_KEY', 'FAL_API_KEY'],
    docsUrl: 'https://fal.ai/dashboard/keys',
    placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:xxxxxxxx…',
  },
  replicate: {
    label: 'Jeton API Replicate',
    envVars: ['REPLICATE_API_TOKEN'],
    docsUrl: 'https://replicate.com/account/api-tokens',
    placeholder: 'r8_…',
  },
};

/** Cles en memoire, initialisees depuis l'environnement. */
const runtimeKeys = Object.fromEntries(
  Object.entries(KEY_SOURCES).map(([id, source]) => [
    id,
    source.envVars.map((name) => process.env[name]).find((value) => value && value.trim()) || '',
  ]),
);

export const getKey = (providerId) => runtimeKeys[providerId] || '';
export const hasKey = (providerId) => getKey(providerId).length > 0;

export function setKey(providerId, value) {
  if (!(providerId in KEY_SOURCES)) throw new Error(`Fournisseur de clé inconnu : ${providerId}`);
  runtimeKeys[providerId] = String(value || '').trim();
  return runtimeKeys[providerId];
}

/** Identifiant de fournisseur à partir du nom de variable d'environnement. */
export const providerIdForEnvVar = (envVar) =>
  Object.entries(KEY_SOURCES).find(([, source]) => source.envVars.includes(envVar))?.[0] || null;

/** Mode force par variable d'environnement (DEMO=1 => jamais d'appel distant). */
export const FORCE_DEMO = ['1', 'true', 'yes'].includes(
  String(process.env.DEMO || '').toLowerCase(),
);

export const findById = (list, id) => list.find((item) => item.id === id);

export const getOptions = () => ({
  videoTypes: VIDEO_TYPES.map(({ id, label, hint }) => ({ id, label, hint })),
  ambiances: AMBIANCES.map(({ id, label, hint }) => ({ id, label, hint })),
  durations: DURATIONS.map(({ id, label, seconds }) => ({ id, label, seconds })),
  models: MODELS.map(({ id, label }) => ({ id, label })),
  textModes: TEXT_MODES.map(({ id, label, hint }) => ({ id, label, hint })),
  aspectRatios: ASPECT_RATIOS,
  resolutions: RESOLUTIONS,
  // Les fournisseurs sont lus dynamiquement pour refléter les clés présentes.
  defaults: {
    videoType: VIDEO_TYPES[0].id,
    ambiance: AMBIANCES[0].id,
    duration: DURATIONS[1].id,
    model: DEFAULT_MODEL,
    textMode: DEFAULT_TEXT_MODE,
    aspectRatio: DEFAULT_ASPECT_RATIO,
    resolution: DEFAULT_RESOLUTION,
  },
  limits: {
    productNameMax: LIMITS.productNameMax,
    adMessageMax: LIMITS.adMessageMax,
    uploadMaxBytes: LIMITS.uploadMaxBytes,
    acceptedMime: LIMITS.acceptedMime,
  },
  keySources: Object.fromEntries(
    Object.entries(KEY_SOURCES).map(([id, source]) => [
      id,
      {
        label: source.label,
        docsUrl: source.docsUrl,
        placeholder: source.placeholder,
        configured: hasKey(id),
      },
    ]),
  ),
  // Modèles par défaut des fournisseurs à catalogue (réglables par variables).
  providerModels: {
    fal: process.env.FAL_MODEL || 'fal-ai/wan-i2v',
    replicate: process.env.REPLICATE_MODEL || 'wan-video/wan-2.2-i2v-fast',
  },
});
