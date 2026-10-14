#!/usr/bin/env node
/**
 * Détecte les conflits entre l'attribut `hidden` et les règles CSS.
 *
 * Le piège : le navigateur applique `[hidden] { display: none }`, mais une
 * règle d'auteur comme `.stage-placeholder { display: flex }` l'écrase. Le code
 * JavaScript peut alors écrire `element.hidden = true` sans aucun effet —
 * l'élément reste affiché.
 *
 * C'est ce qui faisait que le placeholder « Votre vidéo apparaîtra ici »
 * recouvrait la vidéo pourtant générée : l'application semblait ne rien
 * produire, alors que le fichier existait.
 *
 * Ce contrôle relit app.js, repère les éléments masqués, retrouve leurs classes
 * dans index.html et vérifie qu'aucune règle CSS ne fixe `display` sur l'un
 * d'eux sans qu'un `[hidden]` prioritaire ne neutralise le conflit.
 *
 * Usage : node scripts/check-ui-hidden.mjs
 */
import { readFileSync } from 'node:fs';

const app = readFileSync('public/app.js', 'utf8');
const html = readFileSync('public/index.html', 'utf8');
const css = readFileSync('public/styles.css', 'utf8');

/* --------- 1. Le garde-fou global est-il présent ? --------- */
const hasGlobalGuard = /\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(css);

/* --------- 2. Éléments dont on bascule la visibilité en JS --------- */
/** `$('id').hidden = …` */
const directIds = new Set(
  [...app.matchAll(/\$\('([A-Za-z0-9_]+)'\)\.hidden\s*=/g)].map((m) => m[1]),
);

/** `const x = $('id'); … x.hidden = …` (cas du placeholder et du média) */
for (const match of app.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*\$\('([A-Za-z0-9_]+)'\)/g)) {
  const [, variable, id] = match;
  if (directIds.has(id)) continue;
  const used = new RegExp(`\\b${variable}\\.hidden\\s*=`).test(app);
  if (used) directIds.add(id);
}

/** Récupère les classes d'un identifiant dans index.html. */
function classesOf(id) {
  const line = html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`));
  if (!line) return [];
  const classAttribute = line[0].match(/class="([^"]*)"/);
  return classAttribute ? classAttribute[1].split(/\s+/).filter(Boolean) : [];
}

/** Vrai si une règle CSS fixe `display` pour l'un de ces sélecteurs. */
function displayRuleFor(classes, id) {
  const selectors = [...classes.map((name) => `.${name}`), `#${id}`];
  for (const selector of selectors) {
    const pattern = new RegExp(
      `(^|[,\\s])${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,[^{]*)?\\{([^}]*)\\}`,
      'g',
    );
    for (const match of css.matchAll(pattern)) {
      const display = match[3].match(/display:\s*([a-z-]+)/);
      if (display) return `${selector} → display: ${display[1]}`;
    }
  }
  return null;
}

console.log(`Éléments masqués depuis app.js : ${directIds.size}\n`);

const results = [];
const conflicts = [];

for (const id of [...directIds].sort()) {
  const classes = classesOf(id);
  const rule = displayRuleFor(classes, id);
  const ok = !rule || hasGlobalGuard;
  results.push([id, ok, rule]);

  const status = rule ? (hasGlobalGuard ? '⚠ neutralisé' : '✗ CONFLIT') : '✓';
  console.log(`   ${status.padEnd(13)} #${id}${rule ? `  (${rule})` : ''}`);
  if (rule && !hasGlobalGuard) conflicts.push(id);
}

console.log('');
if (!hasGlobalGuard) {
  console.log('✗ La règle globale `[hidden] { display: none !important }` est ABSENTE de styles.css.');
  if (conflicts.length) {
    console.log(`  ${conflicts.length} élément(s) resteraient visibles malgré hidden = true :`);
    for (const id of conflicts) console.log(`    - #${id}`);
  }
  process.exitCode = 1;
} else {
  const neutralised = results.filter(([, , rule]) => rule).length;
  console.log(
    `✓ garde-fou global présent : ${neutralised} conflit(s) potentiel(s) neutralisé(s) sur ` +
      `${results.length} élément(s) masqué(s)`,
  );
  process.exitCode = 0;
}
