/**
 * Vérifie que chaque type de vidéo et chaque ambiance produit un prompt
 * cohérent, et que la contrainte de présence humaine est bien transmise.
 */
import { buildMainPrompt } from '../server/prompts.js';
import { AMBIANCES, VIDEO_TYPES, findById } from '../server/config.js';
import veo from '../server/providers/veo.js';

const plan = veo.buildPlan({ durationId: '8', aspectRatio: '16:9', resolution: '720p' });

let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`   ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failed += 1;
};

console.log('Types de vidéo (prompt principal, 8 s, Veo) :\n');

for (const videoType of VIDEO_TYPES) {
  const prompt = buildMainPrompt({
    videoTypeId: videoType.id,
    ambianceId: 'corporate',
    textModeId: 'overlay',
    productName: 'Sneakers Aero Runner',
    adMessage: 'Nouveau ! -30% cette semaine',
    plan,
    nativeAudio: true,
  });

  const expectsPeople = videoType.needsPerson;
  const forbids = /No people anywhere in the frame/.test(prompt);
  const allows = /People may appear/.test(prompt);

  const ok =
    prompt.includes('Sneakers Aero Runner') &&
    /No people anywhere|People may appear/.test(prompt) &&
    (expectsPeople ? allows && !forbids : forbids && !allows);

  check(
    videoType.label.padEnd(34),
    ok,
    `${prompt.length} car. · ${expectsPeople ? 'personnes autorisées' : 'produit seul'}`,
  );
}

console.log('\nAmbiances (bloc audio transmis à un moteur à audio natif) :\n');

for (const ambiance of AMBIANCES) {
  const prompt = buildMainPrompt({
    videoTypeId: 'rotation360',
    ambianceId: ambiance.id,
    textModeId: 'overlay',
    productName: 'Produit',
    adMessage: 'Promo',
    plan,
    nativeAudio: true,
  });

  const hasBlock = /\n\nAudio: /.test(prompt);
  check(ambiance.label.padEnd(34), hasBlock, hasBlock ? 'bloc audio présent' : 'BLOQUANT : absent');
}

console.log('\nAmbiances avec un moteur SANS audio natif (le bloc audio doit disparaître) :\n');

for (const ambiance of AMBIANCES) {
  const prompt = buildMainPrompt({
    videoTypeId: 'rotation360',
    ambianceId: ambiance.id,
    textModeId: 'overlay',
    productName: 'Produit',
    adMessage: 'Promo',
    plan,
    nativeAudio: false,
  });
  check(ambiance.label.padEnd(34), !/\n\nAudio: /.test(prompt), 'bloc audio retiré');
}

console.log('');
if (failed) {
  console.log(`✗ ${failed} vérification(s) en échec`);
  process.exit(1);
}
console.log('✓ tous les types et ambiances produisent un prompt cohérent');

// Aperçu d'un prompt complet, pour contrôle visuel.
const sample = buildMainPrompt({
  videoTypeId: 'packshot',
  ambianceId: 'minimaliste',
  textModeId: 'overlay',
  productName: 'Sneakers Aero Runner',
  adMessage: 'Nouveau ! -30% cette semaine',
  plan,
  nativeAudio: true,
});
console.log('\n--- Exemple : Packshot publicitaire net + Minimaliste moderne ---\n');
console.log(sample);

const found = findById(VIDEO_TYPES, 'packshot');
console.log(`\nrepli hors ligne pour ce type : « ${found.fallbackAd('Sneakers Aero Runner')} »`);
