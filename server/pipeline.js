/**
 * Orchestration d'une production video complete.
 *
 * Enchainement :
 *   prepare  -> normalisation de la photo, choix du cadrage
 *   generate -> Veo image-to-video (ou rendu local en mode demo)
 *   extend   -> extension Veo de +7 s pour atteindre 15 s
 *   post     -> coupe exacte, suppression audio si besoin, habillage texte
 *   finish   -> poster, metadonnees, resultat
 */
import { mkdir, stat as statFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AMBIANCES,
  DURATIONS,
  FORCE_DEMO,
  TEXT_MODES,
  VIDEO_TYPES,
  findById,
} from './config.js';
import { completeJob, failJob, logJob, updateJob } from './jobs.js';
import { buildExtensionPrompt, buildMainPrompt, buildVeoConfig, describePlan } from './prompts.js';
import { extendClip, generateClip } from './veo.js';
import {
  boldFontPath,
  burnOverlay,
  extractPoster,
  ffmpegPath,
  normalizeImage,
  probe,
  remux,
  renderDemoVideo,
  stripAudio,
  trimPrecise,
} from './ffmpeg.js';

/** Progression asymptotique : rassurante sans mentir sur l'avancement reel. */
const easedFraction = (elapsedMs, halfLifeMs = 90_000) => Math.min(0.97, 1 - Math.exp(-elapsedMs / halfLifeMs));
const band = (start, end, fraction) => start + (end - start) * Math.max(0, Math.min(1, fraction));

const DIMENSIONS = {
  '16:9': { 720: [1280, 720], 1080: [1920, 1080] },
  '9:16': { 720: [720, 1280], 1080: [1080, 1920] },
};

