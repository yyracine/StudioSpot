/**
 * Couche ffmpeg : post-production video et rendu du mode demo.
 *
 * CONTRAINTE TECHNIQUE IMPORTANTE
 * -------------------------------
 * ffmpeg est lance avec `spawn` et des stdio LIEES A DES FICHIERS, jamais des
 * tuyaux (`stdio: 'pipe'`). Les environnements confinees (bacs a sable, CI
 * durcies) interdisent l'ouverture de tubes nommes pour les processus enfants
 * et renvoient alors `EPERM`. Ecrire stderr dans un fichier de log fonctionne
 * partout, et ce fichier sert aussi de diagnostic en cas d'erreur.
 */
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

let cachedPath = null;

/** Localise le binaire ffmpeg : variable d'env, paquet npm, puis PATH. */
export function ffmpegPath() {
  if (cachedPath) return cachedPath;

  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return (cachedPath = process.env.FFMPEG_PATH);
  }

  try {
    const bundled = require('@ffmpeg-installer/ffmpeg').path;
    if (bundled && existsSync(bundled)) return (cachedPath = bundled);
  } catch {
    /* paquet absent : on retombe sur le PATH systeme */
  }

  return (cachedPath = 'ffmpeg');
}

export class FfmpegError extends Error {
  constructor(message, { log = '', code = null, args = [] } = {}) {
    super(message);
    this.name = 'FfmpegError';
    this.log = log;
    this.code = code;
    this.args = args;
    // Le journal ffmpeg est remonté à l'interface comme détail technique.
    if (log) this.details = log.trim().slice(-1500);
  }
}

/**
 * Execute ffmpeg.
 *
 * stderr est écrit dans `logPath` via un descripteur de fichier (jamais un
 * tube) : les environnements confinés refusent les tubes nommés pour les
 * processus enfants et renvoient EPERM. Le journal sert aussi de diagnostic.
 *
 * @param {string[]} args
 * @param {{cwd?: string, logPath: string, timeoutMs?: number}} options
 * @returns {Promise<{code: number, log: string}>}
 */
export function run(args, { cwd, logPath, timeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    let fd;
    try {
      fd = openSync(logPath, 'w');
    } catch (err) {
      return reject(new FfmpegError(`Impossible d'ouvrir le journal ffmpeg : ${err.message}`));
    }

    let child;
    try {
      child = spawn(ffmpegPath(), ['-hide_banner', ...args], {
        cwd,
        windowsHide: true,
        // 'ignore' / descripteur de fichier : aucun tube nommé.
        stdio: ['ignore', 'ignore', fd],
      });
    } catch (err) {
      closeSync(fd);
      return reject(new FfmpegError(`Lancement de ffmpeg impossible : ${err.message}`));
    }

    let settled = false;
    let timer = null;

    /** Ferme le descripteur, relit le journal, puis tranche une seule fois. */
    const settle = async (outcome) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      closeSync(fd);

      const log = await readFile(logPath, 'utf8').catch(() => '');
      if (outcome.error) {
        reject(
          new FfmpegError(outcome.error, { log, code: outcome.code ?? null, args }),
        );
      } else {
        resolve({ code: 0, log });
      }
    };

    timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle({ error: 'ffmpeg a dépassé le temps imparti et a été interrompu.' });
    }, timeoutMs);

    child.on('error', (err) => settle({ error: `ffmpeg n'a pas pu démarrer : ${err.message}` }));
    child.on('close', (code) =>
      settle(code === 0 ? {} : { error: `ffmpeg a échoué (code ${code}).`, code }),
    );
  });
}

/** Lance ffmpeg en tolerant un code de sortie non nul (utile pour les sondes). */
async function runTolerant(args, options) {
  try {
    const { log } = await run(args, options);
    return log || '';
  } catch (err) {
    return err.log || '';
  }
}

/* ------------------------------------------------------------------ *
 * Polices
 * ------------------------------------------------------------------ */
const FONT_CANDIDATES = {
  win32: [
    'C:/Windows/Fonts/segoeuib.ttf',
    'C:/Windows/Fonts/arialbd.ttf',
    'C:/Windows/Fonts/calibrib.ttf',
    'C:/Windows/Fonts/verdanab.ttf',
  ],
  darwin: [
    '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
    '/Library/Fonts/Arial Bold.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
  ],
  linux: [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  ],
};

