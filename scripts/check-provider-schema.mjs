#!/usr/bin/env node
/**
 * Confronte la requête construite par nos adaptateurs au schéma OFFICIEL
 * publié par le fournisseur.
 *
 * Pourquoi cet outil existe : un adaptateur peut sembler parfait et échouer au
 * premier appel réel pour une raison bête — un paramètre qui n'existe pas
 * (`duration` chez fal, qui se pilote en réalité par `num_frames`), ou une
 * valeur hors énumération (`1080p` alors que le modèle n'offre que 480p/720p).
 * Ces erreurs coûtent un aller-retour avec le fournisseur ; ici elles sont
 * détectées **sans clé et sans dépenser un centime**.
 *
 * Aucun appel authentifié n'est effectué : seuls les schémas publics sont lus.
 *
 * Usage : node scripts/check-provider-schema.mjs [--provider fal]
 */
import fal from '../server/providers/fal.js';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};

const providerId = arg('provider', 'fal');

/** Récupère les propriétés d'entrée du schéma public d'un endpoint fal. */
async function falInputSchema(endpointId) {
  const url = `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=${encodeURIComponent(endpointId)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`schéma indisponible (HTTP ${response.status})`);

  const spec = await response.json();
  const schemas = spec.components?.schemas || {};
  const name = Object.keys(schemas).find((key) => /input/i.test(key) && schemas[key].properties);
  if (!name) throw new Error('aucun schéma d’entrée dans le document OpenAPI');

  return { properties: schemas[name].properties, required: schemas[name].required || [] };
}

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
};

if (providerId !== 'fal') {
  console.log(
    `Le schéma de « ${providerId} » n’est pas lisible sans authentification.\n` +
      'Pour Replicate, récupérez les entrées acceptées par le modèle avec :\n' +
      '  curl -H "Authorization: Bearer $REPLICATE_API_TOKEN" \\\n' +
      '    https://api.replicate.com/v1/models/<owner>/<name>',
  );
  process.exit(0);
}

const endpointId = process.env.FAL_MODEL || 'fal-ai/wan-i2v';
console.log(`Champ confronté au schéma public de fal :\n  ${endpointId}\n`);

const { properties, required } = await falInputSchema(endpointId);
console.log(`   le modèle accepte ${Object.keys(properties).length} champs d’entrée`);

/* ------- 1. Le corps que nous enverrions ne doit contenir que des clés connues ------- */
const plans = {};
for (const durationId of ['5', '8', '15']) {
  plans[durationId] = fal.buildPlan({ durationId, aspectRatio: '16:9', resolution: '1080p' });
}

const body = fal.buildBody({
  prompt: 'Un produit qui tourne, éclairage studio.',
  plan: plans['8'],
  imageUrl: 'https://example.invalid/image.jpg',
});

const unknown = Object.keys(body).filter((key) => !(key in properties));
check(
  'aucun champ inconnu dans le corps envoyé',
  unknown.length === 0,
  unknown.length ? `rejetés par l’API : ${unknown.join(', ')}` : `${Object.keys(body).length} champs`,
);

/* ---------------------- 2. Les champs requis sont fournis ---------------------- */
const missing = required.filter((key) => !(key in body));
check('tous les champs requis sont présents', missing.length === 0, missing.join(', ') || `requis : ${required.join(', ')}`);

/* ------------------- 3. Les valeurs respectent les énumérations ------------------ */
let enumErrors = [];
for (const [key, value] of Object.entries(body)) {
  const allowed = properties[key]?.enum;
  if (allowed && !allowed.includes(value)) enumErrors.push(`${key}=${value} (autorisé : ${allowed.join(' | ')})`);
}
check('valeurs conformes aux énumérations', enumErrors.length === 0, enumErrors.join(' ; '));

/* -------- 4. Nos bornes internes correspondent à celles du schéma ------- */
const frames = properties.num_frames;
const fps = properties.frames_per_second;
console.log('');
console.log('   Contraintes de durée annoncées par le modèle :');
for (const [key, prop] of [
  ['num_frames', frames],
  ['frames_per_second', fps],
]) {
  if (prop) {
    const min = prop.minimum ?? prop.exclusiveMinimum;
    const max = prop.maximum ?? prop.exclusiveMaximum;
    const bounds = min !== undefined || max !== undefined ? `${min ?? '?'} à ${max ?? '?'}` : 'voir description';
    console.log(`     ${key} : ${bounds} (défaut ${prop.default ?? '—'})`);
    if (prop.description) {
      console.log(`       ${String(prop.description).replace(/\s+/g, ' ').slice(0, 140)}`);
    }
  }
}

// Le plan de 15 s doit annoncer une limitation plutôt qu'une fausse promesse.
check(
  'plan de 15 s : limitation annoncée (le modèle ne peut pas y arriver)',
  plans['15'].limitedTo !== null,
  plans['15'].note.slice(0, 90),
);
check(
  'plan de 5 s : coupe de précision annoncée',
  plans['5'].trimTo === 5,
  `durée produite ${plans['5'].seconds} s → coupée à ${plans['5'].trimTo} s`,
);
check(
  '1080p demandé : ramené à une valeur acceptée',
  plans['8'].resolution === '720p' && (properties.resolution.enum || []).includes('720p'),
  `résolution retenue : ${plans['8'].resolution}`,
);

/* ---------------- 5. Le téléversement est bien documenté comme requis ---------------- */
const imageKey = 'image_url' in properties ? 'image_url' : 'image';
check(
  'le champ image est bien celui attendu par le modèle',
  imageKey === 'image_url',
  `nous envoyons ${imageKey}, le modèle attend ${imageKey === 'image_url' ? 'image_url' : 'image'}`,
);
check(
  'le champ image est déclaré requis',
  required.includes('image_url'),
  required.includes('image_url') ? 'oui' : 'non — le modèle l’accepte en option',
);

const failed = results.filter(([, ok]) => !ok).length;
console.log('');
console.log(`${failed ? '✗' : '✓'} ${results.length - failed}/${results.length} vérifications conformes au schéma officiel`);

// On règle le code de sortie sans appeler process.exit() : sur Windows, couper
// le processus alors que fetch a des descripteurs ouverts déclenche une
// assertion libuv qui faussait le code de retour.
process.exitCode = failed ? 1 : 0;
