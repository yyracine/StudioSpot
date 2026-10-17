#!/usr/bin/env node
/**
 * Test de bout en bout de l'application.
 *
 * Déroulé :
 *   1. fabrique une photo produit synthétique avec ffmpeg ;
 *   2. envoie le formulaire complet à POST /api/jobs (multipart) ;
 *   3. suit l'avancement réel de la tâche ;
 *   4. télécharge la vidéo finale et vérifie sa durée, sa définition et sa
 *      piste audio (présente ou non).
 *
 * Aucune clé API n'est nécessaire : le test force explicitement le mode démo
 * local (`mode: 'demo'`), ce qui exerce exactement le même chemin de
 * post-production (habillage texte ffmpeg, coupe, suppression audio) sans
 * consommer le moindre crédit chez un fournisseur.
 *
 * Usage :
 *   node scripts/smoke-test.mjs                  # 8 s, ambiance corporate
 *   node scripts/smoke-test.mjs --duration 5
 *   node scripts/smoke-test.mjs --duration 15 --ambiance aucun --vertical
 *   node scripts/smoke-test.mjs --engine         # vrai appel au moteur (payant)
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { closeSync, existsSync, openSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);

/* ----------------------------- arguments ----------------------------- */
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const PORT = Number(process.env.PORT || 5178);
const BASE = `http://127.0.0.1:${PORT}`;
const DURATION = arg('duration', '8');
const AMBIANCE = arg('ambiance', 'corporate');
const VIDEO_TYPE = arg('videoType', 'rotation360');
const TEXT_MODE = arg('textMode', 'overlay');
const VERTICAL = flag('vertical');

const TMP = path.resolve('outputs', '_smoke');
const PHOTO = path.join(TMP, VERTICAL ? 'produit-vertical.jpg' : 'produit-paysage.jpg');

const ffmpeg = () => {
  try {
    return require('@ffmpeg-installer/ffmpeg').path;
  } catch {
    return process.env.FFMPEG_PATH || 'ffmpeg';
  }
};

/**
 * Exécute ffmpeg avec stderr écrit dans un fichier via un descripteur —
 * jamais dans un tube : certains environnements confinés refusent les tubes
 * nommés (EPERM).
 */
async function runFfmpeg(args, logPath, { tolerant = false } = {}) {
  const fd = openSync(logPath, 'w');
  try {
    const code = await new Promise((resolve, reject) => {
      const child = spawn(ffmpeg(), ['-hide_banner', ...args], {
        stdio: ['ignore', 'ignore', fd],
      });
      child.on('error', reject);
      child.on('close', resolve);
    });

    const log = await readFile(logPath, 'utf8').catch(() => '');
    // Une sonde (`-i fichier` sans sortie) se termine toujours par un code 1 :
    // seul le contenu du journal nous intéresse alors.
    if (code !== 0 && !tolerant) throw new Error(`ffmpeg code ${code}\n${log.slice(-800)}`);
    return log;
  } finally {
    closeSync(fd);
  }
}

/** Requête HTTP avec le module natif (fetch est filtré dans certains bacs à sable). */
function request(method, urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const req = http.request(
      {
        method,
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        headers,
        timeout: 30_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('délai dépassé'));
    });
    if (body) req.write(body);
    req.end();
  });
}

const getJson = async (urlPath) => {
  const res = await request('GET', urlPath);
  return { status: res.status, data: JSON.parse(res.buffer.toString('utf8')) };
};