let cachedFont = null;

/** Retourne un chemin de police gras exploitable par drawtext, ou null. */
export function boldFontPath() {
  if (cachedFont) return cachedFont;
  const candidates = FONT_CANDIDATES[process.platform] || FONT_CANDIDATES.linux;
  for (const candidate of candidates) {
    if (existsSync(candidate)) return (cachedFont = candidate);
  }
  return null;
}

/** ffmpeg attend les ':' echappes a l'interieur d'une chaine de filtres. */
const escapeFilterPath = (p) => String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");

/* ------------------------------------------------------------------ *
 * Sondes
 * ------------------------------------------------------------------ */

/** Lit duree / dimensions via le log de ffmpeg (ffprobe n'est pas fourni). */
export async function probe(file, { cwd, logPath }) {
  const log = await runTolerant(['-i', path.resolve(file)], { cwd, logPath, timeoutMs: 60000 });
  const durationMatch = log.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  const streamMatch = log.match(/Video:.*?,\s*(\d{2,5})x(\d{2,5})[\s,]/);

  const duration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : null;

  return {
    duration,
    width: streamMatch ? Number(streamMatch[1]) : null,
    height: streamMatch ? Number(streamMatch[2]) : null,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(log),
  };
}

/* ------------------------------------------------------------------ *
 * Preparation de l'image
 * ------------------------------------------------------------------ */

/**
 * Normalise la photo source : orientation, taille raisonnable, JPEG qualite.
 * On evite ainsi d'envoyer a Veo des images trop lourdes ou dans un format
 * exotique.
 *
 * `src` peut etre hors du dossier de travail (photo televersee) : on le passe
 * en chemin absolu. Seule la sortie est exprimee relativement a `cwd`, car
 * elle n'apparait jamais dans une chaine de filtres.
 */
export async function normalizeImage(src, dst, { cwd, logPath, maxSide = 1920 }) {
  await run(
    [
      '-y',
      '-loglevel', 'warning',
      '-i', path.resolve(src),
      '-vf',
      `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))',format=yuvj420p`,
      '-q:v', '2',
      path.resolve(dst),
    ],
    { cwd, logPath },
  );
  return dst;
}

/** Extrait une image de poster pour le lecteur video. */
export async function extractPoster(src, dst, atSeconds, { cwd, logPath }) {
  await run(
    [
      '-y',
      '-loglevel', 'warning',
      '-ss', Math.max(0, atSeconds).toFixed(2),
      '-i', path.resolve(src),
      '-frames:v', '1',
      '-q:v', '3',
      path.resolve(dst),
    ],
    { cwd, logPath },
  );
  return dst;
}

/* ------------------------------------------------------------------ *
 * Habillage texte (incrustation)
 * ------------------------------------------------------------------ */

