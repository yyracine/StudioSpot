/**
 * Orchestration d'une production video complete.
 *
 * Enchainement :
 *   prepare  -> normalisation de la photo, choix du cadrage
 *   generate -> image-to-video par le fournisseur (ou rendu local en mode demo)
 *   extend   -> prolongation, si le plan du fournisseur le prevoit
 *   post     -> coupe exacte, bande son, habillage texte, suppression audio
 *   finish   -> poster, metadonnees, resultat
 *
 * Le pipeline ne connait AUCUN fournisseur en particulier : il interroge le
 * registre (server/providers) et s'appuie sur le « plan » que celui-ci declare.
 * Ajouter un moteur consiste donc a ecrire un fichier dans server/providers/.
 */
import { mkdir, stat as statFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { AMBIANCES, DURATIONS, FORCE_DEMO, TEXT_MODES, VIDEO_TYPES, findById } from './config.js';
import { completeJob, failJob, logJob, updateJob } from './jobs.js';
import { buildExtensionPrompt, buildMainPrompt } from './prompts.js';
import { getProvider, resolveProvider } from './providers/index.js';
import {
  boldFontPath,
  burnOverlay,
  extractPoster,
  ffmpegPath,
  muxAmbianceAudio,
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

  // Fournisseur : celui demandé pour la tâche, sinon résolution automatique
  // (première clé disponible). Aucun fournisseur => rendu local de démonstration.
  const provider = selectProvider(job.input);
  const demo = !provider;

  try {
    updateJob(job.id, { status: 'running', stage: 'prepare' });
    logJob(job.id, 'Préparation de la photo produit…');

    /* ---------------- prepare ---------------- */
    const sourceJpg = path.join(workDir, 'source.jpg');
    const probeLog = path.join(workDir, 'log-probe.txt');
    await normalizeImage(job.input.sourcePath, sourceJpg, { cwd: workDir, logPath: probeLog });

    const sourceInfo = await probe(sourceJpg, { cwd: workDir, logPath: probeLog });
    const aspectRatio = resolveAspectRatio(job.input.aspectRatio, sourceInfo);

    // Le plan de production est déclaré par le fournisseur : c'est lui qui sait
    // ce que son moteur accepte réellement comme durées et comme résolutions.
    const plan = provider
      ? provider.buildPlan({
          durationId: duration.id,
          aspectRatio,
          resolution: job.input.resolution,
        })
      : demoPlan(duration, aspectRatio);

    const [outWidth, outHeight] =
      DIMENSIONS[plan.aspectRatio][plan.resolution] || DIMENSIONS[plan.aspectRatio][720];

    updateJob(job.id, {
      plan: { ...plan, providerId: provider?.id || null, providerLabel: provider?.label || 'Rendu local (démo)' },
    });

    logJob(
      job.id,
      `Photo prête · ${sourceInfo.width}×${sourceInfo.height} px · cadrage ${aspectRatio} · ` +
        `${plan.seconds} s cible · ${provider ? provider.shortLabel : 'rendu local'}`,
    );
    if (plan.limitedTo) logJob(job.id, plan.note, 'warn');

    /* ---------------- habillage : cohérence avec le moteur ---------------- */
    // Un moteur qui ne dessine pas de texte ne peut pas honorer le mode « texte
    // généré par Veo » : on bascule sur l'incrustation ffmpeg, qui reste nette.
    let effectiveTextMode = textMode;
    if (textMode.id === 'veo' && provider && !provider.capabilities.rendersText) {
      effectiveTextMode = findById(TEXT_MODES, 'overlay') || textMode;
      logJob(
        job.id,
        `« ${textMode.label} » n’est pas supporté par ${provider.shortLabel} : ` +
          'le texte sera incrusté par ffmpeg (rendu net garanti).',
        'warn',
      );
    }

    const nativeAudio = Boolean(provider?.capabilities.nativeAudio);

    /* ---------------- prompts ---------------- */
    const mainPrompt = buildMainPrompt({
      videoTypeId: videoType.id,
      ambianceId: ambiance.id,
      textModeId: effectiveTextMode.id,
      productName: job.input.productName,
      adMessage: job.input.adMessage,
      plan,
      nativeAudio,
      rendersText: Boolean(provider?.capabilities.rendersText),
    });

    const hasExtension = plan.steps.some((step) => step.kind === 'extend');
    const extensionPrompt = hasExtension
      ? buildExtensionPrompt({
          videoTypeId: videoType.id,
          ambianceId: ambiance.id,
          textModeId: effectiveTextMode.id,
          productName: job.input.productName,
          adMessage: job.input.adMessage,
          nativeAudio,
        })
      : null;

    updateJob(job.id, { prompts: { main: mainPrompt, extension: extensionPrompt } });

    /* ---------------- generate ---------------- */
    const rawMain = path.join(workDir, 'raw-1.mp4');
    let rawFinal = rawMain;

    if (demo) {
      updateJob(job.id, {
        stage: 'generate',
        stageLabel: 'Rendu local de la vidéo',
        detail: 'Animation de la photo et habillage…',
        progress: band(4, 62, 0.1),
      });
      logJob(job.id, demoReason(job), 'warn');

      await renderDemoVideo({
        imagePath: sourceJpg,
        outPath: rawMain,
        seconds: duration.seconds,
        width: outWidth,
        height: outHeight,
        productName: job.input.productName,
        adMessage: effectiveTextMode.id === 'none' ? '' : job.input.adMessage,
        ambiance,
        removeAudio: Boolean(ambiance.mute),
        cwd: workDir,
        logPath: path.join(workDir, 'log-demo.txt'),
      });
      updateJob(job.id, { progress: 62 });
    } else {
      const config = provider.buildConfig(plan, { seed: job.input.seed });
      updateJob(job.id, { stage: 'generate' });
      logJob(
        job.id,
        `${provider.shortLabel} génère ${plan.steps[0].seconds} s de vidéo` +
          (plan.calls > 1 ? ` (1/${plan.calls} appels)…` : '…'),
      );

      const generateBand = [4, plan.calls > 1 ? 60 : 86];

      const first = await provider.generateClip({
        imagePath: sourceJpg,
        prompt: mainPrompt,
        plan,
        config,
        model: job.input.model,
        outputPath: rawMain,
        stageLabel: `${provider.shortLabel} génère la vidéo`,
        onProgress: ({ elapsedMs }) =>
          updateJob(job.id, {
            progress: band(generateBand[0], generateBand[1], easedFraction(elapsedMs)),
            detail: `${provider.shortLabel} filme la scène… ${formatElapsed(Math.round(elapsedMs / 1000))}`,
          }),
      });
      logJob(job.id, `Premier plan reçu de ${provider.shortLabel}.`);

      // Étapes supplémentaires (extension), si le plan en prévoit.
      let previousRef = first.ref;
      for (let index = 1; index < plan.steps.length; index += 1) {
        const step = plan.steps[index];
        if (step.kind !== 'extend' || typeof provider.extendClip !== 'function') break;

        updateJob(job.id, {
          stage: 'extend',
          stageLabel: `${provider.shortLabel} prolonge la scène`,
        });
        logJob(job.id, `Prolongation de +${step.seconds} s pour atteindre ${plan.seconds} s…`);

        const extended = path.join(workDir, `raw-${index + 1}.mp4`);
        const result = await provider.extendClip({
          previousRef,
          prompt: extensionPrompt,
          plan,
          model: job.input.model,
          outputPath: extended,
          stageLabel: `${provider.shortLabel} prolonge la scène`,
          onProgress: ({ elapsedMs }) =>
            updateJob(job.id, {
              progress: band(60, 86, easedFraction(elapsedMs)),
              detail: `${provider.shortLabel} prolonge la scène… ${formatElapsed(Math.round(elapsedMs / 1000))}`,
            }),
        });
        previousRef = result.ref;
        rawFinal = extended;
        logJob(job.id, 'Prolongation reçue.');
      }
    }

    /* ---------------- post ---------------- */
    updateJob(job.id, { stage: 'post', progress: 88 });

    const media = await probe(rawFinal, { cwd: workDir, logPath: path.join(workDir, 'log-probe2.txt') });
    const actualDuration = media.duration || plan.seconds;
    const width = media.width || outWidth;
    const height = media.height || outHeight;

    const removeAudio = Boolean(ambiance.mute);

    // Les moteurs sans audio natif (fal, Replicate) produisent un clip muet :
    // on y ajoute une nappe sonore locale, sauf si « Pas de son » est demandé.
    if (!demo && !nativeAudio && !removeAudio) {
      logJob(
        job.id,
        `${provider.shortLabel} ne génère pas d’audio : une nappe sonore locale est ajoutée ` +
          `(ambiance « ${ambiance.label} »).`,
      );
      const withAudio = path.join(workDir, 'raw-audio.mp4');
      await muxAmbianceAudio(rawFinal, withAudio, {
        ambiance,
        seconds: actualDuration,
        cwd: workDir,
        logPath: path.join(workDir, 'log-audio.txt'),
      });
      rawFinal = withAudio;
    }

    const wantsOverlay = effectiveTextMode.id === 'overlay' && job.input.adMessage.trim().length > 0;
    const needsTrim = Boolean(plan.trimTo && actualDuration > plan.trimTo + 0.06);
    const postProbed = await probe(rawFinal, { cwd: workDir, logPath: path.join(workDir, 'log-probe-audio.txt') });
    const audioPresent = postProbed.hasAudio && !removeAudio;

    logJob(job.id, 'Post-production : coupe, habillage texte, audio.');

    const finalPath = path.join(jobDir, 'final.mp4');

    if (wantsOverlay) {
      await burnOverlay(rawFinal, finalPath, {
        cwd: workDir,
        logPath: path.join(workDir, 'log-overlay.txt'),
        productName: job.input.productName,
        adMessage: job.input.adMessage,
        duration: needsTrim ? plan.trimTo : actualDuration,
        width,
        height,
        removeAudio,
        trimTo: needsTrim ? plan.trimTo : null,
      });
    } else if (needsTrim) {
      await trimPrecise(rawFinal, finalPath, plan.trimTo, {
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
    const finalDuration = finalMedia.duration || plan.seconds;

    const audioLabel = !postProbed.hasAudio || removeAudio
      ? 'Pas de son'
      : nativeAudio
        ? ambiance.label
        : `${ambiance.label} (nappe locale)`;

    const meta = {
      productName: job.input.productName,
      adMessage: job.input.adMessage,
      videoType: videoType.label,
      ambiance: ambiance.label,
      textMode: effectiveTextMode.label,
      provider: provider ? { id: provider.id, label: provider.label, model: job.input.model } : { id: 'demo', label: 'Rendu local' },
      aspectRatio,
      resolution: plan.resolution,
      targetSeconds: duration.seconds,
      finalSeconds: finalDuration,
      audio: audioLabel,
      demoMode: demo,
      plan,
      prompts: { main: mainPrompt, extension: extensionPrompt },
      generatedAt: new Date().toISOString(),
    };
    await writeFile(path.join(jobDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    const size = await statFile(finalPath);
    logJob(job.id, `Vidéo finale prête : ${finalDuration.toFixed(1)} s · ${(size.size / 1048576).toFixed(1)} Mo`);

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
      hasAudio: postProbed.hasAudio && !removeAudio,
      audioLabel,
      sizeBytes: size.size,
      mode: demo ? 'demo' : 'provider',
      providerId: provider?.id || 'demo',
      providerLabel: provider?.label || 'Rendu local (démo)',
      model: demo ? 'rendu local' : job.input.model,
      videoType: videoType.label,
      ambiance: ambiance.label,
      textMode: effectiveTextMode.label,
      limitedTo: plan.limitedTo,
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

/**
 * Determine le fournisseur effectif d'une tache.
 * @returns {object|null} null => rendu local (mode demo)
 */
function selectProvider(input) {
  if (FORCE_DEMO || input.demoRequested) return null;

  const requested = getProvider(input.providerId);
  // Fournisseur explicitement demandé mais sans clé : on se rabat sur le
  // premier fournisseur utilisable plutôt que d'échouer.
  if (requested && requested.isConfigured()) return requested;
  return resolveProvider();
}

/** Plan utilise quand aucun fournisseur n'est disponible (rendu local). */
const demoPlan = (duration, aspectRatio) => ({
  seconds: duration.seconds,
  steps: [{ kind: 'generate', seconds: duration.seconds }],
  trimTo: null,
  aspectRatio,
  resolution: '720p',
  calls: 0,
  note: 'Rendu local de démonstration : animation de la photo et habillage, sans modèle distant.',
  limitedTo: null,
});

/** Explique pourquoi on produit localement plutot que via un moteur distant. */
function demoReason(job) {
  if (job.input.demoRequested) return 'Mode démo demandé : rendu local de la photo, aucun appel distant.';
  if (FORCE_DEMO) return 'Mode démo forcé (DEMO=1) : rendu local de la photo.';
  return 'Aucune clé API de fournisseur : rendu local de démonstration (animation + habillage).';
}

/** Cadrage : deduit de la photo si l'utilisateur laisse "automatique". */
function resolveAspectRatio(requested, sourceInfo) {
  if (requested === '16:9' || requested === '9:16') return requested;
  if (!sourceInfo?.width || !sourceInfo?.height) return '16:9';
  return sourceInfo.width > sourceInfo.height ? '16:9' : '9:16';
}

const formatElapsed = (seconds) =>
  seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')}`;
