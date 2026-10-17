/**
 * Reconnaissance automatique d'une clé API à partir de sa forme.
 *
 * Objectif : l'utilisateur colle UNE clé, sans avoir à choisir un fournisseur
 * dans une liste. On déduit à qui elle appartient d'après son format, puis on
 * la range au bon endroit.
 *
 * Chaque format est décrit par une expression régulière volontairement large :
 * mieux vaut reconnaître une clé valide au format légèrement évolué que la
 * rejeter. En cas d'échec, on renvoie `null` et l'appelant explique les formes
 * acceptées — on ne devine jamais au hasard.
 */
import { KEY_SOURCES } from './config.js';

/**
 * Formats reconnus, du plus spécifique au plus général.
 * `test` reçoit la clé déjà nettoyée (sans espaces).
 */
export const KEY_FORMATS = [
  {
    source: 'replicate',
    label: 'Replicate',
    // Les jetons Replicate commencent tous par « r8_ ».
    test: (value) => /^r8_[A-Za-z0-9]{20,}$/.test(value),
    describe: 'commence par « r8_ »',
  },
  {
    source: 'fal',
    label: 'fal.ai',
    // Clé au format « identifiant:secret » (UUID puis empreinte hexadécimale).
    test: (value) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{16,}$/i.test(value),
    describe: 'au format « xxxxxxxx-xxxx-…:secret »',
  },
  {
    source: 'gemini',
    label: 'Google AI Studio',
    // Anciennes clés (AIza…) et nouvelles (AQ.…).
    test: (value) => /^(AIza[0-9A-Za-z_-]{20,}|AQ\.[A-Za-z0-9_.-]{20,})$/.test(value),
    describe: 'commence par « AIza » ou « AQ. »',
  },
];

/** Nettoie une clé collée (espaces, retours à la ligne, guillemets parasites). */
export const normalizeKey = (value) =>
  String(value ?? '')
    .replace(/[\s"'`]/g, '')
    .trim();

/**
 * Identifie la source d'une clé.
 * @returns {{source: string, label: string} | null}
 */
export function detectKeySource(value) {
  const key = normalizeKey(value);
  if (!key) return null;

  const format = KEY_FORMATS.find((candidate) => candidate.test(key));
  if (!format) return null;

  return { source: format.source, label: format.label, key };
}

/** Liste des formes acceptées, pour guider l'utilisateur. */
export const acceptedFormats = () =>
  KEY_FORMATS.map(({ source, label, describe }) => ({
    source,
    label,
    describe,
    purpose: KEY_SOURCES[source]?.purpose || null,
    docsUrl: KEY_SOURCES[source]?.docsUrl || null,
    example: KEY_SOURCES[source]?.example || null,
  }));
