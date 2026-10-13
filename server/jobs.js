/**
 * Suivi des taches de production.
 *
 * Une generation Veo dure de 11 secondes a 6 minutes (et jusqu'a 2 appels pour
 * la duree de 15 s). On expose donc une tache asynchrone suivie en
 * Server-Sent Events, avec un instantane JSON en repli.
 */
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { JOB_RETENTION, OUTPUT_DIR } from './config.js';
import path from 'node:path';

/** @type {Map<string, any>} */
const jobs = new Map();

const HEARTBEAT_MS = 20_000;

export const STAGES = {
  queued: { label: 'En file d’attente', progress: 0 },
  prepare: { label: 'Préparation de la photo', progress: 4 },
  generate: { label: 'Veo filme votre produit', progress: 62 },
  extend: { label: 'Veo prolonge la scène', progress: 74 },
  post: { label: 'Habillage et finitions', progress: 88 },
  finish: { label: 'Finalisation', progress: 97 },
  done: { label: 'Terminé', progress: 100 },
};

export function createJob(input) {
  const id = randomUUID();
  const job = {
    id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'queued',
    stage: 'queued',
    stageLabel: STAGES.queued.label,
    progress: 0,
    detail: null,
    input,
    plan: null,
    prompts: null,
    result: null,
    error: null,
    logs: [],
    dir: path.join(OUTPUT_DIR, id),
    clients: new Set(),
    events: [],
  };
  jobs.set(id, job);
  pruneJobs();
  return job;
}

export const getJob = (id) => jobs.get(id) || null;
export const listJobs = () =>
  [...jobs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((job) => publicView(job));

/** Vue publique : jamais de chemins disque ni de donnees internes. */
export function publicView(job) {
  return {
    id: job.id,
    createdAt: job.createdAt,
    status: job.status,
    stage: job.stage,
    stageLabel: job.stageLabel,
    progress: Math.round(job.progress),
    detail: job.detail,
    logs: job.logs.slice(-40),
    plan: job.plan,
    input: {
      productName: job.input.productName,
      adMessage: job.input.adMessage,
      videoTypeId: job.input.videoTypeId,
      ambianceId: job.input.ambianceId,
      durationId: job.input.durationId,
      textModeId: job.input.textModeId,
      aspectRatio: job.input.aspectRatio,
      resolution: job.input.resolution,
      model: job.input.model,
      sourceImage: `/api/jobs/${job.id}/source`,
    },
    result: job.result,
    error: job.error,
    prompts: job.prompts,
  };
}

/** Met a jour l'etat d'une tache et notifie les abonnes SSE. */
export function updateJob(id, patch = {}) {
  const job = jobs.get(id);
  if (!job) return null;

  Object.assign(job, patch, { updatedAt: Date.now() });

  // Le libellé suit toujours l'étape ; la progression par défaut de l'étape
  // n'est appliquée que si l'appelant n'en fournit pas une plus précise.
  if (patch.stage && STAGES[patch.stage]) {
    job.stageLabel = STAGES[patch.stage].label;
    if (patch.progress === undefined) job.progress = STAGES[patch.stage].progress;
  }

  emit(job, { type: 'progress' });
  return job;
}

/** Ajoute une ligne au journal visible dans l'interface. */
export function logJob(id, message, level = 'info') {
  const job = jobs.get(id);
  if (!job) return;
  job.logs.push({ at: Date.now(), message, level });
  if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);
  job.detail = message;
  emit(job, { type: 'log' });
}

export function failJob(id, error) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'error';
  job.stage = 'error';
  job.stageLabel = 'Échec';
  job.error = {
    message: error?.message || 'Erreur inconnue',
    hint: error?.hint || null,
    details: error?.details || null,
  };
  emit(job, { type: 'error' });
  closeClients(job);
}

export function completeJob(id, result) {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'done';
  job.stage = 'done';
  job.stageLabel = STAGES.done.label;
  job.progress = 100;
  job.result = result;
  emit(job, { type: 'done' });
  closeClients(job);
}

/* ------------------------------------------------------------------ *
 * Diffusion (SSE)
 * ------------------------------------------------------------------ */

function emit(job, event) {
  job.events.push(event);
  if (job.events.length > 100) job.events.splice(0, job.events.length - 100);
  const payload = `data: ${JSON.stringify({ ...event, job: publicView(job) })}\n\n`;
  for (const res of job.clients) {
    try {
      res.write(payload);
    } catch {
      job.clients.delete(res);
    }
  }
}

function closeClients(job) {
  for (const res of job.clients) {
    try {
      res.end();
    } catch {
      /* deja ferme */
    }
  }
  job.clients.clear();
}

/** Abonne une reponse HTTP aux evenements d'une tache. */
export function subscribe(job, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'snapshot', job: publicView(job) })}\n\n`);

  job.clients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch {
      /* ignore */
    }
  }, HEARTBEAT_MS);

  const cleanup = () => {
    clearInterval(heartbeat);
    job.clients.delete(res);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);

  if (job.status === 'done' || job.status === 'error') {
    setTimeout(() => {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }, 50);
  }
}

/* ------------------------------------------------------------------ *
 * Purge
 * ------------------------------------------------------------------ */

async function pruneJobs() {
  if (jobs.size <= JOB_RETENTION) return;
  const ordered = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  const excess = ordered.slice(0, Math.max(0, ordered.length - JOB_RETENTION));
  for (const job of excess) {
    if (job.status === 'running' || job.status === 'queued') continue;
    jobs.delete(job.id);
    await rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }
}
