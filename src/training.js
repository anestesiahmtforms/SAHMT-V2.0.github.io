import {acknowledgeLearningActivity, getMyScoreTotal, listTrainingProgress, saveTrainingProgress} from './data.js';
import {completeTraining, startTraining} from './training-start.js';

let playerApiPromise;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function videoIdFor(training) {
  if (training.videoId) return String(training.videoId);
  const url = String(training.videoUrl || '');
  const match = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i);
  return match?.[1] || '';
}

function watchedPercent(progress) {
  if (!progress?.duration || !Array.isArray(progress.watchedRanges)) return 0;
  const seconds = progress.watchedRanges.reduce((total, range) => total + Math.max(0, range.end - range.start), 0);
  return Math.min(100, Math.round(seconds / progress.duration * 100));
}

function addWatchedRange(ranges, start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const ordered = [...ranges, {start, end}]
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((left, right) => left.start - right.start);
  const merged = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 0.25) previous.end = Math.max(previous.end, range.end);
    else merged.push({start: range.start, end: range.end});
  }
  ranges.splice(0, ranges.length, ...merged);
}

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (playerApiPromise) return playerApiPromise;
  playerApiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => reject(new Error('O player de vídeo não respondeu. Verifique a conexão e tente novamente.')), 15000);
    window.onYouTubeIframeAPIReady = () => {
      window.clearTimeout(timeout);
      try { previous?.(); } catch { /* preserve other API consumers */ }
      resolve(window.YT);
    };
    if (!document.querySelector('script[data-sahmt-youtube-api]')) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.dataset.sahmtYoutubeApi = 'true';
      script.onerror = () => { window.clearTimeout(timeout); reject(new Error('Não foi possível carregar o player de vídeo.')); };
      document.head.append(script);
    }
  }).catch((error) => { playerApiPromise = null; throw error; });
  return playerApiPromise;
}

function learningActivityFeed(activities, receipts, errorMessage = '') {
  if (errorMessage) return `<section class="learning-activity-feed" aria-labelledby="learning-activities-title"><h3 id="learning-activities-title">Atividades de aprendizagem</h3><p class="empty-state">Não foi possível carregar as atividades. ${escapeHtml(errorMessage)}</p></section>`;
  const cards = activities.map((activity) => {
    const receipt = receipts.find((item) => item.activityId === activity.id &&
      (activity.recurrenceMode === 'ONCE' || item.activityVersion === activity.version));
    const resource = activity.resourceUrl
      ? `<a class="secondary-button learning-activity-link" href="${escapeHtml(activity.resourceUrl)}" target="_blank" rel="noopener noreferrer">Abrir material</a>`
      : '';
    const acknowledgement = activity.completionKind === 'ACKNOWLEDGEMENT'
      ? `<button class="primary-button" type="button" data-learning-activity-ack="${escapeHtml(activity.id)}" ${receipt ? 'disabled' : ''}>${receipt ? 'Ciência registrada' : 'Confirmar ciência'}</button>`
      : '';
    const evidenceNote = activity.completionKind === 'NONE'
      ? '<small>Abrir o material não registra conclusão nem gera pontos.</small>'
      : '<small>A confirmação fica vinculada à sua conta; não há pontuação nesta atividade.</small>';
    return `<article class="learning-activity-card"><div><p class="eyebrow">${escapeHtml(activity.category || 'APRENDIZAGEM')}</p><h4>${escapeHtml(activity.title)}</h4>${activity.description ? `<p>${escapeHtml(activity.description)}</p>` : ''}${evidenceNote}</div><div class="learning-activity-actions">${resource}${acknowledgement}</div></article>`;
  }).join('');
  return `<section class="learning-activity-feed" aria-labelledby="learning-activities-title"><header><div><p class="eyebrow">COMUNICADOS E ORIENTAÇÕES</p><h3 id="learning-activities-title">Atividades de aprendizagem</h3></div></header><p class="record-meta">Links externos não confirmam conclusão. Use “Confirmar ciência” somente quando a atividade pedir essa confirmação.</p>${cards || '<p class="empty-state">Não há atividades publicadas para você neste período.</p>'}</section>`;
}