/** Decoupe un message en lignes courtes pour un rendu propre a l'ecran. */
export function wrapText(text, maxCharsPerLine = 26, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);

  // Tronque proprement si le message reste trop long.
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').length;
    if (consumed < String(text).replace(/\s+/g, ' ').trim().length) {
      let last = lines[maxLines - 1];
      while (last.length > maxCharsPerLine - 1) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last.trimEnd()}…`;
    }
  }
  return lines;
}

const round = (n) => Math.round(n);

/**
 * Construit la chaine de filtres drawtext de l'habillage publicitaire
 * (nom du produit + message), avec apparition/disparition en fondu.
 */
export function buildOverlayFilter({
  width,
  height,
  duration,
  productName,
  adMessage,
  textFile = 'overlay.txt',
  fontFile,
  textFileAlt = null,
  fontFileAlt = null,
}) {
  const filters = [];

  const fadeInStart = 0.3;
  const fadeInDur = 0.45;
  const fadeOutDur = Math.min(0.6, Math.max(0.3, duration * 0.08));

  // Fondu commun : apparition puis maintien puis disparition.
  const alpha =
    `min(1\\,max(0\\,(t-${fadeInStart})/${fadeInDur}))` +
    `*min(1\\,max(0\\,(${round(duration * 100) / 100}-t)/${round(fadeOutDur * 100) / 100}))`;

  const safeTop = round(height * 0.055);

  if (textFileAlt) {
    // Bandeau haut : nom du produit, petites capitales.
    filters.push(
      [
        `drawtext=fontfile='${escapeFilterPath(fontFileAlt)}'`,
        `textfile='${escapeFilterPath(textFileAlt)}'`,
        `fontcolor=0xFFC46B`,
        `fontsize=${round(height * 0.036)}`,
        `box=1`,
        `boxcolor=0x0B0B0F@0.55`,
        `boxborderw=${round(height * 0.016)}`,
        `x=(w-text_w)/2`,
        `y=${safeTop}`,
        `alpha='${alpha}'`,
        `shadowcolor=0x000000@0.65`,
        `shadowx=2`,
        `shadowy=2`,
      ].join(':'),
    );
  }

  // Message publicitaire : bloc principal, tiers bas du cadre.
  filters.push(
    [
      `drawtext=fontfile='${escapeFilterPath(fontFile)}'`,
      `textfile='${escapeFilterPath(textFile)}'`,
      'fontcolor=white',
      `fontsize=${round(height * 0.072)}`,
      'line_spacing=' + round(height * 0.018),
      'box=1',
      'boxcolor=0x0B0B0F@0.52',
      `boxborderw=${round(height * 0.024)}`,
      'x=(w-text_w)/2',
      `y=h*0.70-text_h/2`,
      `alpha='${alpha}'`,
      'shadowcolor=0x000000@0.7',
      'shadowx=2',
      'shadowy=3',
    ].join(':'),
  );

  return filters.join(',');
}

/**
 * Incruste l'habillage texte dans une video.
 * En mode "Pas de son", la piste audio est supprimee en meme temps.
 */
export async function burnOverlay(
  src,
  dst,
  { cwd, logPath, productName, adMessage, duration, width, height, removeAudio = false, trimTo = null },
) {
  const font = boldFontPath();
  const textFile = 'overlay-message.txt';
  const textFileAlt = 'overlay-name.txt';

  await writeFile(path.join(cwd, textFile), wrapText(adMessage).join('\n'), 'utf8');
  const nameText = String(productName || '').trim().toUpperCase();
  if (nameText) await writeFile(path.join(cwd, textFileAlt), nameText, 'utf8');

  const vf = buildOverlayFilter({
    width,
    height,
    duration,
    productName,
    adMessage,
    textFile,
    fontFile: font,
    textFileAlt: nameText ? textFileAlt : null,
    fontFileAlt: font,
  });

  const args = ['-y', '-loglevel', 'warning', '-i', path.resolve(src), '-vf', vf];
  // La coupe exacte est faite dans la meme passe d'encodage pour eviter une
  // double recompression.
  if (trimTo) args.push('-t', trimTo.toFixed(3));
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p');
  if (removeAudio) args.push('-an');
  else args.push('-c:a', 'copy');
  args.push('-movflags', '+faststart', path.resolve(dst));

  await run(args, { cwd, logPath });
  return dst;
}

/* ------------------------------------------------------------------ *
 * Coupe / audio
 * ------------------------------------------------------------------ */

/** Coupe la video a la duree exacte demandee (ex. 6 s generees -> 5,0 s). */
export async function trimPrecise(src, dst, seconds, { cwd, logPath, removeAudio = false }) {
  const args = [
    '-y',
    '-loglevel', 'warning',
    '-i', path.resolve(src),
    '-t', seconds.toFixed(3),
  ];
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p');
  if (removeAudio) args.push('-an');
  else args.push('-c:a', 'copy');
  args.push('-movflags', '+faststart', path.resolve(dst));

  await run(args, { cwd, logPath });
  return dst;
}

/** Supprime uniquement la piste audio (option "Pas de son"). */
export async function stripAudio(src, dst, { cwd, logPath }) {
  await run(
    [
      '-y',
      '-loglevel', 'warning',
      '-i', path.resolve(src),
      '-c:v', 'copy',
      '-an',
      '-movflags', '+faststart',
      path.resolve(dst),
    ],
    { cwd, logPath },
  );
  return dst;
}

/** Recopie sans re-encodage (sert a normaliser un conteneur). */
export async function remux(src, dst, { cwd, logPath }) {
  await run(
    [
      '-y',
      '-loglevel', 'warning',
      '-i', path.resolve(src),
      '-c', 'copy',
      '-movflags', '+faststart',
      path.resolve(dst),
    ],
    { cwd, logPath },
  );
  return dst;
}

/**
 * Ajoute une nappe sonore synthetisee a une video muette.
 *
 * Sert aux fournisseurs qui ne generent pas d'audio (fal, Replicate) : la video
 * arrive sans piste son, et l'ambiance choisie est produite localement. C'est
 * une nappe d'accompagnement, pas une musique produite : elle assure la
 * coherence de l'ambiance sans pretendre remplacer une vraie bande son.
 */
export async function muxAmbianceAudio(src, dst, { ambiance, seconds, cwd, logPath }) {
  const audioSource = demoAudioSource(ambiance, seconds);
  if (!audioSource) return remux(src, dst, { cwd, logPath });

  const fadeOutStart = Math.max(0, seconds - 0.8);
  await run(
    [
      '-y',
      '-loglevel', 'warning',
      '-i', path.resolve(src),
      '-f', 'lavfi',
      '-i', audioSource,
      '-ac', '2',
      '-af', `volume=0.9,afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.8`,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-shortest',
      '-movflags', '+faststart',
      path.resolve(dst),
    ],
    { cwd, logPath },
  );
  return dst;
}

/* ------------------------------------------------------------------ *
 * Mode demo : rendu local a partir de la photo, sans cle API
 * ------------------------------------------------------------------ */

/** Construit la source audio synthetisee d'une ambiance de demonstration. */
function demoAudioSource(ambiance, seconds, fps = 44100) {
  if (!ambiance.demo) return null;
  const { freqs, tremoloHz, tremoloDepth, volume } = ambiance.demo;
  const weights = [1, 0.8, 0.7];
  const sum = freqs
    .map((f, i) => `${weights[i] ?? 0.6}*sin(2*PI*${f}*t)`)
    .join('+');
  const pulse = `(${(1 - tremoloDepth).toFixed(3)}+${tremoloDepth}*sin(2*PI*${tremoloHz}*t))`;
  return `aevalsrc=${volume}*(${sum})*${pulse}:s=${fps}:d=${seconds}`;
}

/**
 * Rend une video publicitaire localement (Ken Burns + habillage + nappe sonore).
 * Utilise quand aucune cle API n'est disponible : l'application reste
 * completement testable, et l'habillage texte est identique a la version Veo.
 */
export async function renderDemoVideo({
  imagePath,
  outPath,
  seconds,
  width,
  height,
  productName,
  adMessage,
  ambiance,
  removeAudio,
  cwd,
  logPath,
}) {
  const fps = 30;
  const frames = Math.max(1, Math.round(seconds * fps));
  const font = boldFontPath();

  const vf = [
    // Couvre le cadre cible puis agrandit pour eviter les saccades du zoompan.
    `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase`,
    `crop=${width * 2}:${height * 2}`,
    `zoompan=z='min(zoom+0.00045,1.22)':d=${frames}:` +
      `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`,
  ].join(',');

  const textFile = 'overlay-message.txt';
  const textFileAlt = 'overlay-name.txt';
  await writeFile(path.join(cwd, textFile), wrapText(adMessage).join('\n'), 'utf8');
  const nameText = String(productName || '').trim().toUpperCase();
  if (nameText) await writeFile(path.join(cwd, textFileAlt), nameText, 'utf8');

  const overlay = buildOverlayFilter({
    width,
    height,
    duration: seconds,
    productName,
    adMessage,
    textFile,
    fontFile: font,
    textFileAlt: nameText ? textFileAlt : null,
    fontFileAlt: font,
  });

  const args = ['-y', '-loglevel', 'warning', '-i', path.resolve(imagePath)];

  const audioSource = removeAudio ? null : demoAudioSource(ambiance, seconds);
  if (audioSource) {
    args.push('-f', 'lavfi', '-i', audioSource, '-ac', '2');
  }

  args.push('-vf', `${vf},${overlay},format=yuv420p`);
  args.push('-t', seconds.toFixed(3), '-r', String(fps));
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20');

  if (audioSource) {
    const fadeOutStart = Math.max(0, seconds - 0.8);
    args.push(
      '-af',
      `volume=0.9,afade=t=in:st=0:d=0.6,afade=t=out:st=${fadeOutStart.toFixed(2)}:d=0.8`,
      '-c:a', 'aac', '-b:a', '160k',
    );
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', path.resolve(outPath));

  await run(args, { cwd, logPath });
  return outPath;
}
