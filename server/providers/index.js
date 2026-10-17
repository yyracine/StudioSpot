/**
 * Registre des fournisseurs de génération vidéo.
 *
 * Chaque fournisseur expose la même interface, ce qui permet au pipeline de
 * rester identique quel que soit le moteur :
 *
 *   {
 *     id, label, shortLabel, docsUrl, keyProvider, keyLabel, note,
 *     capabilities: { nativeAudio, rendersText, extension, aspectRatios, resolutions },
 *     isConfigured(): boolean,
 *     buildPlan({ durationId, aspectRatio, resolution }): Plan,
 *     buildConfig(plan): object,
 *     generateClip({ imagePath, prompt, plan, config, model, outputPath, onProgress }): Promise<{outputPath, ref}>,
 *     extendClip?({ previousRef, prompt, outputPath, onProgress }): Promise<{outputPath, ref}>,
 *     describeRequest(args): object,     // décrit l’appel SANS l’envoyer (testable)
 *     verifyKey?(): Promise<{ok: true}>,
 *   }
 *
 * Un « Plan » décrit la production réelle : combien d’appels, quelle durée
 * chacun, quelle coupe finale. C’est ce qui permet d’annoncer honnêtement au
 * client ce qui sera livré (5/8/15 s ne veulent pas dire la même chose partout).
 */
import fal from './fal.js';
import replicate from './replicate.js';

export const PROVIDERS = [fal, replicate];

export const getProvider = (id) => PROVIDERS.find((provider) => provider.id === id) || null;

/** Fournisseur imposé par l’environnement, s’il est utilisable. */
export const forcedProvider = () => {
  const id = (process.env.PROVIDER || '').trim();
  if (!id) return null;
  const provider = getProvider(id);
  if (!provider) {
    console.warn(`[providers] PROVIDER="${id}" est inconnu : ignoré.`);
    return null;
  }
  return provider;
};

/**
 * Choisit le fournisseur à utiliser :
 *   1. `PROVIDER` s’il est renseigné et configuré ;
 *   2. sinon le premier fournisseur disposant d’une clé, dans l’ordre déclaré ;
 *   3. sinon null → le pipeline bascule en rendu local de démonstration.
 */
export function resolveProvider() {
  const forced = forcedProvider();
  if (forced && forced.isConfigured()) return forced;
  if (forced && !forced.isConfigured()) {
    console.warn(`[providers] PROVIDER="${forced.id}" demandé mais aucune clé fournie : repli automatique.`);
  }
  return PROVIDERS.find((provider) => provider.isConfigured()) || null;
}

/** Vue exposée à l’interface. */
export const listProviders = () =>
  PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    shortLabel: provider.shortLabel,
    keyProvider: provider.keyProvider,
    keyLabel: provider.keyLabel,
    note: provider.note,
    docsUrl: provider.docsUrl,
    configured: provider.isConfigured(),
    capabilities: provider.capabilities,
  }));
