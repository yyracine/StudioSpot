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
 * `scene`      : description du sujet / de l'action confiee au moteur.
 * `motion`     : consignes de mouvement et de camera (animation fluide).
 * `needsPerson`: le cadre doit-il contenir des personnes ?
 *                true  -> on autorise explicitement des adultes ;
 *                false -> on interdit toute presence humaine (mains, visages,
 *                         membres), ce qui evite qu'un modele ajoute des
 *                         silhouettes parasites sur un packshot produit.
 * `fallbackAd`: accroche utilisee par le repli hors ligne des suggestions,
 *               pour rester coherent avec la mise en scene choisie.
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
    fallbackAd: (name) => `${name}, sous tous les angles`,
  },
  {
    id: 'packshot',
    label: 'Packshot publicitaire net',
    hint: 'Fond neutre, balayage lumineux, produit impeccable. Idéal pour une fiche produit.',
    scene:
      'A flawless e-commerce packshot on a seamless neutral studio cyclorama, the product centred ' +
      'on a glossy surface with a soft reflected echo beneath it, clean and controlled commercial ' +
      'lighting with no props and no clutter.',
    motion:
      'Almost still: the product stays perfectly crisp and motionless while a single soft light sweep ' +
      'travels slowly across its surface, revealing the finish and the material. A very slight camera ' +
      'parallax gives depth. Sober, precise, catalogue quality.',
    needsPerson: false,
    fallbackAd: (name) => `${name} — la qualité en un regard`,
  },
  {
    id: 'macro',
    label: 'Macro matière et finitions',
    hint: 'Très gros plans sur les matières, coutures et finitions. Effet haut de gamme.',
    scene:
      'Extreme macro cinematography over the product: the weave of the fabric, the stitching, the ' +
      'grain of the leather, brushed metal, a polished glass edge, all with a very shallow depth of ' +
      'field and beautiful optical bokeh.',
    motion:
      'The camera glides very slowly along the surface, closer than the eye can see, with slow rack ' +
      'focus travelling from one detail to the next. Tiny specular highlights slide over the material ' +
      'as the lens moves. Tactile, luxurious, hypnotic.',
    needsPerson: false,
    fallbackAd: (name) => `Chaque détail compte`,
  },
  {
    id: 'fonctionnement',
    label: 'Produit en fonctionnement',
    hint: 'Le produit est montré en train de fonctionner : mécanisme, écran, bouton.',
    scene:
      'A clean demonstration desk where the product is shown working: a lid sliding open, a mechanism ' +
      'unfolding, a screen waking up, a dial turning. A single adult hand may enter the frame to ' +
      'operate it. Bright, functional, easy to read.',
    motion:
      'Precise and informative: a tight push-in shows the exact moment the product does what it is ' +
      'made for, then holds on the satisfying result. Clear mechanical motion, no confusion about ' +
      'what is happening, confident commercial pacing.',
    needsPerson: true,
    fallbackAd: (name) => `Voyez ${name} à l’œuvre`,
  },
  {
    id: 'levitation',
    label: 'Lévitation premium',
    hint: 'Le produit flotte dans les airs, rotation lente, particules.',
    scene:
      'The product floats weightless in mid-air against a deep gradient backdrop, surrounded by fine ' +
      'floating particles and soft bokeh specks of light that catch the glow.',
    motion:
      'The product hovers, drifting almost imperceptibly up and down while rotating slowly on itself. ' +
      'Particles orbit gently around it and the camera performs a slow arc. Hypnotic, weightless, ' +
      'high-end tech advertising feel.',
    needsPerson: false,
    fallbackAd: (name) => `${name}, la légèreté en plus`,
  },
  {
    id: 'stopMotion',
    label: 'Stop-motion / assemblage',
    hint: 'Les éléments se rassemblent pour former le produit. Effet satisfaisant.',
    scene:
      'A clean studio surface where the product, its accessories and its packaging are laid out ' +
      'separately, as an exploded view ready to come together.',
    motion:
      'A satisfying stop-motion build: each piece slides and snaps into place one after another with ' +
      'small tactile impacts, progressively assembling the complete product, ending on the finished ' +
      'object. Playful, crisp, rhythmic, very scroll-stopping.',
    needsPerson: false,
    fallbackAd: (name) => `Tout est inclus`,
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
    fallbackAd: (name) => `Découvrez ${name} en 15 secondes`,
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
    fallbackAd: (name) => `Avant, après : la différence ${name}`,
  },
  {
    id: 'lifestyle',
    label: 'Mise en situation lifestyle',
    hint: 'Le produit posé dans un décor inspirant, sans personne. Ambiance naturelle.',
    scene:
      'An aspirational real-world setting chosen to match the product — a sunlit café table, a ' +
      'designer interior, a rooftop at golden hour — styled tastefully and populated only by natural ' +
      'ambience: plants, steam, light, texture.',
    motion:
      'A slow cinematic dolly moves through the scene while the environment lives on its own: steam ' +
      'rising, leaves swaying in a breeze, light shifting across the surface. The product rests as the ' +
      'undisputed hero of the frame. Calm, editorial, desirable.',
    needsPerson: false,
    fallbackAd: (name) => `${name} dans votre quotidien`,
  },
  {
    id: 'defile',
    label: 'Porté en mouvement (mode)',
    hint: 'Une personne porte le produit et marche : idéal pour les vêtements.',
    scene:
      'A fashion-film scene — a clean runway or an urban street — where a young adult wears the ' +
      'product and walks confidently toward the camera, the garment moving naturally with every step.',
    motion:
      'A confident walk with the fabric flowing and catching the light, the camera tracking backwards ' +
      'to keep the product as the focus, then a brief confident pose to close. Dynamic, elegant, ' +
      'editorial fashion energy.',
    needsPerson: true,
    fallbackAd: (name) => `Portez ${name} avec confiance`,
  },
  {
    id: 'action',
    label: 'Produit en action / utilisation',
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
    fallbackAd: (name) => `Adoptez ${name} au quotidien`,
  },
];

