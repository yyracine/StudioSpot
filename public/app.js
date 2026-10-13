/**
 * Animateur de Photos Produit — logique de l'interface.
 *
 * L'aperçu affiché à l'écran reproduit exactement la géométrie de
 * l'incrustation ffmpeg (nom produit à 5,5 % de la hauteur en 3,6 % de corps,
 * message centré à 70 % en 7,2 % de corps) : ce que vous voyez est ce qui est
 * écrit dans la vidéo.
 */

const $ = (id) => document.getElementById(id);

/** Mémorisé une fois : évite de dupliquer le balisage de l'état vide. */
const PLACEHOLDER_HTML = $('stagePlaceholder').innerHTML;
const BUSY_HTML =
  '<span class="spinner" aria-hidden="true"></span>' +
  '<strong>Veo travaille…</strong>' +
  '<span class="muted small">Vous pouvez laisser cet onglet ouvert, la production continue.</span>';

const state = {
  options: null,
  health: null,
  file: null,
  fileUrl: null,
  jobId: null,
  stream: null,
  poller: null,
  elapsedTimer: null,
  startedAt: 0,
  baseDetail: '',
  aspect: '16:9',
  running: false,
};

/* ==================================================================== *
 * Utilitaires
 * ==================================================================== */

/** Même découpe de texte que le serveur : garantit un aperçu fidèle. */
function wrapText(text, maxCharsPerLine = 26, maxLines = 3) {
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

  if (lines.length === maxLines) {
    const consumed = lines.join(' ').length;
    if (consumed < String(text).replace(/\s+/g, ' ').trim().length) {
      let last = lines[maxLines - 1];
      while (last.length > maxCharsPerLine - 1) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last.trimEnd()}…`;
    }
  }
  return lines.join('\n');
}

const formatBytes = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} Mo` : `${Math.round(bytes / 1024)} Ko`;

const formatDuration = (seconds) => `${seconds.toFixed(1).replace('.', ',')} s`;

const formatElapsed = (ms) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`;
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    const error = new Error(data?.error || `Erreur HTTP ${response.status}`);
    error.payload = data;
    throw error;
  }
  return data;
}

/* ==================================================================== *
 * Initialisation
 * ==================================================================== */

init().catch((err) => {
  showBanner(`Impossible de contacter le serveur : ${err.message}`, true);
});

async function init() {
  wireStaticEvents();

  const [options, health] = await Promise.all([
    api('/api/options'),
    api('/api/health').catch(() => null),
  ]);

  state.options = options;
  state.health = health;

  buildSelects();
  applyHealth();
  syncForm();
  updateEstimate();
  updateOverlayPreview();
}

function buildSelects() {
  const o = state.options;

  fill($('videoType'), o.videoTypes, o.defaults.videoType);
  fill($('ambiance'), o.ambiances, o.defaults.ambiance);
  fill($('duration'), o.durations, o.defaults.duration);
  fill($('model'), o.models, o.defaults.model);
  fill($('textMode'), o.textModes, o.defaults.textMode);
  fill($('aspectRatio'), o.aspectRatios, o.defaults.aspectRatio);
  fill($('resolution'), o.resolutions, o.defaults.resolution);
  fillProviders();

  renderStaticChips();

  $('uploadLimits').textContent = `JPEG, PNG ou WebP · ${Math.round(
    o.limits.uploadMaxBytes / 1048576,
  )} Mo maximum`;
  $('productName').maxLength = o.limits.productNameMax;
  $('adMessage').maxLength = o.limits.adMessageMax;
  $('productNameCount').nextSibling.textContent = `/${o.limits.productNameMax}`;
  $('adMessageCount').nextSibling.textContent = `/${o.limits.adMessageMax}`;
}

/**
 * Liste des moteurs : les fournisseurs disponibles, plus le rendu local.
 * Les fournisseurs sans clé restent visibles mais sont signalés comme non
 * configurés — l'utilisateur voit ainsi ce qu'il peut activer.
 */
function fillProviders() {
  const select = $('provider');
  select.innerHTML = '';

  for (const provider of state.options.providers || []) {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = provider.configured ? provider.label : `${provider.label} — clé requise`;
    option.disabled = !provider.configured;
    select.append(option);
  }

  const local = document.createElement('option');
  local.value = 'demo';
  local.textContent = 'Rendu local (démonstration, sans IA)';
  select.append(local);

  // Sélection par défaut : le moteur réellement actif côté serveur,
  // sinon le rendu local.
  const active = state.health?.provider?.id;
  select.value = active || 'demo';
}

function fill(select, items, defaultValue) {
  select.innerHTML = '';
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label;
    if (item.id === defaultValue) option.selected = true;
    select.append(option);
  }
}

/** Suggestions de départ, remplacées par celles du modèle si on le demande. */
const STATIC_CHIPS = [
  'Nouveau ! -30% cette semaine',
  'Livraison offerte dès 40 €',
  'Édition limitée — stock réduit',
  'Note 4,9/5 · 2 300 avis',
];

function renderChips(items) {
  const container = $('messageSuggestions');
  container.innerHTML = '';

  for (const item of items) {
    const text = typeof item === 'string' ? item : item.text;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = text;
    if (typeof item === 'object' && item.angle) chip.title = item.angle;
    container.append(chip);
  }
}

const renderStaticChips = () => renderChips(STATIC_CHIPS);

/* ==================================================================== *
 * État du serveur
 * ==================================================================== */

function applyHealth() {
  const health = state.health;
  const badge = $('modeBadge');
  const text = $('modeBadgeText');
  const notices = [];

  badge.classList.remove('live', 'demo');

  if (!health) {
    text.textContent = 'Serveur injoignable';
    return;
  }

  if (health.mode === 'provider' && health.provider) {
    badge.classList.add('live');
    text.textContent = health.provider.label;
  } else {
    badge.classList.add('demo');
    text.textContent = 'Mode démo local';

    const missing = Object.values(health.keys || {}).filter((entry) => !entry.configured);
    notices.push({
      text:
        'Aucune clé de moteur configurée : les vidéos sont rendues localement (animation de la photo, ' +
        'habillage texte et nappe sonore). Ouvrez « Réglages » pour ajouter une clé — Gemini/Veo, ' +
        'fal.ai ou Replicate — et activer un vrai moteur de génération.' +
        (missing.length ? ` Clés absentes : ${missing.map((entry) => entry.label).join(', ')}.` : ''),
      danger: false,
    });
  }

  if (health.ffmpeg === false) {
    notices.push({
      text:
        'ffmpeg est introuvable : la post-production (texte, coupe, audio) est indisponible. ' +
        'Installez ffmpeg ou définissez FFMPEG_PATH.',
      danger: true,
    });
  }

  showBanner(notices);
}

/** Affiche une ou plusieurs alertes (chaque entrée : { text, danger }). */
function showBanner(notices) {
  const banner = $('healthBanner');
  const list = Array.isArray(notices) ? notices : [{ text: notices, danger: false }];
  const visible = list.filter((item) => item?.text);

  if (!visible.length) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }

  banner.textContent = visible.map((item) => item.text).join('\n\n');
  banner.classList.toggle('danger', visible.some((item) => item.danger));
  banner.hidden = false;
}

/* ==================================================================== *
 * Photo
 * ==================================================================== */
function wireStaticEvents() {
  const dropzone = $('dropzone');
  const input = $('photoInput');

  dropzone.addEventListener('click', () => input.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });
  $('changePhotoBtn').addEventListener('click', (event) => {
    event.stopPropagation();
    input.click();
  });

  input.addEventListener('change', () => {
    if (input.files?.[0]) setFile(input.files[0]);
  });

  ['dragenter', 'dragover'].forEach((type) =>
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.add('dragover');
    }),
  );
  ['dragleave', 'drop'].forEach((type) =>
    dropzone.addEventListener(type, (event) => {
      event.preventDefault();
      dropzone.classList.remove('dragover');
    }),
  );
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) setFile(file);
  });

  document.addEventListener('paste', (event) => {
    const file = [...(event.clipboardData?.files || [])][0];
    if (file) setFile(file);
  });

  // Champs du formulaire
  ['productName', 'adMessage'].forEach((id) => {
    $(id).addEventListener('input', () => {
      $(`${id}Count`).textContent = $(id).value.length;
      syncForm();
      updateOverlayPreview();
    });
  });

  ['videoType', 'ambiance', 'duration', 'model', 'textMode', 'aspectRatio', 'resolution', 'provider'].forEach(
    (id) => {
      $(id).addEventListener('change', () => {
        if (id === 'aspectRatio') updateStageAspect();
        syncForm();
        updateOverlayPreview();
        updateEstimate();
      });
    },
  );

  // Suggestions de message
  $('messageSuggestions').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    $('adMessage').value = chip.textContent.trim();
    $('adMessage').dispatchEvent(new Event('input'));
    $('adMessage').focus();
  });

  $('suggestBtn').addEventListener('click', suggestMessages);

  $('productForm').addEventListener('submit', (event) => {
    event.preventDefault();
    startGeneration();
  });

  $('regenerateBtn').addEventListener('click', regenerate);
  $('retryBtn').addEventListener('click', regenerate);
  $('demoFallbackBtn').addEventListener('click', () => regenerate({ mode: 'demo' }));
  $('newBtn').addEventListener('click', resetAll);
  $('copyPromptBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('promptOut').textContent);
      $('copyPromptBtn').textContent = 'Prompt copié ✓';
      setTimeout(() => ($('copyPromptBtn').textContent = 'Copier le prompt'), 1800);
    } catch {
      /* presse-papiers indisponible */
    }
  });

  // Réglages : une ligne par fournisseur, construite dynamiquement.
  $('settingsBtn').addEventListener('click', () => {
    $('settingsStatus').textContent = '';
    renderKeyRows();
    $('settingsDialog').showModal();
    loadDiagnostics();
  });
  $('closeSettingsBtn').addEventListener('click', () => $('settingsDialog').close());
  $('keyRows').addEventListener('click', handleKeyAction);

  // Redimensionnement : l'aperçu garde les proportions de la vidéo finale
  window.addEventListener('resize', updateOverlayMetrics);
}

/**
 * Demande des accroches publicitaires au modèle texte (gratuit).
 * Sans clé Gemini, le serveur renvoie un repli local : l'utilisateur obtient
 * toujours des propositions.
 */
async function suggestMessages() {
  const button = $('suggestBtn');
  const status = $('suggestStatus');
  const productName = $('productName').value.trim();

  if (!productName) {
    status.textContent = 'Renseignez d’abord le nom du produit.';
    $('productName').focus();
    return;
  }

  button.disabled = true;
  status.textContent = 'Recherche d’accroches…';

  try {
    const result = await api('/api/suggest-messages', {
      method: 'POST',
      body: JSON.stringify({
        productName,
        videoTypeId: $('videoType').value,
        ambianceId: $('ambiance').value,
      }),
    });

    renderChips(result.suggestions);
    status.textContent = result.provider?.startsWith('repli')
      ? `Propositions hors ligne (${result.provider}).`
      : `${result.suggestions.length} accroches proposées par ${result.provider}.`;
  } catch (err) {
    status.textContent = err.message;
  } finally {
    button.disabled = false;
  }
}

function setFile(file) {
  const error = $('photoError');

  if (!state.options.limits.acceptedMime.includes(file.type)) {
    error.textContent = 'Format non supporté : utilisez un JPEG, un PNG ou un WebP.';
    error.hidden = false;
    return;
  }
  if (file.size > state.options.limits.uploadMaxBytes) {
    error.textContent = `Photo trop lourde (${formatBytes(file.size)}). Maximum ${Math.round(
      state.options.limits.uploadMaxBytes / 1048576,
    )} Mo.`;
    error.hidden = false;
    return;
  }

  error.hidden = true;
  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.file = file;
  state.fileUrl = URL.createObjectURL(file);

  $('dropzoneEmpty').hidden = true;
  $('dropzonePreview').hidden = false;
  $('photoThumb').src = state.fileUrl;
  $('photoName').textContent = file.name || 'Photo collée';

  const image = new Image();
  image.onload = () => {
    $('photoDims').textContent = `${image.naturalWidth} × ${image.naturalHeight} px · ${formatBytes(
      file.size,
    )}`;
    updateStageAspect();
    updateOverlayPreview();
  };
  image.src = state.fileUrl;

  syncForm();
}

/* ==================================================================== *
 * Aperçu (photo + habillage)
 * ==================================================================== */

function effectiveAspect() {
  const requested = $('aspectRatio').value;
  if (requested === '16:9' || requested === '9:16') return requested;
  const image = $('photoThumb');
  if (image.naturalWidth && image.naturalHeight) {
    return image.naturalWidth > image.naturalHeight ? '16:9' : '9:16';
  }
  return '16:9';
}

function updateStageAspect() {
  state.aspect = state.options ? effectiveAspect() : '16:9';
  const media = $('stageMedia');
  media.classList.toggle('portrait', state.aspect === '9:16');
  $('stageRatioBadge').textContent = state.aspect;
  updateOverlayMetrics();
}

/** Aligne la taille de l'habillage sur la hauteur réellement affichée. */
function updateOverlayMetrics() {
  const media = $('stageMedia');
  if (!media) return;
  media.style.setProperty('--ov-h', `${media.clientHeight}px`);
}

function updateOverlayPreview() {
  const displayName = $('productName').value.trim();
  const message = $('adMessage').value.trim();
  const textMode = $('textMode').value;

  $('ovName').textContent = displayName.toUpperCase();
  $('ovMessage').textContent = wrapText(message);

  const show = textMode !== 'none' && (displayName || message);
  $('overlayPreview').hidden = !show;
  updateOverlayMetrics();
}

function setStageMode(mode) {
  const photo = $('stagePhoto');
  const video = $('resultVideo');
  const placeholder = $('stagePlaceholder');

  placeholder.hidden = mode !== 'placeholder';
  photo.hidden = mode !== 'preview';
  video.hidden = mode !== 'video';

  if (mode === 'preview') {
    photo.src = state.fileUrl;
    photo.alt = `Aperçu de ${$('productName').value || 'la photo du produit'}`;
    $('overlayPreview').hidden = false;
    $('stageTitle').textContent = 'Aperçu de l’habillage';
    $('stageSubtitle').textContent =
      'Position et taille exactes du texte incrusté dans la vidéo finale.';
    updateOverlayPreview();
  } else if (mode === 'placeholder') {
    $('overlayPreview').hidden = true;
    $('stageTitle').textContent = 'Aperçu';
    $('stageSubtitle').textContent =
      'L’habillage ci-dessous est exactement celui incrusté dans la vidéo.';
  } else {
    $('overlayPreview').hidden = true;
  }
}

/* ==================================================================== *
 * Validation et devis
 * ==================================================================== */

function syncForm() {
  const ready = Boolean(state.file) && $('productName').value.trim().length > 0;

  // Affiche l'aperçu dès qu'une photo est présente
  if (state.file && !state.running) setStageMode('preview');

  const button = $('generateBtn');
  button.disabled = !ready || state.running;
}

function updateEstimate() {
  const durationId = $('duration').value;
  if (!state.options) return;

  const duration = state.options.durations.find((item) => item.id === durationId);
  if (!duration) return;

  const providerId = $('provider').value;
  const providerInfo = (state.options.providers || []).find((item) => item.id === providerId);
  const isDemo = providerId === 'demo' || !providerInfo;

  $('videoTypeHint').textContent =
    state.options.videoTypes.find((item) => item.id === $('videoType').value)?.hint || '';
  $('ambianceHint').textContent =
    state.options.ambiances.find((item) => item.id === $('ambiance').value)?.hint || '';
  $('textModeHint').textContent =
    state.options.textModes.find((item) => item.id === $('textMode').value)?.hint || '';
  $('modelHint').textContent =
    $('model').value.includes('fast') ? 'Plus rapide, coût réduit.' : 'Rendu le plus abouti.';
  $('resolutionHint').textContent =
    $('resolution').value === '1080p' ? 'Vérifiez que le modèle choisi la supporte.' : 'Le plus rapide à produire.';
  $('aspectRatioHint').textContent =
    $('aspectRatio').value === 'auto'
      ? `Déduit de la photo : ${effectiveAspect() === '9:16' ? 'format vertical 9:16' : 'format paysage 16:9'}.`
      : 'Format imposé manuellement.';

  // Le sélecteur de modèle Veo n'a de sens que pour Veo : les autres moteurs
  // se configurent par variables d'environnement (FAL_MODEL, REPLICATE_MODEL).
  $('veoModelField').hidden = providerId !== 'veo';
  $('providerHint').textContent = isDemo
    ? 'Animation locale : aucune IA, aucun coût, résultat immédiat.'
    : providerInfo?.note || '';

  // Le plan réel est calculé par le serveur, à partir du fournisseur retenu.
  // `provider=demo` demande explicitement le rendu local (sinon le serveur
  // choisirait le premier moteur disponible, et annoncerait son coût).
  const query = new URLSearchParams({
    duration: durationId,
    provider: isDemo ? 'demo' : providerId,
    aspectRatio: $('aspectRatio').value === 'auto' ? '16:9' : $('aspectRatio').value,
    resolution: $('resolution').value,
  });

  fetch(`/api/plan?${query}`)
    .then((response) => response.json())
    .then((plan) => {
      const calls = plan.calls
        ? `${plan.calls} appel${plan.calls > 1 ? 's' : ''} ${plan.providerLabel || ''}`.trim()
        : 'aucun appel';

      $('planSummary').innerHTML =
        `<b>${plan.seconds} s</b> · ${plan.resolution} · ${calls}` +
        (plan.limitedTo ? ` · <span class="warn-text">limité à ${plan.limitedTo} s</span>` : '');

      $('estimate').textContent = isDemo
        ? `Rendu local · environ ${plan.seconds * 2} s de calcul, gratuit`
        : `${calls} facturé${plan.calls > 1 ? 's' : ''} · production estimée ${
            plan.calls > 1 ? '2 à 8 min' : '1 à 4 min'
          }`;
    })
    .catch(() => {
      $('planSummary').textContent = `${duration.seconds} s — ${duration.label}`;
    });
}

/* ==================================================================== *
 * Production
 * ==================================================================== */

async function startGeneration() {
  if (state.running) return;

  const productName = $('productName').value.trim();
  if (!productName) {
    $('productName').focus();
    return;
  }
  if (!state.file) {
    $('dropzone').focus();
    return;
  }

  const form = new FormData();
  form.append('photo', state.file);
  form.append('productName', productName);
  form.append('adMessage', $('adMessage').value.trim());
  form.append('videoTypeId', $('videoType').value);
  form.append('ambianceId', $('ambiance').value);
  form.append('durationId', $('duration').value);
  form.append('textModeId', $('textMode').value);
  form.append('aspectRatio', $('aspectRatio').value);
  form.append('resolution', $('resolution').value);
  form.append('model', $('model').value);

  // Le rendu local est demandé explicitement : il ne dépend d'aucune clé.
  const providerId = $('provider').value;
  if (providerId === 'demo') form.append('mode', 'demo');
  else form.append('providerId', providerId);

  enterRunningState();
  logLine('Envoi de la photo au serveur…');

  try {
    const { job } = await api('/api/jobs', { method: 'POST', body: form });
    state.jobId = job.id;
    applyJob(job);
    openStream(job.id);
  } catch (err) {
    exitRunningState();
    showError({ message: err.message, hint: err.payload?.hint, details: err.payload?.details });
  }
}

/**
 * Relance la production avec les mêmes réglages.
 * @param {{mode?: 'demo'}} [options] `mode: 'demo'` force un rendu local sans
 *   appel Veo — utilisé comme repli quand Veo refuse la requête.
 */
async function regenerate(options = {}) {
  if (state.running || !state.jobId) return;

  // Important : mémoriser l'identifiant AVANT enterRunningState(), qui le
  // réinitialise pour la nouvelle production.
  const previousId = state.jobId;
  const demo = options.mode === 'demo';

  enterRunningState();
  logLine(demo ? 'Relance en mode démo local (sans Veo)…' : 'Nouvelle tentative…');

  try {
    const { job } = await api(`/api/jobs/${previousId}/retry`, {
      method: 'POST',
      body: JSON.stringify(demo ? { mode: 'demo' } : {}),
    });
    state.jobId = job.id;
    applyJob(job);
    openStream(job.id);
  } catch (err) {
    // On restaure l'identifiant pour que le repli reste proposé.
    state.jobId = previousId;
    exitRunningState();
    showError({ message: err.message, hint: err.payload?.hint, details: err.payload?.details });
  }
}

function enterRunningState() {
  state.running = true;
  state.startedAt = Date.now();
  state.jobId = null;
  state.baseDetail = 'Veo peut mettre de 1 à 6 minutes selon la charge des serveurs.';

  $('progressZone').hidden = false;
  $('resultZone').hidden = true;
  $('errorZone').hidden = true;
  $('console').textContent = '';
  $('console').dataset.count = '0';
  $('barFill').style.width = '0%';
  $('progressPct').textContent = '0 %';
  $('progressLabel').textContent = 'Démarrage…';
  $('progressDetail').textContent = state.baseDetail;
  $('generateBtn').classList.add('busy');
  $('generateBtn').textContent = 'Production en cours…';
  $('generateBtn').disabled = true;
  setStageMode('placeholder');
  $('stageTitle').textContent = 'Production en cours';
  $('stageSubtitle').textContent = 'Le story-board s’affichera ici dès la fin du rendu.';
  $('stagePlaceholder').innerHTML = BUSY_HTML;

  clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    if (!state.running) return;
    const elapsed = formatElapsed(Date.now() - state.startedAt);
    $('progressDetail').textContent = `${state.baseDetail} · ${elapsed} écoulées`;
  }, 1000);
}

function exitRunningState() {
  state.running = false;
  clearInterval(state.elapsedTimer);
  $('generateBtn').classList.remove('busy');
  $('generateBtn').textContent = 'Animer mon produit';
  $('generateBtn').disabled = false;
  closeStream();
}

function openStream(jobId) {
  closeStream();

  const source = new EventSource(`/api/jobs/${jobId}/events`);
  state.stream = source;

  source.onmessage = (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    const job = payload.job;
    if (!job) return;

    applyJob(job);

    if (job.status === 'done' || job.status === 'error') {
      closeStream();
    }
  };

  source.onerror = () => {
    // Repli : interrogation periodique si les événements sont coupés.
    if (!state.stream || state.running === false) return;
    if (!state.poller) {
      state.poller = setInterval(async () => {
        try {
          const { job } = await api(`/api/jobs/${jobId}`);
          applyJob(job);
          if (job.status === 'done' || job.status === 'error') {
            clearInterval(state.poller);
            state.poller = null;
            closeStream();
          }
        } catch {
          /* on retentera */
        }
      }, 3000);
    }
  };
}

function closeStream() {
  if (state.stream) {
    state.stream.close();
    state.stream = null;
  }
  if (state.poller) {
    clearInterval(state.poller);
    state.poller = null;
  }
}

/* ==================================================================== *
 * Rendu de l'état d'une tâche
 * ==================================================================== */

function applyJob(job) {
  $('progressZone').hidden = false;
  $('barFill').style.width = `${job.progress}%`;
  $('progressPct').textContent = `${job.progress} %`;
  if (job.stageLabel && job.stage !== 'done') $('progressLabel').textContent = job.stageLabel;

  if (job.detail) {
    state.baseDetail = job.detail;
    const elapsed = formatElapsed(Date.now() - state.startedAt);
    $('progressDetail').textContent =
      job.status === 'running' ? `${job.detail} · ${elapsed} écoulées` : job.detail;
  }

  if (job.logs?.length) {
    const console_ = $('console');
    const wanted = job.logs.map((entry) => `${entry.level === 'warn' ? '⚠ ' : '· '}${entry.message}`);
    if (console_.dataset.count !== String(job.logs.length)) {
      console_.innerHTML = '';
      wanted.forEach((line, index) => {
        const span = document.createElement('div');
        span.textContent = line;
        span.className = job.logs[index].level || 'info';
        console_.append(span);
      });
      console_.dataset.count = String(job.logs.length);
      console_.scrollTop = console_.scrollHeight;
    }
  }

  if (job.status === 'done' && job.result) showResult(job);
  if (job.status === 'error') {
    exitRunningState();
    showError(job.error || { message: 'Erreur inconnue' });
  }
}

function showResult(job) {
  exitRunningState();
  const result = job.result;

  $('progressZone').hidden = true;
  $('errorZone').hidden = true;
  $('resultZone').hidden = false;

  const video = $('resultVideo');
  video.src = result.videoUrl;
  video.poster = result.posterUrl;
  video.load();
  setStageMode('video');

  $('stageTitle').textContent = 'Votre vidéo publicitaire';
  $('stageSubtitle').textContent = `${result.durationSec.toFixed(1)} s · ${result.aspectRatio} · ${
    result.resolution
  }`;

  $('resultTitle').textContent = job.input.productName;
  const modeBadge = $('resultMode');
  modeBadge.textContent = result.mode === 'provider' ? result.providerLabel : 'Démo locale';
  modeBadge.classList.toggle('success', result.mode === 'provider');

  $('downloadBtn').href = result.downloadUrl;

  const meta = [
    ['Durée', formatDuration(result.durationSec)],
    ['Image', `${result.width} × ${result.height}`],
    ['Cadrage', result.aspectRatio],
    ['Type', result.videoType],
    ['Audio', result.hasAudio ? result.audioLabel : 'Pas de son'],
    ['Texte', result.textMode],
    ['Moteur', result.mode === 'provider' ? result.providerLabel : 'Rendu local'],
    ['Poids', formatBytes(result.sizeBytes)],
  ];

  if (result.limitedTo) {
    logLine(
      `Durée limitée à ${result.limitedTo} s par le moteur choisi (${result.providerLabel}).`,
      'warn',
    );
  }

  $('resultMeta').innerHTML = '';
  for (const [label, value] of meta) {
    const item = document.createElement('div');
    item.className = 'meta-item';
    const span = document.createElement('span');
    span.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = value;
    item.append(span, strong);
    $('resultMeta').append(item);
  }

  $('promptOut').textContent =
    (job.prompts?.main || '—') +
    (job.prompts?.extension ? `\n\n--- Extension (+7 s) ---\n\n${job.prompts.extension}` : '');

  logLine(`Vidéo prête : ${formatDuration(result.durationSec)}`);
}

function showError(error) {
  exitRunningState();
  $('progressZone').hidden = true;
  $('resultZone').hidden = true;
  $('errorZone').hidden = false;

  $('errorMessage').textContent = error.message || 'Erreur inconnue';

  const hint = $('errorHint');
  hint.textContent = error.hint || '';
  hint.hidden = !error.hint;

  const detailsWrap = $('errorDetailsWrap');
  detailsWrap.hidden = !error.details;
  if (error.details) $('errorDetails').textContent = String(error.details);

  $('stagePlaceholder').innerHTML = PLACEHOLDER_HTML;
  setStageMode('placeholder');
  $('stageTitle').textContent = 'Production interrompue';
  $('stageSubtitle').textContent = 'Corrigez le point signalé puis relancez la production.';

  // Repli proposé uniquement quand un moteur distant était en jeu : l'utilisateur
  // n'est jamais laissé sans solution (quota, accès, filtre de sécurité…).
  const canFallback = state.health?.mode === 'provider' && Boolean(state.jobId);
  $('demoFallbackBtn').hidden = !canFallback;
  $('demoFallbackNote').hidden = !canFallback;
}

function logLine(message, level = 'info') {
  const console_ = $('console');
  const line = document.createElement('div');
  line.textContent = `· ${message}`;
  line.className = level;
  console_.append(line);
  console_.scrollTop = console_.scrollHeight;
}

/* ==================================================================== *
 * Réinitialisation
 * ==================================================================== */

function resetAll() {
  closeStream();
  exitRunningState();

  if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
  state.file = null;
  state.fileUrl = null;
  state.jobId = null;

  $('photoInput').value = '';
  $('dropzoneEmpty').hidden = false;
  $('dropzonePreview').hidden = true;
  $('photoError').hidden = true;
  $('productName').value = '';
  $('adMessage').value = '';
  $('productNameCount').textContent = '0';
  $('adMessageCount').textContent = '0';

  $('resultZone').hidden = true;
  $('errorZone').hidden = true;
  $('progressZone').hidden = true;

  const video = $('resultVideo');
  video.pause();
  video.removeAttribute('src');
  video.load();

  $('stagePlaceholder').innerHTML = PLACEHOLDER_HTML;
  setStageMode('placeholder');
  syncForm();
}

/* ==================================================================== *
 * Réglages
 * ==================================================================== */

/**
 * Construit une ligne par source de clé (Gemini, fal.ai, Replicate).
 * Chaque ligne indique si la clé est déjà configurée et où l'obtenir.
 */
function renderKeyRows() {
  const container = $('keyRows');
  const sources = state.options.keySources || {};
  container.innerHTML = '';

  for (const [id, source] of Object.entries(sources)) {
    const row = document.createElement('div');
    row.className = 'key-row';

    const head = document.createElement('div');
    head.className = 'key-head';

    const name = document.createElement('strong');
    name.textContent = source.label;

    const state_ = document.createElement('span');
    state_.className = `badge ${source.configured ? 'live' : 'subtle'}`;
    state_.textContent = source.configured ? 'configurée' : 'absente';

    const link = document.createElement('a');
    link.href = source.docsUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'key-link';
    link.textContent = 'obtenir une clé';

    head.append(name, state_, link);

    const controls = document.createElement('div');
    controls.className = 'key-controls';

    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = source.placeholder || 'Collez la clé ici';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.dataset.key = id;

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'ghost-btn small';
    save.textContent = source.configured ? 'Remplacer' : 'Enregistrer';
    save.dataset.action = 'save';
    save.dataset.key = id;

    controls.append(input, save);

    if (source.configured) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'ghost-btn small';
      clear.textContent = 'Retirer';
      clear.dataset.action = 'clear';
      clear.dataset.key = id;
      controls.append(clear);
    }

    row.append(head, controls);
    container.append(row);
  }
}

/** Enregistre ou retire une clé, puis rafraîchit l'état de l'application. */
async function handleKeyAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const { action, key } = button.dataset;
  const status = $('settingsStatus');
  const input = $('keyRows').querySelector(`input[data-key="${key}"]`);

  button.disabled = true;
  const label = button.textContent;
  button.textContent = '…';

  try {
    if (action === 'clear') {
      await api('/api/settings/api-key/clear', {
        method: 'POST',
        body: JSON.stringify({ key }),
      });
      status.textContent = 'Clé retirée.';
    } else {
      const value = input?.value.trim();
      if (!value) {
        status.textContent = 'Collez d’abord une clé dans le champ.';
        return;
      }
      status.textContent = 'Vérification…';
      const result = await api('/api/settings/api-key', {
        method: 'POST',
        body: JSON.stringify({ key, value }),
      });
      status.textContent = result.warning
        ? `Clé enregistrée, avec avertissement : ${result.warning}`
        : result.persisted
          ? 'Clé enregistrée et conservée dans .env.'
          : 'Clé active pour cette session (le fichier .env n’a pas pu être écrit).';
      if (input) input.value = '';
    }

    // L'état du serveur a changé : on rafraîchit options et santé.
    state.health = await api('/api/health');
    state.options = await api('/api/options');
    applyHealth();
    buildSelects();
    updateEstimate();
    loadDiagnostics();
  } catch (err) {
    status.textContent = err.message + (err.payload?.hint ? ` — ${err.payload.hint}` : '');
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

async function loadDiagnostics() {
  try {
    const info = await api('/api/diagnostics');
    $('diagBox').textContent =
      `ffmpeg ${info.ffmpeg.ok ? '✓' : '✗'} ${info.ffmpeg.path}` +
      (info.ffmpeg.version ? `\n${info.ffmpeg.version}` : '') +
      `\npolice ${info.font ? '✓ ' + info.font : '✗ aucune police trouvée'}`;
  } catch {
    $('diagBox').textContent = 'Diagnostic indisponible.';
  }
}