export async function mountTrainingModule(content, {uid, trainings, learningActivities = [], learningReceipts = [], learningError = ''}) {
  content.innerHTML = '<p class="loading">Carregando seu progresso…</p>';
  const scorePromise = getMyScoreTotal(uid).catch(() => null);
  let progressResult;
  try {
    progressResult = await listTrainingProgress(uid);
  } catch (error) {
    content.innerHTML = `<p class="empty-state">Não foi possível carregar os treinamentos. ${escapeHtml(error.message || '')}</p>`;
    return;
  }
  const progressByTraining = new Map(progressResult.records.map((item) => [item.trainingId, item]));
  const cards = trainings.map((training) => {
    const progress = progressByTraining.get(training.id);
    const percent = watchedPercent(progress);
    const hasVideo = Boolean(videoIdFor(training));
    const accessPoints = Math.max(0, Number(training.accessPoints) || 0);
    const completionPoints = Math.max(0, Number(training.completionPoints) || 0);
    const pointsLabel = accessPoints || completionPoints
      ? `<small>Pontos: ${accessPoints.toLocaleString('pt-BR')} após validação do início · ${completionPoints.toLocaleString('pt-BR')} após validação da conclusão</small>`
      : '';
    const completed = progress?.status === 'COMPLETED';
    const completionValidationLabel = ({
      PENDING_VALIDATION: ' · pontuação pendente de validação',
      VALIDATED: ' · pontuação validada',
      REJECTED: ' · pontuação não validada',
      NEEDS_REVIEW: ' · pontuação requer revisão'
    })[progress?.completionStatus] || '';
    const progressLabel = completed ? `Concluído · ${percent}% registrado${completionValidationLabel}` : progress?.syncConflict ? 'O vídeo mudou; progresso anterior preservado para revisão na área Offline' : progress?.syncPending ? 'Progresso salvo neste aparelho; aguardando conexão' : progress?.stale ? 'Progresso salvo neste aparelho' : progress ? `${percent}% assistido · posição ${Math.floor(progress.lastPosition || 0)} s` : 'Ainda não iniciado';
    const completionValidationNote = completed && ['REJECTED', 'NEEDS_REVIEW'].includes(progress?.completionStatus) && progress?.completionValidationMessage
      ? `<small class="sync-error">${escapeHtml(progress.completionValidationMessage)}</small>` : '';
    return `<article class="training-card"><div class="training-card-copy"><p class="eyebrow">TREINAMENTO</p><h3>${escapeHtml(training.title || training.name || training.id)}</h3>${training.description ? `<p>${escapeHtml(training.description)}</p>` : ''}${pointsLabel}<small data-training-progress-label="${escapeHtml(training.id)}">${escapeHtml(progressLabel)}</small>${completionValidationNote}${progress ? `<progress max="100" value="${percent}" aria-label="${percent}% assistido"></progress>` : ''}</div><button type="button" class="primary-button" data-training-open="${escapeHtml(training.id)}" ${hasVideo ? '' : 'disabled'}>${hasVideo ? completed ? 'Rever vídeo' : progress ? 'Continuar' : 'Assistir' : 'Vídeo indisponível'}</button></article>`;
  }).join('');
  content.innerHTML = `<section class="training-score" aria-label="Pontuação SAHMT"><div><p class="eyebrow">PONTUAÇÃO SAHMT</p><strong id="training-score-total" aria-live="polite">…</strong><small id="training-score-status" role="status"></small></div></section>${learningActivityFeed(learningActivities, learningReceipts, learningError)}${progressResult.stale ? '<p class="sync-state">Sem conexão: exibindo catálogo e progresso salvos neste aparelho.</p>' : ''}${cards || '<p class="empty-state">Nenhum treinamento ativo foi publicado.</p>'}<dialog class="training-dialog" aria-labelledby="training-dialog-title"><header><div><p class="eyebrow">TREINAMENTO</p><h3 id="training-dialog-title"></h3></div><button type="button" class="secondary-button" data-training-close>Voltar</button></header><div class="training-player" id="training-player"></div><button type="button" class="primary-button training-play" data-training-toggle disabled>REPRODUZIR</button><p class="training-player-status" role="status" aria-live="polite"></p><section class="training-understanding" hidden><strong>Está entendendo o conteúdo?</strong><div><button type="button" class="secondary-button" data-training-answer="yes">Sim</button><button type="button" class="secondary-button" data-training-answer="no">Não</button></div></section><p class="training-server-note">Ao encerrar o vídeo com pelo menos 95% registrado, a conclusão é salva no Firestore e os pontos ficam pendentes de validação. O navegador informa os intervalos assistidos e o encerramento; esses dados não comprovam, por si só, a reprodução real.</p></dialog>`;
  const renderScoreTotal = (result) => {
    const total = content.querySelector('#training-score-total');
    const status = content.querySelector('#training-score-status');
    if (!total || !status) return;
    total.textContent = result?.total === null || !result ? '—' : `${result.total} pontos`;
    status.textContent = !result ? 'Pontuação indisponível' : result.stale ? 'Última pontuação salva neste aparelho' : 'Pontos confirmados no servidor';
  };
  void scorePromise.then(renderScoreTotal);

  const dialog = content.querySelector('.training-dialog');
  const status = content.querySelector('.training-player-status');
  const question = content.querySelector('.training-understanding');
  const playButton = content.querySelector('[data-training-toggle]');
  let active = null;
  let savePromise = null;

  content.querySelectorAll('[data-learning-activity-ack]').forEach((button) => button.addEventListener('click', async () => {
    const activity = learningActivities.find((item) => item.id === button.dataset.learningActivityAck);
    if (!activity || button.disabled) return;
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = 'Registrando…';
    const error = button.parentElement.querySelector('[role="status"]');
    error?.remove();
    try {
      await acknowledgeLearningActivity(activity, uid);
      button.textContent = 'Ciência registrada';
      const note = document.createElement('small');
      note.className = 'record-meta';
      note.setAttribute('role', 'status');
      note.textContent = 'Confirmação salva no Firestore. Esta atividade não concede pontos.';
      button.after(note);
    } catch (reason) {
      button.disabled = false;
      button.textContent = previousText;
      const note = document.createElement('small');
      note.className = 'sync-error';
      note.setAttribute('role', 'status');
      note.textContent = reason.message || 'Não foi possível confirmar a ciência.';
      button.after(note);
    }
  }));

  const save = async (force = false, completionRequested = false) => {
    if (!active?.player || !active.duration) return;
    if (active.progress?.status === 'COMPLETED') return active.progress;
    const position = active.player.getCurrentTime?.() || 0;
    if (!force && Date.now() - active.lastSavedAt < 15000) return;
    if (savePromise) {
      await savePromise;
      return force ? save(true, completionRequested) : active?.progress;
    }
    active.lastPosition = position;
    savePromise = saveTrainingProgress(uid, active.training.id, {duration: active.duration, lastPosition: position, watchedRanges: active.ranges, completionRequested})
      .then((record) => { active.lastSavedAt = Date.now(); active.progress = record; status.textContent = record.syncPending ? 'Progresso salvo neste aparelho; será sincronizado quando a conexão voltar.' : 'Progresso salvo.'; return record; })
      .catch((error) => { status.textContent = `Não foi possível salvar o progresso: ${error.message || error}`; return null; })
      .finally(() => { savePromise = null; });
    return savePromise;
  };

  const close = async () => {
    active?.player?.pauseVideo?.();
    if (active?.tick) window.clearInterval(active.tick);
    await save(true);
    active?.player?.destroy?.();
    active = null;
    question.hidden = true;
    dialog.close();
  };

  content.querySelector('[data-training-close]').addEventListener('click', () => { void close(); });
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); void close(); });
  const pauseWhenHidden = () => { if (document.hidden && active?.player) { active.player.pauseVideo(); void save(true); } };
  document.addEventListener('visibilitychange', pauseWhenHidden);
  playButton.addEventListener('click', () => {
    if (!active?.player) return;
    if (active.player.getPlayerState?.() === window.YT?.PlayerState?.PLAYING) active.player.pauseVideo();
    else active.player.playVideo();
  });
  content.querySelectorAll('[data-training-answer]').forEach((button) => button.addEventListener('click', () => {
    question.hidden = true;
    status.textContent = button.dataset.trainingAnswer === 'yes' ? 'Certo. O vídeo será retomado.' : 'O vídeo será retomado para você rever o conteúdo.';
    active?.player?.playVideo?.();
  }));

  content.querySelectorAll('[data-training-open]').forEach((button) => button.addEventListener('click', async () => {
    const training = trainings.find((item) => item.id === button.dataset.trainingOpen);
    if (!training) return;
    if (active) await close();
    const previousProgress = progressByTraining.get(training.id);
    active = {training, player: null, duration: Number(previousProgress?.duration) || 0, ranges: previousProgress?.watchedRanges || [], lastPosition: Number(previousProgress?.lastPosition) || 0, lastTickPosition: null, lastSavedAt: 0, halfwayAsked: false, tick: null, progress: previousProgress, startMessage: previousProgress?.status === 'COMPLETED' ? 'Este treinamento já foi concluído; você pode rever o conteúdo.' : 'Registrando o início do treinamento…'};
    content.querySelector('#training-dialog-title').textContent = training.title || training.name || training.id;
    content.querySelector('#training-player').innerHTML = '<div id="training-youtube"></div>';
    status.textContent = 'Abrindo vídeo…';
    dialog.showModal();
    void startTraining(training.id, uid).then((result) => {
      if (active?.training === training) {
        active.startMessage = result.pointsPending
          ? 'Início registrado. A pontuação de acesso aguarda validação.'
          : result.alreadyStarted ? 'Início já registrado anteriormente.' : 'Início registrado.';
        status.textContent = active.startMessage;
      }
    }).catch(() => {
      if (active?.training === training) {
        active.startMessage = 'O vídeo abrirá, mas o início ainda não foi registrado. Conecte-se para sincronizar o progresso.';
        status.textContent = active.startMessage;
      }
      return null;
    });
    try {
      const YT = await loadYouTubeApi();
      if (!active || active.training !== training) return;
      active.player = new YT.Player('training-youtube', {
        width: '100%', height: '100%', videoId: videoIdFor(training),
        playerVars: {playsinline: 1, origin: window.location.origin, rel: 0},
        events: {
          onReady: (event) => {
            if (!active || active.training !== training) return;
            active.player = event.target;
            active.duration = event.target.getDuration();
            playButton.disabled = false;
            const resume = Math.min(active.lastPosition, Math.max(0, active.duration - 1));
            void save(true).then(() => { if (resume > 0) event.target.seekTo(resume, true); status.textContent = active?.startMessage || (resume ? `Retomando de ${Math.floor(resume)} s.` : 'Vídeo pronto.'); });
          },
          onStateChange: (event) => {
            if (!active || active.training !== training) return;
            const states = YT.PlayerState;
            if (event.data === states.PLAYING) {
              playButton.textContent = 'PAUSAR';
              if (active.tick) window.clearInterval(active.tick);
              active.lastTickPosition = event.target.getCurrentTime();
              active.tick = window.setInterval(() => {
                if (!active) return;
                const now = event.target.getCurrentTime();
                const from = active.lastTickPosition;
                if (Number.isFinite(now) && Number.isFinite(from) && now > from && now - from <= 2.5) addWatchedRange(active.ranges, from, now);
                active.lastTickPosition = now;
                active.duration = event.target.getDuration() || active.duration;
                const half = active.duration / 2;
                if (!active.halfwayAsked && from < half && now >= half) {
                  active.halfwayAsked = true;
                  event.target.pauseVideo();
                  question.hidden = false;
                  status.textContent = 'Pausa rápida para confirmar o entendimento.';
                }
                if (Date.now() - active.lastSavedAt >= 15000) void save(true);
              }, 1000);
            } else {
              playButton.textContent = 'REPRODUZIR';
              if (active.tick) window.clearInterval(active.tick);
              active.tick = null;
              if (event.data === states.PAUSED) void save(true);
              if (event.data === states.ENDED) {
                const end = active.duration;
                const from = active.lastTickPosition;
                if (Number.isFinite(from) && end > from && end - from <= 3) addWatchedRange(active.ranges, from, end);
                const completionRequested = watchedPercent({duration: active.duration, watchedRanges: active.ranges}) >= 95;
                void save(true, completionRequested).then(async (saved) => {
                  const percent = watchedPercent(active.progress || {duration: active.duration, watchedRanges: active.ranges});
                  if (active?.training !== training) return;
                  if (percent < 95) {
                    status.textContent = `Vídeo encerrado. ${percent}% assistido; revise os trechos pendentes.`;
                    return;
                  }
                  if (!navigator.onLine || !saved || saved.syncPending) {
                    status.textContent = '95% de progresso foram registrados neste aparelho. Conecte-se para salvar a conclusão; os pontos aguardam validação.';
                    return;
                  }
                  try {
                    const result = await completeTraining(training.id, {ended: true, uid});
                    active.progress = {...saved, status: 'COMPLETED', completedAt: new Date().toISOString(), completionStatus: 'PENDING_VALIDATION'};
                    progressByTraining.set(training.id, active.progress);
                    const progressLabel = content.querySelector(`[data-training-progress-label="${CSS.escape(training.id)}"]`);
                    if (progressLabel) progressLabel.textContent = `Concluído · ${result.watchedPercent}% registrado · validação pendente`;
                    const openButton = content.querySelector(`[data-training-open="${CSS.escape(training.id)}"]`);
                    if (openButton) openButton.textContent = 'Rever vídeo';
                    status.textContent = result.alreadyCompleted
                      ? 'Este treinamento já estava concluído; a pontuação segue aguardando validação.'
                      : result.pointsPending ? `Conclusão registrada · ${result.watchedPercent}% assistido. Pontuação pendente de validação.`
                        : `Conclusão registrada · ${result.watchedPercent}% assistido.`;
                  } catch (error) {
                    status.textContent = `95% registrados, mas a conclusão não foi confirmada: ${error.message || error}. Reabra o vídeo para tentar novamente.`;
                  }
                });
              }
            }
          },
          onError: () => { status.textContent = 'Este vídeo não está disponível para reprodução.'; }
        }
      });
    } catch (error) {
      status.textContent = error.message || 'Falha ao abrir o treinamento.';
    }
  }));
  return async () => {
    document.removeEventListener('visibilitychange', pauseWhenHidden);
    if (!active) return;
    active.player?.pauseVideo?.();
    if (active.tick) window.clearInterval(active.tick);
    await save(true);
    active.player?.destroy?.();
    active = null;
    if (dialog.open) dialog.close();
  };
}
