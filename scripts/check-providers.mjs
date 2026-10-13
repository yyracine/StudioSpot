/**
 * Vérifie la couche de fournisseurs SANS consommer de crédits.
 *
 * Pour chaque moteur : calcul du plan de production pour 5, 8 et 15 s, puis
 * description de la requête qui SERAIT envoyée (URL, en-têtes, corps) sans
 * l'envoyer. C'est ce qui permet de valider un adaptateur sans clé API.
 */
import { PROVIDERS, getProvider } from '../server/providers/index.js';

const results = [];
const check = (label, ok, extra = '') => {
  results.push([label, ok]);
  console.log(`   ${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`);
};

const line = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

console.log('Fournisseurs déclarés :\n');

for (const provider of PROVIDERS) {
  console.log(`── ${provider.label} (${provider.id}) ─────────────────────────`);
  console.log(`   configuré     : ${provider.isConfigured()}`);
  console.log(`   audio natif   : ${provider.capabilities.nativeAudio}`);
  console.log(`   texte rendu   : ${provider.capabilities.rendersText}`);
  console.log(`   extension     : ${provider.capabilities.extension}`);
  console.log('');

  // 1. Plan de production pour chaque durée demandée
  const plans = {};
  for (const durationId of ['5', '8', '15']) {
    const plan = provider.buildPlan({ durationId, aspectRatio: '16:9', resolution: '1080p' });
    plans[durationId] = plan;

    const steps = plan.steps.map((s) => `${s.kind} ${s.seconds}s`).join(' + ');
    console.log(
      `   ${durationId.padStart(2)} s demandées → ${String(plan.seconds).padStart(2)} s livrées · ` +
        `${plan.calls} appel(s) [${steps}] · coupe=${plan.trimTo ?? '—'} · ${plan.resolution}`,
    );
    console.log(`        « ${plan.note} »`);
  }

  check(`${provider.id} : plan cohérent pour les 3 durées`, Object.keys(plans).length === 3);
  check(
    `${provider.id} : au moins un appel déclaré`,
    Object.values(plans).every((plan) => plan.steps.length >= 1),
  );

  // `plan.seconds` est la durée PRODUITE par le moteur, `plan.trimTo` la coupe
  // finale. Ce qui est promis au client, c'est la durée livrée : on compare donc
  // `trimTo ?? seconds`, sinon un moteur qui produit 5,06 s pour une cible de
  // 5 s puis coupe à 5 s serait signalé à tort.
  const delivered = (plan) => plan.trimTo ?? plan.seconds;
  check(
    `${provider.id} : la durée livrée ne dépasse pas la durée demandée`,
    ['5', '8', '15'].every((id) => delivered(plans[id]) <= Number(id)),
    ['5', '8', '15'].map((id) => `${id}→${delivered(plans[id])}s`).join(' '),
  );
  check(
    `${provider.id} : 15 s atteintes ou limitation annoncée`,
    delivered(plans[15]) === 15 || Boolean(plans[15].limitedTo),
  );

  // 2. La requête qui serait envoyée, sans l'envoyer
  const preview = provider.describeRequest({
    plan: plans[8],
    model: 'modele-test',
    prompt: 'Un produit qui tourne, éclairage studio.',
    imagePath: null,
  });

  console.log(`\n   Requête qui SERAIT envoyée : ${line(preview.transport)}`);
  if (preview.url) console.log(`     ${preview.method} ${preview.url}`);
  if (preview.headers) console.log(`     en-têtes : ${line(preview.headers)}`);
  if (preview.config) console.log(`     config   : ${line(preview.config)}`);
  if (preview.body) console.log(`     corps    : ${line(preview.body).slice(0, 220)}`);
  if (preview.polling) console.log(`     suivi    : ${preview.polling.join(' puis ')}`);

  const serialized = JSON.stringify(preview);
  check(`${provider.id} : la requête contient le prompt`, serialized.includes('produit qui tourne'));
  check(
    `${provider.id} : aucun secret en clair dans l'aperçu`,
    !/AIza|r8_[A-Za-z0-9]|Key [0-9a-f]{8}-/.test(serialized),
  );
  check(`${provider.id} : une authentification est décrite`, /Authorization|x-goog|sdk/i.test(serialized));

  console.log('');
}

/* ----------------------------- cohérence globale ---------------------------- */
console.log('── Cohérence du registre ────────────────────────────────');
check('identifiants uniques', new Set(PROVIDERS.map((p) => p.id)).size === PROVIDERS.length);
check('chacun expose buildPlan', PROVIDERS.every((p) => typeof p.buildPlan === 'function'));
check('chacun expose generateClip', PROVIDERS.every((p) => typeof p.generateClip === 'function'));
check('chacun expose describeRequest', PROVIDERS.every((p) => typeof p.describeRequest === 'function'));
check('chacun a une source de clé', PROVIDERS.every((p) => typeof p.keyProvider === 'string'));

// Un fournisseur sans extension ne doit jamais annoncer une étape « extend ».
const coherent = PROVIDERS.every((provider) => {
  if (provider.capabilities.extension) return true;
  return ['5', '8', '15'].every((durationId) =>
    provider.buildPlan({ durationId, aspectRatio: '16:9', resolution: '720p' }).steps.every(
      (step) => step.kind !== 'extend',
    ),
  );
});
check('pas d’étape « extend » annoncée sans capacité d’extension', coherent);

const failed = results.filter(([, ok]) => !ok).length;
console.log(`\n${failed ? '✗' : '✓'} ${results.length - failed}/${results.length} vérifications réussies`);
process.exit(failed ? 1 : 0);