export async function runJob(job) {
  const { workDir, jobDir } = await prepareDirs(job);

  const videoType = findById(VIDEO_TYPES, job.input.videoTypeId) || VIDEO_TYPES[0];
  const ambiance = findById(AMBIANCES, job.input.ambianceId) || AMBIANCES[0];
  const duration = findById(DURATIONS, job.input.durationId) || DURATIONS[1];
  const textMode = findById(TEXT_MODES, job.input.textModeId) || TEXT_MODES[0];

  const demoMode = FORCE_DEMO || !job.input.useVeo;

  try {
    updateJob(job.id, { status: 'running', stage: 'prepare' });
    logJob(job.id, 'Préparation de la photo produit…');

    /* ---------------- prepare ---------------- */
    const sourceJpg = path.join(workDir, 'source.jpg');
    const probeLog = path.join(workDir, 'log-probe.txt');
    await normalizeImage(job.input.sourcePath, sourceJpg, {
      cwd: workDir,
      logPath: probeLog,
    });

    const sourceInfo = await probe(sourceJpg, { cwd: workDir, logPath: probeLog });
    const aspectRatio = resolveAspectRatio(job.input.aspectRatio, sourceInfo);
    const resolution = resolveResolution(job.input.resolution, job.input.durationId);
    const [outWidth, outHeight] = DIMENSIONS[aspectRatio][resolution] || DIMENSIONS[aspectRatio][720];

    const plan = {
      ...describePlan({
        durationId: duration.id,
        modelId: job.input.model,
        resolution: job.input.resolution,
      }),
      aspectRatio,
      resolution: demoMode ? '720p' : resolution,
      demoMode,
    };

    updateJob(job.id, { plan });
    logJob(
      job.id,
      `Photo prête · ${sourceInfo.width}×${sourceInfo.height} px · cadrage ${aspectRatio} · ${duration.seconds} s cible`,
    );

    /* ---------------- generate ---------------- */
    const mainPrompt = buildMainPrompt({
      videoTypeId: videoType.id,
      ambianceId: ambiance.id,
      durationId: duration.id,
      textModeId: textMode.id,
      productName: job.input.productName,
      adMessage: job.input.adMessage,
      aspectRatio,
      resolution: plan.resolution,
    });
    const extensionPrompt = duration.extend
      ? buildExtensionPrompt({
          videoTypeId: videoType.id,
          ambianceId: ambiance.id,
          textModeId: textMode.id,
          productName: job.input.productName,
          adMessage: job.input.adMessage,
        })
      : null;

    updateJob(job.id, { prompts: { main: mainPrompt, extension: extensionPrompt } });

    const rawMain = path.join(workDir, 'raw-1.mp4');
    let rawFinal = rawMain;

    if (demoMode) {
      updateJob(job.id, {
        stage: 'generate',
        stageLabel: 'Rendu local de la vidéo',
        detail: 'Animation de la photo et habillage…',
        progress: band(4, 62, 0.1),
      });
      logJob(
        job.id,
        job.input.demoRequested
          ? 'Mode démo demandé : rendu local de la photo, aucun appel Veo.'
          : job.input.useVeo
            ? 'Mode démo forcé (DEMO=1) : rendu local de la photo.'
            : 'Aucune clé API Veo : rendu local de démonstration (animation + habillage).',
        'warn',
      );
      await renderDemoVideo({
        imagePath: sourceJpg,
        outPath: rawMain,
        seconds: duration.seconds,
        width: outWidth,
        height: outHeight,
        productName: job.input.productName,
        adMessage: textMode.id === 'none' ? '' : job.input.adMessage,
        ambiance,
        removeAudio: Boolean(ambiance.mute),
        cwd: workDir,
        logPath: path.join(workDir, 'log-demo.txt'),
      });
      updateJob(job.id, { progress: 62 });
    } else {
      updateJob(job.id, { stage: 'generate' });
      logJob(job.id, `Veo génère ${duration.veoDurationSeconds} s de vidéo…`);

      const config = buildVeoConfig({
        durationId: duration.id,
        aspectRatio,
        resolution,
        seed: job.input.seed,
      });

      const firstClip = await generateClip({
        imagePath: sourceJpg,
        prompt: mainPrompt,
        config,
        model: job.input.model,
        outputPath: rawMain,
        onProgress: ({ elapsedMs }) => {
          updateJob(job.id, {
            progress: band(4, duration.extend ? 60 : 86, easedFraction(elapsedMs)),
            detail: `Veo filme la scène… ${formatElapsed(Math.round(elapsedMs / 1000))}`,
          });
        },
      });
      logJob(job.id, 'Premier plan reçu de Veo.');

      if (duration.extend) {
        updateJob(job.id, { stage: 'extend' });
        logJob(job.id, 'Extension Veo de +7 s pour atteindre 15 s…');

        const extended = path.join(workDir, 'raw-2.mp4');
        await extendClip({
          previousVideo: firstClip.video,
          prompt: extensionPrompt,
          model: job.input.model,
          outputPath: extended,
          onProgress: ({ elapsedMs }) =>
            updateJob(job.id, {
              progress: band(60, 86, easedFraction(elapsedMs)),
              detail: `Veo prolonge la scène… ${formatElapsed(Math.round(elapsedMs / 1000))}`,
            }),
        });
        rawFinal = extended;
        logJob(job.id, 'Extension reçue.');
      }
    }

    /* ---------------- post ---------------- */
    updateJob(job.id, { stage: 'post', progress: 88 });
    logJob(job.id, 'Post-production : coupe, audio, habillage texte.');

    const media = await probe(rawFinal, { cwd: workDir, logPath: path.join(workDir, 'log-probe2.txt') });
    const actualDuration = media.duration || duration.seconds;
    const width = media.width || outWidth;
    const height = media.height || outHeight;

    const wantsOverlay = textMode.id === 'overlay' && job.input.adMessage.trim().length > 0;
    const needsTrim = Boolean(duration.trimTo && actualDuration > duration.trimTo + 0.06);
    const removeAudio = Boolean(ambiance.mute);

    const finalPath = path.join(jobDir, 'final.mp4');
    let audioPresent = media.hasAudio && !removeAudio;

    if (wantsOverlay) {
      await burnOverlay(rawFinal, finalPath, {
        cwd: workDir,
        logPath: path.join(workDir, 'log-overlay.txt'),
        productName: job.input.productName,
        adMessage: job.input.adMessage,
        duration: needsTrim ? duration.trimTo : actualDuration,
        width,
        height,
        removeAudio,
        trimTo: needsTrim ? duration.trimTo : null,
      });
    } else if (needsTrim) {
      await trimPrecise(rawFinal, finalPath, duration.trimTo, {
        cwd: workDir,
        logPath: path.join(workDir, 'log-trim.txt'),
        removeAudio,
      });
    } else if (removeAudio) {
      await stripAudio(rawFinal, finalPath, { cwd: workDir, logPath: path.join(workDir, 'log-mute.txt') });
    } else {
      await remux(rawFinal, finalPath, { cwd: workDir, logPath: path.join(workDir, 'log-remux.txt') });
    }

    /* ---------------- finish ---------------- */
    updateJob(job.id, { stage: 'finish' });
    const posterPath = path.join(jobDir, 'poster.jpg');
    try {
      await extractPoster(finalPath, posterPath, Math.min(1.2, actualDuration / 3), {
        cwd: jobDir,
        logPath: path.join(workDir, 'log-poster.txt'),
      });
    } catch {
      await copyFile(sourceJpg, posterPath).catch(() => {});
    }

    const finalMedia = await probe(finalPath, { cwd: jobDir, logPath: path.join(workDir, 'log-probe3.txt') });
    const finalDuration = finalMedia.duration || duration.seconds;
    audioPresent = finalMedia.hasAudio && !removeAudio;

    const meta = {
      productName: job.input.productName,
      adMessage: job.input.adMessage,
      videoType: videoType.label,
      ambiance: ambiance.label,
      textMode: textMode.label,
      model: demoMode ? 'Rendu local (démo)' : job.input.model,
      aspectRatio,
      resolution: plan.resolution,
      targetSeconds: duration.seconds,
      finalSeconds: finalDuration,
      audio: audioPresent ? ambiance.label : 'Aucun (vidéo muette)',
      demoMode,
      prompts: { main: mainPrompt, extension: extensionPrompt },
      generatedAt: new Date().toISOString(),
    };
    await writeFile(path.join(jobDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    const stat = await statFile(finalPath);
    logJob(job.id, `Vidéo finale prête : ${finalDuration.toFixed(1)} s · ${(stat.size / 1048576).toFixed(1)} Mo`);

    completeJob(job.id, {
      videoUrl: `/api/jobs/${job.id}/video`,
      downloadUrl: `/api/jobs/${job.id}/video?download=1`,
      posterUrl: `/api/jobs/${job.id}/poster`,
      metaUrl: `/api/jobs/${job.id}/meta`,
      sourceUrl: `/api/jobs/${job.id}/source`,
      durationSec: Number(finalDuration.toFixed(2)),
      width: finalMedia.width || width,
      height: finalMedia.height || height,
      aspectRatio,
      resolution: plan.resolution,
      hasAudio: audioPresent,
      audioLabel: audioPresent ? ambiance.label : 'Pas de son',
      sizeBytes: stat.size,
      mode: demoMode ? 'demo' : 'veo',
      model: demoMode ? 'demo' : job.input.model,
      videoType: videoType.label,
      ambiance: ambiance.label,
      textMode: textMode.label,
      ffmpeg: ffmpegPath(),
      font: boldFontPath(),
    });
  } catch (err) {
    failJob(job.id, err);
  }
}

/** Cree l'arborescence de travail d'une tache. */
async function prepareDirs(job) {
  const jobDir = job.dir;
  const workDir = path.join(jobDir, 'work');
  await mkdir(workDir, { recursive: true });
  return { jobDir, workDir };
}

/** Cadrage : deduit de la photo si l'utilisateur laisse "automatique". */
function resolveAspectRatio(requested, sourceInfo) {
  if (requested === '16:9' || requested === '9:16') return requested;
  if (!sourceInfo?.width || !sourceInfo?.height) return '16:9';
  return sourceInfo.width > sourceInfo.height ? '16:9' : '9:16';
}

/**
 * 1080p n'est autorise par Veo que pour des clips de 8 s, et l'extension
 * impose le 720p : on verrouille donc la resolution quand la duree ne le
 * permet pas.
 */
function resolveResolution(requested, durationId) {
  const duration = findById(DURATIONS, durationId) || DURATIONS[1];
  if (duration.extend) return '720p';
  if (duration.veoDurationSeconds !== 8) return '720p';
  return requested === '1080p' ? '1080p' : '720p';
}

const formatElapsed = (seconds) =>
  seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')}`;