/* ------------------------------------------------------------------ *
 * Ambiances sonores
 * ------------------------------------------------------------------ *
 * Pour les moteurs a audio natif (Veo), `prompt` decrit la musique au
 * modele. Pour les autres (fal, Replicate) ce bloc est retire du prompt :
 * une nappe locale est synthetisee par ffmpeg a partir de `demo`, faute de
 * quoi l'ambiance choisie serait purement ignoree.
 *
 * `demo` : accord synthetise (frequences, pulsation, profondeur, volume).
 *          C'est une nappe d'accompagnement, pas une reproduction fidele du
 *          style decrit.
 * `mute` : l'option "Pas de son" supprime la piste audio en post-production.
 */
const INSTRUMENTAL = 'Instrumental only: no dialogue, no voice-over, no lyrics, no singing.';

export const AMBIANCES = [
  {
    id: 'corporate',
    label: 'Corporate professionnel',
    hint: 'Nappe propre, piano doux, tempo posé.',
    prompt:
      'Audio: clean corporate background music, warm piano chords over soft synth pads, a calm and ' +
      `confident tempo, discreet whoosh on the transitions. ${INSTRUMENTAL}`,
    demo: { freqs: [220, 261.63, 329.63], tremoloHz: 0.6, tremoloDepth: 0.12, volume: 0.16 },
  },
  {
    id: 'energique',
    label: 'Énergique et fun',
    hint: 'Beat marqué, percussions punchy, dynamique.',
    prompt:
      'Audio: upbeat energetic pop track with a driving punchy beat, crisp claps and a bright synth ' +
      `hook, fun, dynamic and youthful. ${INSTRUMENTAL}`,
    demo: { freqs: [293.66, 369.99, 440], tremoloHz: 2.4, tremoloDepth: 0.45, volume: 0.2 },
  },
  {
    id: 'luxe',
    label: 'Luxe et élégant',
    hint: 'Cordes soyeuses, nappe raffinée, tempo lent.',
    prompt:
      'Audio: elegant and luxurious soundtrack, soft orchestral strings blended with a refined ambient ' +
      `pad and a subtle shimmer, slow and sophisticated tempo, spacious and expensive sounding. ${INSTRUMENTAL}`,
    demo: { freqs: [440, 554.37, 659.25], tremoloHz: 0.4, tremoloDepth: 0.15, volume: 0.14 },
  },
  {
    id: 'cinematique',
    label: 'Cinématique épique',
    hint: 'Cordes montantes, impacts profonds, souffle de bande-annonce.',
    prompt:
      'Audio: epic cinematic trailer music, rising orchestral strings, deep braams and sub hits, a slow ' +
      `powerful build with a satisfying impact on the reveal, awe-inspiring and bold. ${INSTRUMENTAL}`,
    demo: { freqs: [110, 164.81, 220], tremoloHz: 0.3, tremoloDepth: 0.22, volume: 0.18 },
  },
  {
    id: 'minimaliste',
    label: 'Minimaliste moderne',
    hint: 'Texture épurée, pulsation discrète, esprit design et tech.',
    prompt:
      'Audio: minimal modern electronic texture, sparse clean synth notes, a soft steady pulse, plenty ' +
      `of space and restraint, precise and design-oriented. ${INSTRUMENTAL}`,
    demo: { freqs: [261.63, 392, 523.25], tremoloHz: 1.2, tremoloDepth: 0.2, volume: 0.12 },
  },
  {
    id: 'chaleureux',
    label: 'Chaleureux et artisanal',
    hint: 'Acoustique, guitare douce, esprit fait main.',
    prompt:
      'Audio: warm acoustic folk, gently fingerpicked guitar with soft brushed percussion, an intimate ' +
      `handcrafted and authentic feel. ${INSTRUMENTAL}`,
    demo: { freqs: [196, 246.94, 293.66], tremoloHz: 0.8, tremoloDepth: 0.15, volume: 0.15 },
  },
  {
    id: 'urbain',
    label: 'Urbain / streetwear',
    hint: 'Beat hip-hop, basse ronde, attitude street.',
    prompt:
      'Audio: confident hip-hop beat with a deep 808 bass, crisp hi-hats and a laid-back urban groove, ' +
      `streetwear energy, cool and self-assured. ${INSTRUMENTAL}`,
    demo: { freqs: [82.41, 110, 164.81], tremoloHz: 1.8, tremoloDepth: 0.35, volume: 0.2 },
  },
  {
    id: 'tendances',
    label: 'Tendance réseaux sociaux',
    hint: 'Hook accrocheur, rythme serré, pensé pour Reels et TikTok.',
    prompt:
      'Audio: catchy viral pop hook, tight upbeat percussion with snappy claps and a bright synth lead, ' +
      `immediate and made for short-form social video. ${INSTRUMENTAL}`,
    demo: { freqs: [349.23, 440, 523.25], tremoloHz: 2.8, tremoloDepth: 0.4, volume: 0.18 },
  },
  {
    id: 'dramatique',
    label: 'Tension dramatique',
    hint: 'Montée de tension, impact final. Parfait pour un unboxing.',
    prompt:
      'Audio: tense dramatic build-up, a low pulsing drone that rises slowly in suspense, then one deep ' +
      `impact at the exact moment of the reveal. ${INSTRUMENTAL}`,
    demo: { freqs: [98, 116.54, 146.83], tremoloHz: 0.5, tremoloDepth: 0.25, volume: 0.17 },
  },
  {
    id: 'naturel',
    label: 'Naturel et apaisant',
    hint: 'Souffle d’air, oiseaux lointains, nappe douce. Cosmétique, bien-être.',
    prompt:
      'Audio: calm natural ambience, soft wind and distant birdsong blended with a warm gentle pad, ' +
      `soothing and organic, wellness and skincare feel. ${INSTRUMENTAL}`,
    demo: { freqs: [174.61, 220, 261.63], tremoloHz: 0.25, tremoloDepth: 0.1, volume: 0.11 },
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
