#!/usr/bin/env node
/**
 * Sonde de clé API Gemini.
 *
 * Détermine ce que la clé peut RÉELLEMENT appeler : texte, image, vidéo.
 * C'est l'outil qui permet de distinguer une vraie limite de débit d'une
 * simple absence d'accès (palier gratuit, facturation inactive).
 *
 * Les appels utilisés sont minimaux et sans coût significatif : une réponse
 * texte d'un mot, une vignette d'image. Un refus en 429 ne consomme rien.
 *
 * Usage : node scripts/probe-key.mjs
 */
import { readFileSync } from 'node:fs';

const key = (
  process.env.GEMINI_API_KEY ||
  readFileSync('.env', 'utf8').match(/^GEMINI_API_KEY\s*=\s*(.+)$/m)?.[1] ||
  ''
).trim();

if (!key) {
  console.error('Aucune clé trouvée. Renseignez GEMINI_API_KEY dans .env');
  process.exit(1);
}

console.log(`clé : ${key.length} caractères, préfixe « ${key.slice(0, 6)}… »`);
console.log(`\nSonde des familles de modèles :\n`);

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const auth = { 'x-goog-api-key': key };

/** Appel minimal : on ne regarde que l'acceptation ou le refus. */
async function probe(label, model, body) {
  try {
    const res = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (res.ok) {
      const parts = data.candidates?.[0]?.content?.parts || [];
      const kinds = parts.map((p) => Object.keys(p)[0]).join('+') || 'réponse vide';
      console.log(`   ✓ ${label.padEnd(36)} HTTP ${res.status} · ${kinds}`);
      return true;
    }

    const message = data.error?.message || '';
    const refused = /quota|RESOURCE_EXHAUSTED|billing|plan/i.test(message);
    console.log(
      `   ✗ ${label.padEnd(36)} HTTP ${res.status} · ${
        refused ? 'ACCÈS REFUSÉ (palier/facturation)' : message.slice(0, 80)
      }`,
    );
    return false;
  } catch (err) {
    console.log(`   ✗ ${label.padEnd(36)} erreur réseau : ${err.message}`);
    return false;
  }
}

const results = {
  texte: await probe('gemini-2.5-flash (texte)', 'gemini-2.5-flash', {
    contents: [{ parts: [{ text: 'Réponds UNIQUEMENT par: ok' }] }],
  }),
  image: await probe('gemini-2.5-flash-image (image)', 'gemini-2.5-flash-image', {
    contents: [{ parts: [{ text: 'Un carré bleu uni sur fond blanc' }] }],
  }),
};

console.log('\nGénération vidéo : dépend du fournisseur choisi, non sondée ici.\n');

console.log('Interprétation :');
if (results.texte && !results.image) {
  console.log(
    '   Seul le texte est accessible : le projet est sur un palier où la génération\n' +
      '   de médias n’est pas provisionnée. Le 429 « check your plan and billing\n' +
      '   details » de Google désigne alors l’absence de facturation, et non une\n' +
      '   limite temporaire. Solution : lier un compte de facturation au projet\n' +
      '   (passage au palier Tier 1).',
  );
} else if (results.texte && results.image) {
  console.log(
    '   Texte et image fonctionnent avec cette clé Google.\n' +
      '   Elle sert ici aux suggestions de messages, pas à la génération vidéo.',
  );
} else {
  console.log('   La clé semble inutilisable : vérifiez-la dans Google AI Studio.');
}