/** Construit un corps multipart/form-data sans dépendance externe. */
function multipart(fields, file) {
  const boundary = `----smoke${Date.now().toString(16)}`;
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.mimeType}\r\n\r\n`,
    ),
    file.data,
    Buffer.from('\r\n'),
  );
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/* --------------------------- 1. photo test --------------------------- */
async function ensurePhoto() {
  if (existsSync(PHOTO)) return;

  await mkdir(TMP, { recursive: true });
  const w = VERTICAL ? 900 : 1600;
  const h = VERTICAL ? 1600 : 1200;
  const font = 'C\\:/Windows/Fonts/segoeuib.ttf';
  const r = Math.round;

  // Une « photo produit » synthétique : fond en deux tons, objet, étiquette.
  // drawbox n'accepte que des constantes : tous les calculs sont faits ici.
  const filter = [
    `drawbox=x=0:y=0:w=${w}:h=${r(h * 0.55)}:color=0x8FA6C4:t=fill`,
    `drawbox=x=0:y=${r(h * 0.55)}:w=${w}:h=${r(h * 0.45)}:color=0x2B3242:t=fill`,
    `drawbox=x=${r(w * 0.3)}:y=${r(h * 0.28)}:w=${r(w * 0.4)}:h=${r(h * 0.34)}:color=0xE9E4DA:t=fill`,
    `drawbox=x=${r(w * 0.32)}:y=${r(h * 0.32)}:w=${r(w * 0.36)}:h=${r(h * 0.06)}:color=0xC96F45:t=fill`,
    `drawtext=fontfile='${font}':text='PRODUIT TEST':fontcolor=0x2B3242:fontsize=${r(h * 0.055)}:x=(w-text_w)/2:y=${r(h * 0.68)}`,
    `drawtext=fontfile='${font}':text='DEMO':fontcolor=0xE9E4DA:fontsize=${r(h * 0.032)}:x=(w-text_w)/2:y=${r(h * 0.76)}`,
  ].join(',');

  await runFfmpeg(
    [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=0xF2F2F2:s=${w}x${h}`,
      '-vf', filter,
      '-frames:v', '1',
      '-q:v', '2',
      PHOTO,
    ],
    path.join(TMP, 'photo.log'),
  );

  console.log(`✓ photo de test créée : ${PHOTO} (${w}×${h})`);
}

/* ------------------------------ déroulé ------------------------------ */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Vérifie que chaque identifiant DOM utilisé par app.js existe bien dans
 * index.html. Une simple faute de frappe casserait l'interface au chargement,
 * et ce genre d'erreur est invisible côté serveur.
 */
async function auditUi() {
  const html = await readFile(path.resolve('public/index.html'), 'utf8');
  const js = await readFile(path.resolve('public/app.js'), 'utf8');

  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const refs = new Set([
    ...[...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]),
    ...[...js.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]),
  ]);

  const missing = [...refs].filter((id) => !htmlIds.has(id));
  if (missing.length) {
    throw new Error(`index.html ne contient pas : ${missing.join(', ')}`);
  }
  console.log(`✓ interface : ${refs.size} identifiants DOM cohérents avec index.html`);
}

/**
 * Vérifie que les catalogues exposés à l'interface contiennent au moins les
 * choix du cahier des charges initial — et que les ajouts restent cohérents.
 *
 * On teste la présence des entrées exigées plutôt qu'un nombre figé : le
 * catalogue est destiné à s'enrichir, mais rien de ce qui était demandé ne doit
 * jamais disparaître.
 */
async function auditCatalog() {
  const { data } = await getJson('/api/options');
  const labels = (list) => list.map((item) => item.label);

  const videoTypes = labels(data.videoTypes);
  const ambiances = labels(data.ambiances);
  const durations = labels(data.durations);

  const required = [
    ['rotation 360°', videoTypes.some((l) => /360/.test(l))],
    ['produit en action', videoTypes.some((l) => /action/i.test(l))],
    ['unboxing', videoTypes.some((l) => /nboxing/.test(l))],
    ['avant/après', videoTypes.some((l) => /Avant/.test(l))],
    ['corporate', ambiances.some((l) => /Corporate/.test(l))],
    ['énergique', ambiances.some((l) => /nergique/.test(l))],
    ['luxe', ambiances.some((l) => /Luxe/.test(l))],
    ['pas de son', ambiances.some((l) => /Pas de son/.test(l))],
    ['durées 5/8/15 s', durations.join() === '5 secondes,8 secondes,15 secondes'],
  ];

  // Cohérence des enrichissements : identifiants uniques, tous documentés.
  const coherence = [
    ['identifiants de types uniques', new Set(data.videoTypes.map((t) => t.id)).size === data.videoTypes.length],
    ['identifiants d’ambiances uniques', new Set(data.ambiances.map((a) => a.id)).size === data.ambiances.length],
    ['chaque type a un libellé et une aide', data.videoTypes.every((t) => t.label && t.hint)],
    ['chaque ambiance a un libellé et une aide', data.ambiances.every((a) => a.label && a.hint)],
    ['« Pas de son » toujours présent en dernier', /Pas de son/.test(ambiances[ambiances.length - 1])],
  ];

  const wrong = [...required, ...coherence].filter(([, ok]) => !ok).map(([label]) => label);
  if (wrong.length) throw new Error(`catalogues incomplets : ${wrong.join(', ')}`);

  console.log(
    `✓ catalogues conformes (${videoTypes.length} types de vidéo · ${ambiances.length} ambiances · ` +
      'durées 5/8/15 s) — toutes les entrées exigées sont présentes',
  );
}

