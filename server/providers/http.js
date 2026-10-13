/**
 * Outils partagés par les fournisseurs de génération vidéo.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ProviderError extends Error {
  constructor(message, { hint = null, details = null, cause = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.hint = hint;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

export const mimeFor = (file) => MIME_BY_EXT[path.extname(file).toLowerCase()] || 'image/jpeg';

/** Image encodée en data URI : format accepté par la plupart des API. */
export async function toDataUri(file) {
  const bytes = await readFile(file);
  return `data:${mimeFor(file)};base64,${bytes.toString('base64')}`;
}

export const toBase64 = async (file) => (await readFile(file)).toString('base64');

/**
 * Requête JSON avec message d'erreur exploitable.
 * Le corps d'erreur est conservé : c'est lui qui permet de distinguer un quota
 * d'une clé invalide.
 */
export async function fetchJson(url, { method = 'GET', headers = {}, body, signal } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ProviderError('Impossible de joindre le service de génération.', {
      hint: 'Vérifiez votre connexion réseau.',
      details: err.message,
      cause: err,
    });
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 800) };
  }

  if (!response.ok) {
    const message =
      data?.error?.message || data?.detail || data?.message || data?.raw || `HTTP ${response.status}`;
    const details = typeof message === 'string' ? message : JSON.stringify(message);

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError('Clé API refusée par le service.', {
        hint: 'Vérifiez la clé dans les réglages : elle est peut-être expirée ou sans droits.',
        details,
      });
    }
    if (response.status === 402 || /insufficient|credit|balance|quota|billing/i.test(details)) {
      throw new ProviderError('Crédits ou quota insuffisants chez le fournisseur.', {
        hint: 'Rechargez votre compte ou changez de fournisseur dans les options avancées.',
        details,
      });
    }
    if (response.status === 429) {
      throw new ProviderError('Le fournisseur limite le débit (429).', {
        hint: 'Patientez une minute, ou réduisez la cadence des générations.',
        details,
      });
    }
    throw new ProviderError(`Le fournisseur a renvoyé une erreur (HTTP ${response.status}).`, {
      details,
    });
  }

  return data;
}

/**
 * Interroge périodiquement une opération jusqu'à son aboutissement.
 * @param {object} params
 * @param {() => Promise<{done: boolean, result?: any}>} params.step
 * @param {(info: {elapsedMs: number}) => void} [params.onProgress]
 */
export async function pollUntil({ step, intervalMs = 5000, timeoutMs = 14 * 60 * 1000, onProgress, label }) {
  const startedAt = Date.now();

  for (;;) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > timeoutMs) {
      throw new ProviderError(`${label || 'La génération'} n’a pas abouti dans le délai imparti.`, {
        hint: 'Réessayez : aux heures de pointe, une génération peut être beaucoup plus lente.',
      });
    }

    onProgress?.({ elapsedMs });

    const { done, result } = await step();
    if (done) return result;

    await sleep(intervalMs);
  }
}

/** Télécharge un fichier distant vers le disque. */
export async function downloadTo(url, outputPath) {
  let response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (err) {
    throw new ProviderError('Téléchargement de la vidéo impossible.', { details: err.message });
  }

  if (!response.ok) {
    throw new ProviderError(`Téléchargement refusé (HTTP ${response.status}).`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000) {
    throw new ProviderError('Le fichier téléchargé est anormalement petit.', {
      details: `${bytes.length} octets`,
    });
  }
  await writeFile(outputPath, bytes);
  return outputPath;
}

/** Première URL vidéo trouvée dans une réponse de fournisseur. */
export function findVideoUrl(payload) {
  const seen = new Set();
  const walk = (value) => {
    if (!value || typeof value !== 'object' || seen.has(value)) return null;
    seen.add(value);

    if (typeof value === 'string' && /^https?:\/\/\S+\.(mp4|webm|mov)(\?\S*)?$/i.test(value)) {
      return value;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item);
        if (found) return found;
      }
      return null;
    }
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' && /^(url|video|video_url|file|output)$/i.test(key) && /^https?:\/\//i.test(item)) {
        return item;
      }
      const found = walk(item);
      if (found) return found;
    }
    return null;
  };
  return walk(payload);
}