async function main() {
  const health = await getJson('/api/health').catch(() => null);
  if (!health || health.status !== 200) {
    throw new Error(`Serveur injoignable sur ${BASE}. Lancez « npm start » d'abord.`);
  }
  console.log(`✓ serveur en ligne · mode ${health.data.mode} · ffmpeg ${health.data.ffmpeg ? 'ok' : 'ABSENT'}`);
  if (!health.data.ffmpeg) throw new Error('ffmpeg introuvable : la post-production est impossible.');

  await auditUi();
  await auditCatalog();
  await ensurePhoto();

  const fields = {
    productName: 'Sneakers Aero Runner',
    adMessage: 'Nouveau ! -30% cette semaine',
    videoTypeId: VIDEO_TYPE,
    ambianceId: AMBIANCE,
    durationId: DURATION,
    textModeId: TEXT_MODE,
    aspectRatio: 'auto',
    resolution: '720p',
  };

  // Par défaut, on impose le rendu local : le test reste gratuit, déterministe
  // et vérifie le même chemin de post-production. `--engine` lance un vrai appel.
  const useEngine = flag('engine');
  if (!useEngine) fields.mode = 'demo';

  const { body, contentType } = multipart(fields, {
    filename: path.basename(PHOTO),
    mimeType: 'image/jpeg',
    data: await readFile(PHOTO),
  });

  console.log(
    `→ production ${DURATION} s · ${AMBIANCE} · ${VIDEO_TYPE} · texte=${TEXT_MODE} · moteur=${
      useEngine ? 'fournisseur distant (appel réel, payant)' : 'démo locale'
    }`,
  );
  const created = await request('POST', '/api/jobs', {
    body,
    headers: { 'Content-Type': contentType, 'Content-Length': body.length },
  });

  if (created.status !== 202) {
    throw new Error(`POST /api/jobs a renvoyé ${created.status} : ${created.buffer.toString('utf8').slice(0, 300)}`);
  }

  const jobId = JSON.parse(created.buffer.toString('utf8')).job.id;
  const startedAt = Date.now();
  let lastLine = '';
  let job = null;

  while (Date.now() - startedAt < 6 * 60 * 1000) {
    const { data } = await getJson(`/api/jobs/${jobId}`);
    job = data.job;

    const line = `${String(job.progress).padStart(3)} % · ${job.stageLabel}${job.detail ? ` · ${job.detail}` : ''}`;
    if (line !== lastLine) {
      console.log(`   ${line}`);
      lastLine = line;
    }

    if (job.status === 'done' || job.status === 'error') break;
    await sleep(1200);
  }

  if (!job || job.status !== 'done') {
    const error = job?.error;
    throw new Error(`production en échec : ${error?.message || 'inconnue'}${error?.details ? `\n${error.details}` : ''}`);
  }

  console.log('');
  console.log('✓ production terminée');
  console.log(`   durée      ${job.result.durationSec} s`);
  console.log(`   image      ${job.result.width}×${job.result.height} (${job.result.aspectRatio})`);
  console.log(`   audio      ${job.result.hasAudio ? job.result.audioLabel : 'AUCUN (muet)'}`);
  console.log(`   moteur     ${job.result.mode}`);
  console.log(`   poids      ${(job.result.sizeBytes / 1048576).toFixed(2)} Mo`);

  /* ------------------------- vérifications finales ------------------------ */
  const video = await request('GET', `/api/jobs/${jobId}/video`);
  if (video.status !== 200) throw new Error(`téléchargement de la vidéo : HTTP ${video.status}`);

  const finalPath = path.join(TMP, `final-${DURATION}s-${AMBIANCE}-${TEXT_MODE}.mp4`);
  await writeFile(finalPath, video.buffer);

  const probeLog = await runFfmpeg(['-i', finalPath], path.join(TMP, 'probe.log'), { tolerant: true });
  const durationMatch = probeLog.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  const realDuration = durationMatch
    ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + Number(durationMatch[3])
    : null;
  const hasAudioStream = /Stream #\d+:\d+.*: Audio:/.test(probeLog);

  const checks = [];
  const tolerance = 0.45;

  checks.push(['durée conforme', realDuration !== null && Math.abs(realDuration - Number(DURATION)) <= tolerance]);
  checks.push([
    'audio conforme',
    AMBIANCE === 'aucun' ? hasAudioStream === false : hasAudioStream === true,
  ]);
  checks.push(['fichier non vide', video.buffer.length > 20_000]);
  if (!useEngine) checks.push(['moteur = rendu local', job.result.mode === 'demo', job.result.mode]);

  const poster = await request('GET', `/api/jobs/${jobId}/poster`);
  checks.push(['poster disponible', poster.status === 200 && poster.buffer.length > 1000]);

  // Le lecteur du navigateur a besoin des requêtes partielles pour permettre
  // de se déplacer dans la timeline.
  const ranged = await request('GET', `/api/jobs/${jobId}/video`, {
    headers: { Range: 'bytes=0-99' },
  });
  checks.push([
    'lecture partielle 206 (timeline)',
    ranged.status === 206 &&
      ranged.buffer.length === 100 &&
      /^bytes 0-99\//.test(ranged.headers['content-range'] || ''),
  ]);

  const stat_ = await stat(finalPath);
  console.log(`\nvidéo conservée pour inspection : ${finalPath} (${(stat_.size / 1048576).toFixed(2)} Mo)`);

  /* ---------------- nappe sonore locale (moteurs sans audio) ---------------- *
   * fal.ai et Replicate ne génèrent pas d'audio : le pipeline ajoute alors une
   * nappe locale. Ce chemin n'est pas couvert par la production ci-dessus, on
   * le vérifie donc directement sur un clip muet fabriqué ici.
   */
  console.log('');
  const silent = path.join(TMP, 'source-muette.mp4');
  await runFfmpeg(
    [
      '-y', '-f', 'lavfi', '-i', 'color=c=0x2B3242:s=1280x720:d=4:r=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', silent,
    ],
    path.join(TMP, 'gen-silent.log'),
  );

  const silentInfo = await probeFile(silent);
  const { muxAmbianceAudio } = await import('../server/ffmpeg.js');
  const { AMBIANCES, findById } = await import('../server/config.js');

  const bedded = path.join(TMP, 'nappe-locale.mp4');
  await muxAmbianceAudio(silent, bedded, {
    ambiance: findById(AMBIANCES, 'energique'),
    seconds: silentInfo.duration,
    cwd: TMP,
    logPath: path.join(TMP, 'mux.log'),
  });
  const beddedInfo = await probeFile(bedded);

  checks.push(['nappe locale : source bien muette', silentInfo.hasAudio === false]);
  checks.push(['nappe locale : piste audio ajoutée', beddedInfo.hasAudio === true]);
  checks.push([
    'nappe locale : durée préservée',
    Math.abs(beddedInfo.duration - silentInfo.duration) <= 0.3,
  ]);

  /* ------------------------------- bilan ---------------------------------- */
  console.log('');
  let failed = 0;
  for (const [label, ok] of checks) {
    console.log(`   ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) failed += 1;
  }

  if (failed) throw new Error(`${failed} vérification(s) en échec`);
  console.log('✓ test de bout en bout réussi');
}

/** Sonde un fichier vidéo (durée + présence audio). */
async function probeFile(file) {
  const log = await runFfmpeg(['-i', file], path.join(TMP, 'probe-extra.log'), { tolerant: true });
  const match = log.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  return {
    duration: match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0,
    hasAudio: /Stream #\d+:\d+.*: Audio:/.test(log),
  };
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
