import {createLiveReportSession} from './live-report-session.js';
import {reconcileReportMarkup} from './report-dom.js';

const CATEGORIES = new Set(['PERFORMANCE', 'GOVERNANCE']);
const MODALITY_LABELS = {ACKNOWLEDGEMENT: 'Ciência', SUGGESTION: 'Sugestão aprovada', TEST: 'Teste', MATERIAL: 'Material', QUESTIONS: 'Questões', CHECKLIST_TRANSFER: 'Transferência do Checklist', CHECKLIST: 'Checklist'};
const STATUS_LABELS = {PENDING: 'Pendente', PENDING_VALIDATION: 'Pendente', CONFIGURATION_PENDING: 'Configuração pendente', READY: 'Configurada', APPROVED: 'Aprovada', CONFIRMED: 'Confirmado', REJECTED: 'Recusada', NEEDS_REVIEW: 'Requer revisão', INACTIVE: 'Inativa', FAILED: 'Falha'};
const REQUEST_LABELS = {ASSIGN_MANAGER: 'Atribuição de gestor', CONFIGURE_ACTIVITY: 'Configuração de atividade', REVIEW_SUGGESTION: 'Revisão de sugestão', REQUEST_GOVERNANCE: 'Revisão de material ou questões', REVIEW_GOVERNANCE: 'Validação da revisão', CORRECT_SCORE: 'Correção de pontuação', RECONCILE_LINKS: 'Reconciliação de formulários'};
const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
const rows = value => Array.isArray(value) ? value : Array.isArray(value?.records) ? value.records : [];
const numberLabel = value => Number(value).toLocaleString('pt-BR', {maximumFractionDigits: 2});
const checklistTitle = award => { const day = String(award.day || award.activityId || award.transferId || '').match(/\d{4}-\d{2}-\d{2}/)?.[0]; return day ? 'Checklist · ' + day.split('-').reverse().join('/') : 'Checklist'; };
const pointLabel = value => `${numberLabel(value)} ponto${Number(value) === 1 ? '' : 's'}`;
function dateLabel(value) {
  const date = value?.toDate?.() || (value?.seconds !== undefined ? new Date(value.seconds * 1000) : new Date(value || ''));
  return Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', {timeZone: 'America/Sao_Paulo'}) : 'Data ainda não confirmada';
}
/** Calendar fields use the same Sao Paulo day as the trusted Apps Script config. */
export function evaluationCalendarInput(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(value + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
  }
  let parsed;
  try { parsed = value?.toDate?.() || (Number.isFinite(value?.seconds) ? new Date(value.seconds * 1000) : value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null); } catch { return ''; }
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(parsed);
  const part = name => parts.find(item => item.type === name)?.value || '';
  return [part('year'), part('month'), part('day')].join('-');
}
export function evaluationConfigurationFields(activity = {}) {
  const fields = ['acknowledgementItemId', 'suggestionProblemItemId', 'suggestionProposalItemId', 'suggestionBenefitItemId', 'acknowledgementValue', 'materialUrls'];
  const existing = Number(activity.configVersion) > 0;
  const complete = !existing || fields.every(field => Object.hasOwn(activity, field)) && Array.isArray(activity.materialUrls) && Boolean(evaluationCalendarInput(activity.validFrom)) && Boolean(evaluationCalendarInput(activity.validUntil));
  return {complete, values: {
    creditScopeId: activity.creditScopeId || activity.id || '', version: activity.version || '',
    acknowledgementItemId: activity.acknowledgementItemId ?? '', suggestionProblemItemId: activity.suggestionProblemItemId ?? '', suggestionProposalItemId: activity.suggestionProposalItemId ?? '', suggestionBenefitItemId: activity.suggestionBenefitItemId ?? '',
    acknowledgementValue: activity.acknowledgementValue ?? (existing ? '' : 'SIM'), materialUrls: Array.isArray(activity.materialUrls) ? activity.materialUrls.join('\n') : '',
    validFrom: evaluationCalendarInput(activity.validFrom), validUntil: evaluationCalendarInput(activity.validUntil),
    eligibleUids: (activity.eligibleUids || []).join('\n'), eligibleGroups: Array.isArray(activity.eligibleGroups) ? activity.eligibleGroups : [], managerAreaId: activity.managerAreaId || activity.areaIds?.[0] || ''
  }};
}
function safeUrl(value) {
  try { const url = new URL(String(value)); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
}
const evidenceLink = (value, label = 'Abrir evidência') => {
  const sources = Array.isArray(value) ? value : [value];
  return sources.map(source => safeUrl(typeof source === 'object' ? source?.url : source)).filter(Boolean).map(url => `<a class="evaluation-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`).join(' ');
};
function requestId() { return globalThis.crypto?.randomUUID?.() || `evaluation-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function ownRecords(snapshot, key, subjectUid, category) { return rows(snapshot?.[key]).filter(record => record?.uid === subjectUid && (!category || record.category === category)); }

export function evaluationFailureState(error, {online = true} = {}) {
  const code = String(error?.code || '').split('/').at(-1).toLowerCase(), message = String(error?.message || '');
  if (['permission-denied','unauthenticated'].includes(code) || /acesso.*revogad|sessão expirou|somente sua avaliação/i.test(message)) return 'blocked';
  if (!online || ['unavailable','network-request-failed','deadline-exceeded'].includes(code) || /client is offline|network.*failed|network.*offline/i.test(message)) return 'offline';
  return error ? 'error' : 'awaiting';
}
export function evaluationPresentation(snapshot, {category = 'PERFORMANCE', subjectUid, online = true} = {}) {
  if (!CATEGORIES.has(category)) throw new TypeError('Categoria de avaliação inválida.');
  const summary = snapshot?.summary, reference = snapshot?.reference;
  const key = category === 'PERFORMANCE' ? 'performance' : 'governance';
  const total = summary?.[`${key}Total`], revision = summary?.[`${key}Revision`];
  const awards = Array.isArray(snapshot?.awards) ? snapshot.awards.filter(award => award.uid === subjectUid && award.category === category) : null;
  const awardsConsistent = awards === null || awards.every(award => Number.isFinite(award.points)) && Math.abs(awards.reduce((sum, award) => sum + award.points, 0) - total) < 1e-8;
  const valid = awardsConsistent && summary?.uid === subjectUid && summary.status === 'CONFIRMED' && Number.isFinite(total) && Number.isInteger(revision) && revision >= 0 && reference?.[`${key}Status`] === 'CONFIRMED' && reference?.[`${key}Revision`] === revision;
  const confirmed = valid && snapshot?.fromCache === false && snapshot?.pendingWrites === false && online;
  const state = !online ? 'offline' : snapshot?.pendingWrites === true ? 'pending' : confirmed ? 'confirmed' : 'awaiting';
  const stateLabel = {offline: 'Sem conexão. Aguarde a atualização do saldo.', pending: 'Há alterações pendentes de confirmação.', confirmed: 'Saldo confirmado', awaiting: 'Aguardando atualização da avaliação.'}[state];
  if (!confirmed) return {state, stateLabel, confirmed: false, total: null, percentage: null, percentageLabel: 'Aguardando atualização'};
  if (category === 'GOVERNANCE') return {state, stateLabel, confirmed: true, total, percentage: null, percentageLabel: ''};
  if (!Number.isFinite(reference.maxPerformance) || !Number.isInteger(reference.eligibleCount) || reference.eligibleCount < 1) return {state: 'awaiting', stateLabel: 'Referência da equipe indisponível. Aguarde a atualização.', confirmed: false, total: null, percentage: null, percentageLabel: 'Aguardando atualização'};
  let percentage = null;
  if (reference.maxPerformance > 0) percentage = total / reference.maxPerformance * 100;
  else if (reference.allZero === true && total === 0 && reference.maxPerformance === 0) percentage = 0;
  return {state, stateLabel, confirmed: true, total, percentage, percentageLabel: percentage === null ? 'Sem referência positiva' : `${percentage.toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1})}%`};
}

export function evaluationSessionCanPreserve(previous, next) {
  if (previous?.status !== 'signed-in' || next?.status !== 'signed-in' || !previous.user?.uid || previous.user.uid !== next.user?.uid || previous.profile?.active !== true || previous.profile?.access !== true || next.profile?.active !== true || next.profile?.access !== true) return false;
  const before = previous.profile || {}, after = next.profile || {};
  const adminBefore = before.role === 'administrador_app' || before.permissions?.admin === true;
  const adminAfter = after.role === 'administrador_app' || after.permissions?.admin === true;
  if (adminBefore !== adminAfter) return false;
  return Object.entries(before.permissions || {}).every(([key,value]) => value !== true || after.permissions?.[key] === true);
}

export function evaluationAwardGroups(awards, {subjectUid, category} = {}) {
  const groups = new Map();
  for (const award of rows(awards)) {
    if (award?.uid !== subjectUid || award.category !== category || !Number.isFinite(award.points)) continue;
    const checklist = Boolean(award.transferId) || /^CHECKLIST/.test(award.modality || '') || /CHECKLIST/.test(award.sourceType || '');
    const key = checklist ? `checklist:${award.transferId || award.activityId || award.id}` : `${award.creditScopeId || award.activityId || award.id}:${award.version || ''}`;
    if (!groups.has(key)) groups.set(key, {key, checklist, activityId: award.activityId || '', version: award.version || '', title: checklist ? checklistTitle(award) : award.activityTitle || award.title || award.creditScopeId || award.activityId || 'Atividade', points: 0, awards: [], modalities: {}});
    const group = groups.get(key); group.points += award.points; group.awards.push(award); group.modalities[award.modality || 'UNKNOWN'] = (group.modalities[award.modality || 'UNKNOWN'] || 0) + award.points;
  }
  return [...groups.values()].sort((left, right) => left.title.localeCompare(right.title, 'pt-BR') || String(left.version).localeCompare(String(right.version)));
}

export function createEvaluationLifecycle({services, actorUid, subjectUid = actorUid, category, loadedLimit = 200, isCurrent = () => true, isOnline = () => true, onData = () => {}, onState = () => {}}) {
  let disposed = false, suspended = false;
  const servicePromise = Promise.resolve(services);
  const scope = {key: JSON.stringify([actorUid, subjectUid, category, loadedLimit]), uid: actorUid, subjectUid, category, module: 'evaluation', authorized: true, sourceKeys: ['report']};
  const controller = createLiveReportSession({isCurrent: () => !disposed && !suspended && isCurrent(), isOnline, onData, onState,
    subscribe: async (_current, callbacks) => {
      const data = await servicePromise;
      if (!callbacks.isCurrent()) return null;
      return data.watchEvaluation({actorUid, subjectUid, category, loadedLimit, onData: payload => callbacks.next('report', {data: payload, complete: true, fromCache: payload.fromCache, hasPendingWrites: payload.pendingWrites}), onError: callbacks.error});
    }});
  controller.start(scope);
  return {dispose() { if (disposed) return; disposed = true; controller.close('dispose'); }, suspend() { if (disposed || suspended) return; suspended = true; controller.close('suspend'); }, resume() { if (disposed || !isCurrent()) return; suspended = false; controller.setOnline(isOnline()); controller.start(scope, {force: true, reason: 'resume'}); }, setOnline(value) { if (!disposed) { controller.setOnline(value); if (value && !suspended && isCurrent()) controller.refresh('reconnect'); } }, snapshot: controller.snapshot};
}

function baseMarkup(category, isAdmin) {
  const governance = category === 'GOVERNANCE';
  return `<section class="evaluation-page ${governance ? 'evaluation-page--governance' : ''}">
    <header class="evaluation-heading"><h3>${governance ? 'AVALIAÇÃO DOS GESTORES' : 'DESEMPENHO'}</h3><p class="evaluation-subject"></p></header>
    ${isAdmin ? '<label class="evaluation-subject-selector">Consultar pessoa<select data-evaluation-person><option value="">Carregando pessoas autorizadas…</option></select></label>' : ''}
    <section class="evaluation-balance" aria-label="Saldo confirmado"><strong data-evaluation-total>—</strong>${governance ? '<small>Pontos de governança, separados do desempenho.</small>' : '<strong class="evaluation-percentage" data-evaluation-percentage>Aguardando atualização</strong><small>Percentual relativo ao maior saldo confirmado de desempenho da equipe.</small>'}<p data-evaluation-state role="status" aria-live="polite">Carregando avaliação…</p></section>
    ${governance ? '<section data-evaluation-assignments><h4>Áreas e matérias atribuídas</h4><p class="empty-state">Carregando atribuições…</p></section>' : ''}
    <div class="evaluation-actions"><button class="secondary-button" type="button" data-evaluation-open="suggestions" hidden>Revisar sugestões</button>${governance ? '<button class="primary-button" type="button" data-evaluation-open="revision">Solicitar validação de revisão</button>' : '<button class="primary-button" type="button" data-evaluation-open="activities">Atividades e formulários</button>'}${isAdmin ? '<button class="secondary-button" type="button" data-evaluation-open="correction">Editar pontuação</button><button class="secondary-button" type="button" data-evaluation-open="administration">Configuração e revisões</button>' : ''}</div>
    <section data-evaluation-records aria-live="polite"><h4>${governance ? 'Revisões aprovadas' : 'Matérias e atividades pontuadas'}</h4><p class="loading">Carregando registros…</p></section>
    <section data-evaluation-checklist ${governance ? 'hidden' : ''} aria-live="polite"></section><section class="evaluation-pending" data-evaluation-pending aria-live="polite"></section><section class="evaluation-audit" data-evaluation-audit></section><p data-evaluation-limit class="record-meta" hidden></p><button class="secondary-button" type="button" data-evaluation-more hidden>Carregar mais registros</button>
    <dialog class="evaluation-dialog" data-evaluation-dialog="activities"><header><h3>ATIVIDADES E FORMULÁRIOS</h3><button class="secondary-button" type="button" data-evaluation-close>VOLTAR</button></header><div class="evaluation-dialog-body" data-evaluation-activities><p class="loading">Carregando atividades…</p></div></dialog>
    <dialog class="evaluation-dialog" data-evaluation-dialog="suggestions"><header><h3>REVISÃO DE SUGESTÕES</h3><button class="secondary-button" type="button" data-evaluation-close>VOLTAR</button></header><div class="evaluation-dialog-body" data-evaluation-suggestion-queue></div></dialog><dialog class="evaluation-dialog" data-evaluation-dialog="correction"><header><h3>EDITAR PONTUAÇÃO</h3><button class="secondary-button" type="button" data-evaluation-close>VOLTAR</button></header><form data-evaluation-form="CORRECT_SCORE"><input type="hidden" name="category" value="${category}"><label>Atividade e lançamento<select name="awardId" required><option value="">Selecione um lançamento</option></select></label><p data-correction-current class="record-meta">Selecione o lançamento que será corrigido.</p><label>Valor corrigido<input name="correctedPoints" type="number" step="0.01" required></label><label>Justificativa obrigatória<textarea name="reason" rows="3" minlength="8" maxlength="1000" required></textarea></label><p class="record-meta">O valor original e a diferença ficam no histórico. Uma transferência do Checklist é corrigida como um par de débito e crédito; zero estorna ambos.</p><button class="primary-button" type="submit">Solicitar correção</button><p class="evaluation-form-status" role="status" aria-live="polite"></p></form></dialog>
    <dialog class="evaluation-dialog" data-evaluation-dialog="revision"><header><h3>VALIDAÇÃO DE REVISÃO</h3><button class="secondary-button" type="button" data-evaluation-close>VOLTAR</button></header><form data-evaluation-form="REQUEST_GOVERNANCE"><label>Matéria<select name="activityId" required><option value="">Selecione uma matéria atribuída</option></select></label><label>Área<select name="areaId" required><option value="">Selecione a área</option></select></label><div class="evaluation-form-grid"><label>Versão anterior<input name="previousVersion" type="number" min="0" step="1" required></label><label>Nova versão<input name="newVersion" type="number" min="1" step="1" required></label></div><fieldset><legend>Componentes alterados</legend><label><input type="checkbox" name="MATERIAL"> Material de apoio · 1 ponto</label><label><input type="checkbox" name="QUESTIONS"> Questões · 1 ponto</label></fieldset><label>Resumo das alterações<textarea name="summary" rows="3" minlength="8" maxlength="1500" required></textarea></label><label>Evidências do material · um link HTTPS por linha<textarea name="materialEvidence" rows="2" disabled maxlength="10000" placeholder="https://drive.google.com/…"></textarea></label><label>Evidências das questões · um link HTTPS por linha<textarea name="questionEvidence" rows="2" disabled maxlength="10000" placeholder="Link das questões alteradas"></textarea></label><p class="record-meta">A solicitação não concede pontos. Alteração efetiva, versões, designação e evidências precisam ser validadas por administrador diferente do beneficiário.</p><button class="primary-button" type="submit">Enviar para validação</button><p class="evaluation-form-status" role="status" aria-live="polite"></p></form></dialog>
    <dialog class="evaluation-dialog" data-evaluation-dialog="administration"><header><h3>CONFIGURAÇÃO E REVISÕES</h3><button class="secondary-button" type="button" data-evaluation-close>VOLTAR</button></header><div class="evaluation-dialog-body"><button class="secondary-button" type="button" data-evaluation-reconcile>Reconciliar vínculos dos formulários</button><p class="evaluation-admin-status" role="status" aria-live="polite"></p><section data-evaluation-review-queue><h4>Solicitações e contribuições</h4><p class="loading">Carregando revisões…</p></section>
      <details class="evaluation-editor"><summary>Gestor responsável pela área</summary><form data-evaluation-form="ASSIGN_MANAGER"><label>Área<select name="areaId" required><option value="">Selecione a área</option></select></label><label>Gestor<select name="managerUid" required><option value="">Selecione uma pessoa autorizada</option></select></label><p data-assignment-current class="record-meta"></p><button class="primary-button" type="submit">Solicitar atribuição</button><p class="evaluation-form-status" role="status" aria-live="polite"></p></form></details>
      <details class="evaluation-editor"><summary>Configurar atividade e campos do Forms</summary><form data-evaluation-form="CONFIGURE_ACTIVITY"><label>Formulário<select name="activityId" required><option value="">Selecione um formulário</option></select></label><label>Identificador estável da matéria<input name="creditScopeId" maxlength="128" required></label><label>Versão elegível<input name="version" type="number" min="1" step="1" required></label><label>Resposta afirmativa de ciência<input name="acknowledgementValue" maxlength="80" value="SIM"></label><label>Materiais de apoio · um link HTTPS por linha<textarea name="materialUrls" rows="2" maxlength="10000"></textarea></label><fieldset><legend>Modalidades</legend><label><input name="acknowledgement" type="checkbox"> Ciência · 1 ponto</label><label><input name="suggestion" type="checkbox"> Sugestão aprovada · 2 pontos</label><label><input name="test" type="checkbox"> Teste · nota corrigida no Forms</label></fieldset><label>ID real do item de ciência<input name="acknowledgementItemId" maxlength="128"></label><label>ID real de sugestão: problema<input name="suggestionProblemItemId" maxlength="128"></label><label>ID real de sugestão: proposta<input name="suggestionProposalItemId" maxlength="128"></label><label>ID real de sugestão: benefício<input name="suggestionBenefitItemId" maxlength="128"></label><div class="evaluation-form-grid"><label>Início<input name="validFrom" type="date" required></label><label>Fim<input name="validUntil" type="date" required></label></div><fieldset><legend>Público autorizado</legend><label><input name="eligibleGeneral" type="checkbox"> Acesso geral</label><label><input name="eligibleRestricted" type="checkbox"> Acesso restrito</label><small>Os grupos são conferidos no cadastro de e-mails e nas regras de acesso. UIDs são opcionais quando um grupo for marcado.</small></fieldset><label>UIDs Firebase individuais · um por linha<textarea name="eligibleUids" rows="3" maxlength="12999"></textarea></label><label>Área do gestor<select name="managerAreaId" required><option value="">Selecione a área</option></select></label><p class="record-meta">IDs, e-mail verificado, acesso, gabarito e pesos serão conferidos no Google Forms. O app não envia notas nem comprova identidade por campos digitados.</p><button class="primary-button" type="submit">Enviar configuração para validação</button><p class="evaluation-form-status" role="status" aria-live="polite"></p></form></details>
    </div></dialog></section>`;
}

function awardGroupMarkup(groups, ledger, category) {
  if (!groups.length) return '<p class="empty-state">Nenhum lançamento confirmado nesta categoria.</p>';
  return `<ol class="evaluation-record-list">${groups.map(group => {
    const history = ledger.filter(item => group.awards.some(award => award.id === item.awardId));
    return `<li id="evaluation-group-${escapeHtml(group.key)}"><article><header><h5>${escapeHtml(group.title)}</h5><strong>${escapeHtml(pointLabel(group.points))}</strong></header>${group.version ? `<small>Versão ${escapeHtml(group.version)}</small>` : ''}<dl>${Object.entries(group.modalities).map(([modality, points]) => `<div><dt>${escapeHtml(MODALITY_LABELS[modality] || modality)}</dt><dd>${escapeHtml(pointLabel(points))}</dd></div>`).join('')}</dl>${category === 'GOVERNANCE' ? '<small>Governança exclusiva; não altera desempenho ou percentual da equipe.</small>' : ''}${history.length ? `<details><summary>Histórico e evidências</summary><ul>${history.map(item => `<li><strong>${escapeHtml(MODALITY_LABELS[item.modality] || item.modality || 'Ajuste')} · ${escapeHtml(item.points > 0 ? '+' : '')}${escapeHtml(numberLabel(item.points))}</strong><small>${escapeHtml(dateLabel(item.createdAt))}</small>${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ''}${item.correctsId ? '<small>Ajuste auditável de lançamento anterior.</small>' : ''}${item.approvedByUid ? `<small>Aprovação: ${escapeHtml(item.approvedByName || item.approvedByUid)}</small>` : ''}${evidenceLink(item.evidence)}</li>`).join('')}</ul></details>` : ''}</article></li>`;
  }).join('')}</ol>`;
}
export function evaluationPendingParticipations(snapshot, subjectUid) {
  return ownRecords(snapshot, 'participations', subjectUid).filter(item => !['CONFIRMED', 'APPROVED'].includes(item.status) || item.test?.status === 'PENDING_GRADE').map(item => item.test?.status === 'PENDING_GRADE' && ['CONFIRMED', 'APPROVED'].includes(item.status) ? {...item, status: 'PENDING'} : item);
}
function pendingMarkup(snapshot, subjectUid, category) {
  const participations = category === 'PERFORMANCE' ? evaluationPendingParticipations(snapshot, subjectUid) : [];
  const revisions = (category === 'GOVERNANCE' ? ownRecords(snapshot, 'revisions', subjectUid) : []).filter(item => item.status !== 'APPROVED');
  const requests = rows(snapshot?.requests).filter(item => item.type === 'CORRECT_SCORE' ? item.payload?.category === category : category === 'GOVERNANCE' ? ['REQUEST_GOVERNANCE', 'REVIEW_GOVERNANCE'].includes(item.type) : item.type === 'REVIEW_SUGGESTION').filter(item => item.actorUid === subjectUid || item.payload?.uid === subjectUid || item.payload?.subjectUid === subjectUid).filter(item => !['CONFIRMED', 'APPROVED', 'COMPLETED', 'PROCESSED'].includes(item.status));
  const items = [...participations.map(item => ({...item, title: item.activityTitle || item.activityId || 'Participação', note: item.reason || (['PENDING_GRADE', 'PENDING'].includes(item.test?.status) ? 'Nota do Forms ainda indisponível.' : '')})), ...revisions.map(item => ({...item, title: item.activityTitle || item.activityId || 'Revisão', note: item.reason || item.summary})), ...requests.map(item => ({...item, title: REQUEST_LABELS[item.type] || item.type, note: item.result?.message || item.error || item.reason}))];
  return `<h4>Pendências, recusas e falhas</h4>${items.length ? `<ul class="evaluation-pending-list">${items.map(item => `<li><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(STATUS_LABELS[item.status] || item.status || 'Pendente')}${item.updatedAt || item.createdAt ? ` · ${escapeHtml(dateLabel(item.updatedAt || item.createdAt))}` : ''}</small>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}</li>`).join('')}</ul>` : '<p class="empty-state">Nenhuma pendência informada. Pendências não entram no saldo confirmado.</p>'}`;
}
export function mountPerformanceModule(content, {uid, profile = {}, category = 'PERFORMANCE', subjectUid = uid, areas = [], isAdmin = () => false, isCurrent = () => true, canReviewSuggestions = () => false, services, onOpenGovernance, onBlocked} = {}) {
  if (!uid || !CATEGORIES.has(category)) throw new TypeError('Informe a conta e a categoria da avaliação.');
  let disposed = false, blocked = false, connectionUnavailable = false, onlineOverride, metadataLoadSequence = 0, selectedUid = subjectUid, lifecycle = null, latest = null, mountVersion = 0, loadedLimit = 200;
  let assignments = [], activities = [], people = [], reviewQueue = [];
  const eventController = new AbortController();
  const servicePromise = services ? Promise.resolve(services) : import('./evaluation-data.js');
  const current = () => !disposed && !blocked && content.isConnected && isCurrent();
  const isModuleOnline = () => onlineOverride ?? (navigator.onLine !== false);
  const admin = () => current() && isAdmin() === true;
  const suggestionReviewer = () => current() && (admin() || canReviewSuggestions() === true || assignments.some(item => item.uid === uid));
  content.innerHTML = baseMarkup(category, isAdmin() === true);
  const page = content.querySelector('.evaluation-page');
  const find = selector => page.querySelector(selector);
  const all = selector => [...page.querySelectorAll(selector)];
  const formFor = type => find(`[data-evaluation-form="${type}"]`);
  const nameFor = target => (target === uid ? profile.displayName : '') || people.find(person => person.uid === target || person.id === target)?.displayName || target;
  const setText = (selector, value) => { const element = find(selector); if (element && element.textContent !== value) element.textContent = value; };
  const markup = (selector, value) => {
    const element = find(selector); if (!element || element.innerHTML === value) return;
    const opened = [...element.querySelectorAll('details[open]')].map(detail => detail.closest('[id]')?.id).filter(Boolean);
    reconcileReportMarkup(element, value, {preserveSelectors: ['form[data-dirty="true"]', 'form[data-submitting="true"]']});
    for (const detail of element.querySelectorAll('details')) if (opened.includes(detail.closest('[id]')?.id)) detail.open = true;
  };
  const activityFor = id => activities.find(item => item.id === id || item.activityId === id);
  const assignmentFor = areaId => assignments.find(item => item.areaId === areaId || item.id === areaId);
  const setOptions = (select, options, prompt) => {
    if (!select || select === document.activeElement || select.dataset.dirty === 'true') return;
    const previous = select.value;
    select.innerHTML = `<option value="">${escapeHtml(prompt)}</option>${options.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}`;
    if (options.some(item => item.id === previous)) select.value = previous;
  };
  const optionsForAreas = () => {
    const map = new Map(areas.map(area => [area.id, {id: area.id, name: area.name || area.title || area.id}]));
    for (const assignment of assignments) { const id = assignment.areaId || assignment.id; if (!map.has(id)) map.set(id, {id, name: assignment.areaName || id}); }
    for (const activity of activities) for (const id of activity.areaIds || []) if (!map.has(id)) map.set(id, {id, name: id});
    return [...map.values()];
  };
  function renderAssignments() {
    if (category !== 'GOVERNANCE') return;
    const assigned = assignments.filter(item => item.uid === selectedUid);
    const assignedActivities = activities.filter(item => item.managerUid === selectedUid);
    markup('[data-evaluation-assignments]', `<h4>Áreas e matérias atribuídas</h4>${assigned.length || assignedActivities.length ? `<ul class="evaluation-assignment-list">${assigned.map(item => `<li><strong>${escapeHtml(item.areaName || areas.find(area => area.id === item.areaId)?.name || item.areaId)}</strong><small>Vigência: ${escapeHtml(dateLabel(item.effectiveAt))} · versão ${escapeHtml(item.version)}</small></li>`).join('')}${assignedActivities.map(item => `<li><strong>${escapeHtml(item.title || item.id)}</strong><small>Versão ${escapeHtml(item.version)} · ${escapeHtml(STATUS_LABELS[item.status] || item.status)}</small></li>`).join('')}</ul>` : '<p class="empty-state">Nenhuma atribuição vigente informada. O histórico aprovado permanece preservado.</p>'}`);
    const ownAssigned = assignments.filter(item => item.uid === uid);
    setOptions(formFor('REQUEST_GOVERNANCE')?.elements.areaId, ownAssigned.map(item => ({id: item.areaId || item.id, name: item.areaName || item.areaId || item.id})), 'Selecione uma área atribuída');
    setOptions(formFor('REQUEST_GOVERNANCE')?.elements.activityId, activities.filter(item => item.managerUid === uid).map(item => ({id: item.id, name: item.title || item.id})), 'Selecione uma matéria atribuída');
    const revisionButton = find('[data-evaluation-open="revision"]');
    if (revisionButton) revisionButton.hidden = selectedUid !== uid || !ownAssigned.length;
  }
  function updateCorrectionOptions() {
    const form = formFor('CORRECT_SCORE');
    if (!form || !admin()) return;
    const awards = ownRecords(latest, 'awards', selectedUid, category);
    setOptions(form.elements.awardId, awards.map(award => ({id: award.id, name: `${award.activityTitle || award.activityId || 'Checklist'} · ${MODALITY_LABELS[award.modality] || award.modality} · ${pointLabel(award.points)}`})), 'Selecione um lançamento');
  }
  function renderSnapshot(snapshot, {live = false} = {}) {
    if (!current()) return;
    latest = snapshot;
    const liveConfirmed = lifecycle?.snapshot().confirmed === true;
    if (live && liveConfirmed && snapshot.fromCache === false && snapshot.pendingWrites === false) connectionUnavailable = false;
    const presentation = evaluationPresentation({...snapshot, fromCache: snapshot.fromCache !== false || !liveConfirmed}, {category, subjectUid: selectedUid, online: isModuleOnline() && !connectionUnavailable});
    setText('[data-evaluation-total]', presentation.total === null ? '—' : pointLabel(presentation.total));
    setText('[data-evaluation-percentage]', presentation.percentageLabel);
    setText('[data-evaluation-state]', presentation.stateLabel);
    page.dataset.evaluationState = presentation.state;
    const ledger = ownRecords(snapshot, 'ledger', selectedUid, category);
    const groups = evaluationAwardGroups(snapshot.awards, {subjectUid: selectedUid, category}).map(group => ({...group, title: activityFor(group.activityId)?.title || group.title}));
    markup('[data-evaluation-records]', `<h4>${category === 'GOVERNANCE' ? 'Revisões aprovadas' : 'Matérias e atividades pontuadas'}</h4>${awardGroupMarkup(groups.filter(group => !group.checklist), ledger, category)}`);
    if (category === 'PERFORMANCE') markup('[data-evaluation-checklist]', `<h4>Ajustes do Checklist</h4>${awardGroupMarkup(groups.filter(group => group.checklist), ledger, category)}`);
    markup('[data-evaluation-pending]', pendingMarkup(snapshot, selectedUid, category));
    if (category === 'GOVERNANCE') {
      const approved = ownRecords(snapshot, 'revisions', selectedUid).filter(item => item.status === 'APPROVED');
      markup('[data-evaluation-audit]', `<h4>Evidências das revisões aprovadas</h4>${approved.length ? `<ol class="evaluation-record-list">${approved.map(item => `<li><strong>${escapeHtml(activityFor(item.activityId)?.title || item.activityTitle || item.activityId)}</strong><small>Versões ${escapeHtml(item.previousVersion)} → ${escapeHtml(item.newVersion)} · ${escapeHtml(dateLabel(item.updatedAt || item.createdAt))}</small><p>${escapeHtml(item.summary)}</p><small>${escapeHtml((item.components || []).map(value => MODALITY_LABELS[value] || value).join(' · '))}</small>${evidenceLink(item.materialEvidence, 'Material')}${evidenceLink(item.questionEvidence, 'Questões')}<small>Aprovação: ${escapeHtml(item.approvedByName || item.approvedByUid || 'Aguardando identificação')}</small></li>`).join('')}</ol>` : '<p class="empty-state">Nenhuma revisão aprovada informada.</p>'}`);
    }
    const more = find('[data-evaluation-more]'), limit = find('[data-evaluation-limit]');
    const historyLimitReached = snapshot.hasMore === true && Number(snapshot.loadedLimit || loadedLimit) >= 5000;
    if (more) { more.hidden = snapshot.hasMore !== true; more.disabled = historyLimitReached; }
    if (limit) { limit.hidden = snapshot.hasMore !== true; limit.textContent = historyLimitReached ? 'Histórico parcial: limite de 5.000 registros nesta consulta. O saldo confirmado considera todos os lançamentos; solicite ao administrador a consulta adicional do histórico.' : 'Exibindo uma parte do histórico. O saldo confirmado considera todos os lançamentos.'; }
    updateCorrectionOptions();
  }
  function blockAccess() {
    if (blocked || disposed) return;
    blocked = true; metadataLoadSequence++; mountVersion++; eventController.abort();
    for (const dialog of all('dialog')) if (dialog.open) dialog.close();
    lifecycle?.dispose(); latest = null; activities = []; assignments = []; people = []; reviewQueue = [];
    page.innerHTML = '<p class="empty-state" role="alert">Acesso bloqueado. Entre novamente ou procure o administrador para verificar sua autorização.</p>';
    onBlocked?.();
  }
  function openScope({retain = false} = {}) {
    lifecycle?.dispose(); if (!retain) latest = null;
    setText('.evaluation-subject', nameFor(selectedUid)); setText('[data-evaluation-total]', '—'); setText('[data-evaluation-percentage]', 'Aguardando atualização'); setText('[data-evaluation-state]', 'Carregando avaliação…');
    if (!retain) { markup('[data-evaluation-records]', '<p class="loading">Carregando registros…</p>'); markup('[data-evaluation-checklist]', ''); markup('[data-evaluation-pending]', ''); markup('[data-evaluation-audit]', ''); }
    renderAssignments();
    const version = ++mountVersion;
    lifecycle = createEvaluationLifecycle({services: servicePromise, actorUid: uid, subjectUid: selectedUid, category, loadedLimit, isCurrent: () => current() && version === mountVersion && (selectedUid === uid || admin()), isOnline: isModuleOnline, onData: snapshot => renderSnapshot(snapshot, {live: true}),
      onState: state => {
        if (!current() || version !== mountVersion) return;
        const failure = evaluationFailureState(state.error, {online: isModuleOnline() && state.state !== 'offline'});
        if (failure === 'blocked') { blockAccess(); return; }
        if (!state.confirmed || failure === 'offline') { setText('[data-evaluation-total]', '—'); setText('[data-evaluation-percentage]', 'Aguardando atualização'); }
        if (failure === 'offline') { connectionUnavailable = true; page.dataset.evaluationState = 'offline'; setText('[data-evaluation-state]', 'Sem conexão. Aguarde a atualização do saldo.'); }
        else if (state.error) { page.dataset.evaluationState = 'error'; setText('[data-evaluation-state]', 'Falha na atualização. ' + (state.error.message || 'Tente novamente ao retornar ao app.')); }
        else if (!state.confirmed) setText('[data-evaluation-state]', 'Aguardando confirmação dos dados no servidor.');
      }});
  }
  async function refreshMetadata() {
    const version = mountVersion, loadSequence = ++metadataLoadSequence;
    if (!isModuleOnline() || connectionUnavailable) { if (current()) markup('[data-evaluation-activities]', '<p class="empty-state">Sem conexão. As atividades serão atualizadas ao reconectar.</p>'); return; }
    try {
      const data = await servicePromise;
      const [activityResult, assignmentResult, peopleResult] = await Promise.all([data.listEvaluationActivities(uid), data.listEvaluationAssignments(uid), admin() ? data.listEvaluationPeople(uid) : Promise.resolve([])]);
      if (!current() || version !== mountVersion || loadSequence !== metadataLoadSequence) return;
      activities = rows(activityResult); assignments = rows(assignmentResult); people = rows(peopleResult);
      setText('.evaluation-subject', nameFor(selectedUid));
      setOptions(find('[data-evaluation-person]'), people.map(person => ({id: person.uid || person.id, name: person.displayName || person.name || person.uid || person.id})), 'Selecione uma pessoa');
      const personSelect = find('[data-evaluation-person]'); if (personSelect && !personSelect.value) personSelect.value = selectedUid;
      renderAssignments(); renderActivities();
      const suggestionButton = find('[data-evaluation-open="suggestions"]'); if (suggestionButton) suggestionButton.hidden = !suggestionReviewer();
      const areaOptions = optionsForAreas();
      setOptions(formFor('ASSIGN_MANAGER')?.elements.areaId, areaOptions, 'Selecione a área');
      setOptions(formFor('ASSIGN_MANAGER')?.elements.managerUid, people.map(person => ({id: person.uid || person.id, name: person.displayName || person.name || person.uid || person.id})), 'Selecione o gestor');
      setOptions(formFor('CONFIGURE_ACTIVITY')?.elements.activityId, activities.map(activity => ({id: activity.id, name: `${activity.title || activity.id} · ${STATUS_LABELS[activity.status] || activity.status}`})), 'Selecione um formulário');
      setOptions(formFor('CONFIGURE_ACTIVITY')?.elements.managerAreaId, areaOptions, 'Selecione a área do gestor');
      if (latest) renderSnapshot(latest);
      if (!assignments.some(assignment => assignment.uid === uid)) find('[data-evaluation-own-governance]')?.remove();
      if (onOpenGovernance && assignments.some(assignment => assignment.uid === uid) && !find('[data-evaluation-own-governance]')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-button'; button.dataset.evaluationOwnGovernance = 'true'; button.textContent = 'Avaliação dos Gestores';
        button.addEventListener('click', () => { if (current()) onOpenGovernance(); }, {signal: eventController.signal}); find('.evaluation-actions').append(button);
      }
    } catch (error) {
      if (!current() || loadSequence !== metadataLoadSequence) return;
      if (evaluationFailureState(error, {online: isModuleOnline()}) === 'blocked') { blockAccess(); return; }
      if (evaluationFailureState(error, {online: isModuleOnline()}) === 'offline') { connectionUnavailable = true; lifecycle?.setOnline(false); }
      markup('[data-evaluation-activities]', `<p class="empty-state" role="status">Não foi possível consultar atividades e atribuições. ${escapeHtml(error.message || '')}</p>`);
      setText('.evaluation-admin-status', `Falha ao carregar configuração: ${error.message || ''}`);
    }
  }
  function renderActivities() {
    markup('[data-evaluation-activities]', activities.length ? `<ol class="evaluation-activity-list">${activities.map(activity => {
      const configured = activity.status === 'READY' && activity.active === true;
      const url = configured ? safeUrl(activity.responderUrl) : '';
      return `<li id="evaluation-activity-${escapeHtml(activity.id)}"><strong>${escapeHtml(activity.title || activity.id)}</strong><small>Versão ${escapeHtml(activity.version || 'não definida')} · ${escapeHtml(STATUS_LABELS[activity.status] || activity.status || 'Configuração pendente')}</small>${activity.reason ? `<p>${escapeHtml(activity.reason)}</p>` : ''}<small>${[activity.modalities?.acknowledgement ? 'Ciência: 1 ponto' : '', activity.modalities?.suggestion ? 'Sugestão aprovada: 2 pontos' : '', activity.modalities?.test ? 'Teste: nota corrigida do Forms' : ''].filter(Boolean).map(escapeHtml).join(' · ')}</small>${evidenceLink(activity.materialUrls, 'Material de apoio')}${url ? `<a class="primary-button evaluation-link-button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Abrir formulário</a>` : '<small>Participação aguardando configuração ou vigência válida.</small>'}<small>Abrir o formulário não gera pontos. A ciência registra uma declaração do participante e não comprova leitura integral.</small></li>`;
    }).join('')}</ol>` : '<p class="empty-state">Nenhuma atividade elegível foi vinculada ainda.</p>');
  }
  async function refreshReviewQueue({suggestionsOnly = false} = {}) {
    if (!(suggestionsOnly ? suggestionReviewer() : admin())) return;
    try {
      const data = await servicePromise;
      const result = await data.listEvaluationReviewQueue(uid);
      if (!(suggestionsOnly ? suggestionReviewer() : admin())) return;
      reviewQueue = Array.isArray(result) ? result : [...rows(result.participations).map(item => ({...item, type: 'SUGGESTION'})), ...rows(result.revisions).map(item => ({...item, type: 'GOVERNANCE'})), ...rows(result.requests)];
      if (!Array.isArray(result)) {
        if (Array.isArray(result.activities)) activities = [...new Map([...activities, ...result.activities].map(item => [item.id, item])).values()];
        if (Array.isArray(result.assignments)) assignments = result.assignments;
      }
      if (suggestionsOnly) reviewQueue = reviewQueue.filter(item => item.type === 'SUGGESTION');
      const queueTarget = suggestionsOnly ? '[data-evaluation-suggestion-queue]' : '[data-evaluation-review-queue]';
      markup(queueTarget, `<h4>Solicitações e contribuições</h4>${reviewQueue.length ? `<ul class="evaluation-review-list">${reviewQueue.map(item => {
        const type = item.type === 'SUGGESTION' || item.suggestion ? 'REVIEW_SUGGESTION' : item.type === 'GOVERNANCE' || item.components ? 'REVIEW_GOVERNANCE' : '';
        const author = item.uid || item.actorUid, state = type === 'REVIEW_SUGGESTION' ? item.suggestion?.status || item.status : item.status;
        const canReview = author !== uid && ['PENDING', 'NEEDS_REVIEW', 'PENDING_VALIDATION'].includes(state) && (type === 'REVIEW_SUGGESTION' ? suggestionReviewer() : type === 'REVIEW_GOVERNANCE' && admin());
        return `<li id="evaluation-review-${escapeHtml(item.id)}"><strong>${escapeHtml(item.activityTitle || activityFor(item.activityId)?.title || item.activityId || REQUEST_LABELS[item.type] || 'Solicitação')}</strong><small>${escapeHtml(nameFor(author))} · ${escapeHtml(STATUS_LABELS[state] || state)}</small>${item.suggestion ? `<p>Problema: ${escapeHtml(item.suggestion.problem)}</p><p>Proposta: ${escapeHtml(item.suggestion.proposal)}</p><p>Benefício: ${escapeHtml(item.suggestion.benefit)}</p>` : `<p>${escapeHtml(item.summary || item.reason || item.note || '')}</p>`}${evidenceLink(item.materialEvidence, 'Material')}${evidenceLink(item.questionEvidence, 'Questões')}${canReview ? `<form data-evaluation-review="${escapeHtml(item.id)}" data-review-type="${type}"><label>Nota da revisão<textarea name="note" rows="2" minlength="8" maxlength="1000" required></textarea></label><div class="evaluation-review-actions"><button class="primary-button" type="submit" name="decision" value="APPROVE">Aprovar</button><button class="secondary-button" type="submit" name="decision" value="REJECT">Recusar</button></div><p class="evaluation-form-status" role="status" aria-live="polite"></p></form>` : author === uid && type ? '<small>Autoaprovação bloqueada. Outro administrador deve revisar.</small>' : '<small>Aguardando processamento ou revisão de configuração.</small>'}</li>`;
      }).join('')}</ul>` : '<p class="empty-state">Nenhuma solicitação para revisar.</p>'}`);
    } catch (error) { if (evaluationFailureState(error, {online: isModuleOnline()}) === 'blocked') { blockAccess(); return; } if (current()) markup(suggestionsOnly ? '[data-evaluation-suggestion-queue]' : '[data-evaluation-review-queue]', `<p class="empty-state">Falha ao carregar revisões. ${escapeHtml(error.message || '')}</p>`); }
  }
  async function submit(type, payload, form) {
    if (!current()) throw new Error('A sessão ou a página mudou. Entre novamente.');
    if (!isModuleOnline() || connectionUnavailable) throw new Error('Conecte-se para enviar a solicitação. Nenhum ponto foi alterado.');
    const data = await servicePromise;
    if (!current()) throw new Error('A sessão ou a página mudou.');
    const id = form ? (form.dataset.requestId ||= requestId()) : requestId();
    try { return await data.submitEvaluationRequest(type, payload, uid, {requestId: id}); }
    catch (error) {
      const failure = evaluationFailureState(error, {online: isModuleOnline()});
      if (failure === 'blocked') blockAccess();
      if (failure === 'offline') { connectionUnavailable = true; lifecycle?.setOnline(false); throw Object.assign(new Error('Sem conexão. Reconecte-se para enviar; seu rascunho foi preservado.'), {code: 'unavailable'}); }
      throw error;
    }
  }
  function payloadFor(type, form) {
    const values = Object.fromEntries(new FormData(form).entries());
    if (type === 'CORRECT_SCORE') {
      if (!admin()) throw new Error('Somente o administrador autorizado pode corrigir pontos.');
      const award = ownRecords(latest, 'awards', selectedUid, category).find(item => item.id === values.awardId);
      const expectedAwardVersion = Number(form.dataset.expectedAwardVersion);
      if (!award || !Number.isInteger(award.awardVersion) || form.dataset.expectedAwardId !== award.id || form.dataset.expectedSubjectUid !== selectedUid || form.dataset.expectedCategory !== category || !Number.isSafeInteger(expectedAwardVersion)) throw new Error('Selecione e confira novamente o lançamento antes de corrigir.');
      if (award.awardVersion !== expectedAwardVersion) throw new Error('Este lançamento mudou enquanto você editava. Selecione-o novamente e confira o valor atualizado antes de enviar.');
      const correctedPoints = Number(values.correctedPoints);
      if (!Number.isFinite(correctedPoints) || String(values.reason || '').trim().length < 8) throw new Error('Informe o valor e uma justificativa com pelo menos 8 caracteres.');
      if (award.transferId && (award.leg === 'DEBIT' && correctedPoints > 0 || award.leg === 'CREDIT' && correctedPoints < 0)) throw new Error('O débito deve permanecer zero ou negativo; o crédito, zero ou positivo. O ajuste é aplicado ao par.');
      return {awardId: award.id, category, expectedAwardVersion, correctedPoints, reason: values.reason.trim()};
    }
    if (type === 'ASSIGN_MANAGER') {
      if (!admin()) throw new Error('Somente o administrador pode alterar a designação.');
      const expectedVersion = Number(form.dataset.expectedAssignmentVersion);
      if (form.dataset.expectedAreaId !== values.areaId || !Number.isSafeInteger(expectedVersion) || expectedVersion !== Number(assignmentFor(values.areaId)?.version || 0)) throw new Error('A designação mudou. Selecione novamente a área e confira o gestor vigente.');
      return {areaId: values.areaId, managerUid: values.managerUid, expectedVersion};
    }
    if (type === 'CONFIGURE_ACTIVITY') {
      if (!admin()) throw new Error('Somente o administrador pode configurar atividades.');
      const activity = activityFor(values.activityId);
      if (!activity) throw new Error('Selecione um formulário existente.');
      if (form.dataset.configurationComplete !== 'true' || !evaluationConfigurationFields(activity).complete) throw new Error('Atualize os vínculos para carregar a configuração completa antes de editar. Os valores anteriores foram preservados.');
      const expectedVersion = Number(form.dataset.expectedConfigVersion);
      if (form.dataset.expectedActivityId !== activity.id || !Number.isSafeInteger(expectedVersion) || expectedVersion !== Number(activity.configVersion || 0)) throw new Error('A configuração mudou. Selecione novamente o formulário e confira os campos.');
      const eligibleUids = [...new Set(String(values.eligibleUids || '').split(/[\r\n,;]+/).map(value => value.trim()).filter(Boolean))];
      const eligibleGroups = ['eligibleGeneral', 'eligibleRestricted'].filter(name => form.elements[name].checked).map(name => name === 'eligibleGeneral' ? 'GENERAL' : 'RESTRICTED');
      if ((!eligibleUids.length && !eligibleGroups.length) || eligibleUids.length > 100 || eligibleUids.some(value => value.length > 128 || /\s/.test(value))) throw new Error('Selecione ao menos um grupo ou informe UIDs Firebase válidos.');
      const version = Number(values.version);
      if (!Number.isSafeInteger(version) || version < 1) throw new Error('A versão elegível deve ser um número inteiro maior que zero.');
      const materialUrls = [...new Set(String(values.materialUrls || '').split(/[\r\n]+/).map(value => value.trim()).filter(Boolean))];
      if (materialUrls.length > 10 || materialUrls.some(value => !safeUrl(value))) throw new Error('Informe no máximo 10 links HTTPS válidos para os materiais.');
      return {activityId: activity.id, creditScopeId: values.creditScopeId.trim(), version, modalities: {acknowledgement: form.elements.acknowledgement.checked, suggestion: form.elements.suggestion.checked, test: form.elements.test.checked}, acknowledgementItemId: values.acknowledgementItemId.trim(), suggestionProblemItemId: values.suggestionProblemItemId.trim(), suggestionProposalItemId: values.suggestionProposalItemId.trim(), suggestionBenefitItemId: values.suggestionBenefitItemId.trim(), validFrom: values.validFrom, validUntil: values.validUntil, eligibleUids, eligibleGroups, managerAreaId: values.managerAreaId, expectedVersion, acknowledgementValue: values.acknowledgementValue.trim() || 'SIM', materialUrls};
    }
    if (type === 'REQUEST_GOVERNANCE') {
      const assignment = assignmentFor(values.areaId);
      if (!assignment || assignment.uid !== uid || selectedUid !== uid) throw new Error('Selecione uma área em que você é o gestor vigente.');
      const activity = activityFor(values.activityId);
      if (!activity || activity.managerUid !== uid || !(activity.areaIds || []).includes(values.areaId)) throw new Error('A matéria não está atribuída a você nesta área.');
      const components = ['MATERIAL', 'QUESTIONS'].filter(component => form.elements[component].checked);
      if (!components.length) throw new Error('Marque pelo menos um componente alterado.');
      const previousVersion = Number(values.previousVersion), newVersion = Number(values.newVersion);
      if (!Number.isSafeInteger(previousVersion) || previousVersion < 0 || !Number.isSafeInteger(newVersion) || newVersion <= previousVersion) throw new Error('A nova versão deve ser um inteiro maior que a versão anterior.');
      const links = value => [...new Set(String(value || '').split(/[\r\n]+/).map(value => value.trim()).filter(Boolean))];
      const materialEvidence = components.includes('MATERIAL') ? links(values.materialEvidence) : [], questionEvidence = components.includes('QUESTIONS') ? links(values.questionEvidence) : [];
      if ([materialEvidence, questionEvidence].some(items => items.length > 10 || items.some(url => !safeUrl(url)))) throw new Error('Informe no máximo 10 links HTTPS válidos por componente.');
      for (const component of components) if (!(component === 'MATERIAL' ? materialEvidence : questionEvidence).length) throw new Error('Informe o link HTTPS de evidência de cada componente alterado.');
      return {activityId: activity.id, areaId: values.areaId, assignmentId: assignment.id || assignment.areaId, previousVersion, newVersion, summary: values.summary.trim(), components, materialEvidence, questionEvidence};
    }
    throw new Error('Tipo de solicitação inválido.');
  }  function showDialog(name) {
    if (!current() || (['correction', 'administration'].includes(name) && !admin()) || (name === 'suggestions' && !suggestionReviewer())) return;
    const dialog = find(`[data-evaluation-dialog="${name}"]`);
    if (!dialog || dialog.open) return;
    dialog.showModal();
    if (name === 'administration') void refreshReviewQueue();
    if (name === 'suggestions') void refreshReviewQueue({suggestionsOnly: true});
  }
  page.addEventListener('click', async event => {
    const opener = event.target.closest?.('[data-evaluation-open]');
    if (opener) { showDialog(opener.dataset.evaluationOpen); return; }
    if (event.target.closest?.('[data-evaluation-more]') && current()) { if (loadedLimit >= 5000) return; loadedLimit = Math.min(5000, loadedLimit + 200); openScope({retain: true}); return; }
    const closer = event.target.closest?.('[data-evaluation-close]');
    if (closer) { closer.closest('dialog')?.close(); return; }
    const reconcile = event.target.closest?.('[data-evaluation-reconcile]');
    if (reconcile && admin()) {
      reconcile.disabled = true;
      try { await submit('RECONCILE_LINKS', {}); if (current()) setText('.evaluation-admin-status', 'Reconciliação solicitada. Aguarde a configuração validada no servidor.'); }
      catch (error) { if (current()) setText('.evaluation-admin-status', error.message); }
      finally { if (reconcile.isConnected) reconcile.disabled = false; }
    }
  }, {signal: eventController.signal});
  page.addEventListener('input', event => {
    const form = event.target.closest?.('form');
    if (form) { form.dataset.requestId = ''; form.dataset.dirty = 'true'; }
    if (event.target.tagName === 'SELECT') event.target.dataset.dirty = 'true';
  }, {signal: eventController.signal});
  page.addEventListener('change', event => {
    if (event.target.matches?.('[data-evaluation-person]')) {
      if (!admin() || !people.some(person => (person.uid || person.id) === event.target.value)) return;
      for (const dialog of all('dialog[open]')) dialog.close();
      selectedUid = event.target.value; loadedLimit = 200; formFor('CORRECT_SCORE')?.reset();
      for (const element of formFor('CORRECT_SCORE')?.elements || []) if (element.dataset) delete element.dataset.dirty;
      openScope(); return;
    }
    const form = event.target.closest?.('form'); if (!form) return;
    form.dataset.requestId = '';
    if (form.dataset.evaluationForm === 'CORRECT_SCORE' && event.target.name === 'awardId') {
      const award = ownRecords(latest, 'awards', selectedUid, category).find(item => item.id === event.target.value);
      const note = form.querySelector('[data-correction-current]');
      if (note) note.textContent = award ? `Valor atual: ${pointLabel(award.points)} · versão ${award.awardVersion}${award.transferId ? ' · transferência pareada do Checklist' : ''}` : 'Selecione um lançamento.';
      if (award) { form.elements.correctedPoints.value = award.points; form.dataset.expectedAwardVersion = String(award.awardVersion); form.dataset.expectedAwardId = award.id; form.dataset.expectedSubjectUid = selectedUid; form.dataset.expectedCategory = category; }
      else { delete form.dataset.expectedAwardVersion; delete form.dataset.expectedAwardId; }
    }
    if (form.dataset.evaluationForm === 'ASSIGN_MANAGER' && event.target.name === 'areaId') {
      const assignment = assignmentFor(event.target.value), note = form.querySelector('[data-assignment-current]');
      form.dataset.expectedAssignmentVersion = String(assignment?.version || 0); form.dataset.expectedAreaId = event.target.value;
      if (note) note.textContent = assignment ? `Gestor atual: ${nameFor(assignment.uid)} · versão ${assignment.version}` : 'Área sem designação registrada.';
    }
    if (form.dataset.evaluationForm === 'REQUEST_GOVERNANCE' && ['MATERIAL','QUESTIONS'].includes(event.target.name)) {
      form.elements[event.target.name === 'MATERIAL' ? 'materialEvidence' : 'questionEvidence'].disabled = !event.target.checked;
    }
    if (form.dataset.evaluationForm === 'CONFIGURE_ACTIVITY' && event.target.name === 'activityId') {
      const activity = activityFor(event.target.value); if (!activity) return;
      form.dataset.expectedConfigVersion = String(activity.configVersion || 0); form.dataset.expectedActivityId = activity.id;
      const fields = evaluationConfigurationFields(activity);
      form.dataset.configurationComplete = String(fields.complete);
      const status = form.querySelector('.evaluation-form-status');
      if (status) status.textContent = fields.complete ? '' : 'Configuração incompleta na projeção: atualize os vínculos antes de editar. Nenhum valor anterior será substituído por padrões.';
      if (!fields.complete) return;
      for (const [key, value] of Object.entries(fields.values)) if (key !== 'eligibleGroups') form.elements[key].value = value;
      form.elements.eligibleGeneral.checked = fields.values.eligibleGroups.includes('GENERAL');
      form.elements.eligibleRestricted.checked = fields.values.eligibleGroups.includes('RESTRICTED');
      for (const modality of ['acknowledgement', 'suggestion', 'test']) form.elements[modality].checked = activity.modalities?.[modality] === true;
    }
  }, {signal: eventController.signal});
  page.addEventListener('submit', async event => {
    const form = event.target, type = form.dataset.evaluationForm || form.dataset.reviewType;
    if (!type) return;
    event.preventDefault();
    if (!current() || form.dataset.submitting === 'true' || !form.reportValidity()) return;
    const status = form.querySelector('.evaluation-form-status'), buttons = [...form.querySelectorAll('button[type="submit"]')];
    form.dataset.submitting = 'true'; buttons.forEach(button => { button.disabled = true; });
    if (status) status.textContent = 'Enviando solicitação…';
    try {
      let payload;
      if (form.dataset.evaluationReview) {
        if (!(type === 'REVIEW_SUGGESTION' ? suggestionReviewer() : admin())) throw new Error('Somente o revisor autorizado pode aprovar esta solicitação.');
        const item = reviewQueue.find(record => record.id === form.dataset.evaluationReview);
        if (!item || (item.uid || item.actorUid) === uid) throw new Error('Autoaprovação bloqueada.');
        const decision = event.submitter?.value;
        if (!['APPROVE', 'REJECT'].includes(decision)) throw new Error('Selecione aprovar ou recusar.');
        payload = {[type === 'REVIEW_SUGGESTION' ? 'participationId' : 'revisionId']: item.id, decision, note: form.elements.note.value.trim()};
      } else payload = payloadFor(type, form);
      await submit(type, payload, form);
      if (!current() || !form.isConnected) return;
      if (status) status.textContent = 'Solicitação registrada como pendente. O saldo muda somente após validação confiável.';
      form.dataset.requestId = '';
    } catch (error) { if (evaluationFailureState(error, {online: isModuleOnline()}) === 'blocked') blockAccess(); else if (current() && status?.isConnected) status.textContent = error.message || 'Não foi possível enviar a solicitação.'; }
    finally { form.dataset.submitting = ''; if (form.isConnected) buttons.forEach(button => { button.disabled = false; }); }
  }, {signal: eventController.signal});
  openScope(); void refreshMetadata();
  const cleanup = () => {
    if (disposed) return;
    disposed = true; mountVersion++; lifecycle?.dispose(); eventController.abort();
    for (const dialog of all('dialog')) if (dialog.open) dialog.close();
    latest = null; assignments = []; activities = []; people = []; reviewQueue = [];
  };
  cleanup.suspend = () => lifecycle?.suspend();
  cleanup.resume = () => { if (current()) { if (isModuleOnline()) connectionUnavailable = false; lifecycle?.resume(); void refreshMetadata(); } };
  cleanup.setOnline = value => { if (!current()) return; onlineOverride = Boolean(value); if (value) connectionUnavailable = false; if (!value) { page.dataset.evaluationState = 'offline'; setText('[data-evaluation-total]', '—'); setText('[data-evaluation-percentage]', 'Aguardando atualização'); } lifecycle?.setOnline(value); if (value) void refreshMetadata(); };
  cleanup.revalidate = () => { if (!current()) cleanup(); };
  cleanup.updateProfile = nextProfile => { if (!current()) return; profile = nextProfile || profile; setText('.evaluation-subject', nameFor(selectedUid)); };
  cleanup.canPreserveSession = (previous, next) => !blocked && evaluationSessionCanPreserve(previous, next);
  return cleanup;
}

export function mountManagementEvaluationAccess(host, options) {
  let activeCleanup = null, disposed = false, accessBlocked = false;
  const controller = new AbortController();
  host.innerHTML = '<button class="primary-button evaluation-management-launch" type="button">Avaliação dos Gestores</button><dialog class="evaluation-dialog evaluation-governance-dialog"><header><h3>AVALIAÇÃO DOS GESTORES</h3><button class="secondary-button" type="button" data-governance-close>VOLTAR</button></header><div class="evaluation-dialog-body" data-governance-content></div></dialog>';
  const dialog = host.querySelector('dialog'), body = host.querySelector('[data-governance-content]');
  const current = () => !disposed && !accessBlocked && host.isConnected && options.isCurrent();
  host.querySelector('.evaluation-management-launch').addEventListener('click', () => {
    if (!current()) return;
    if (!activeCleanup) activeCleanup = mountPerformanceModule(body, {...options, category: 'GOVERNANCE', isCurrent: current, onBlocked: () => { accessBlocked = true; const launch = host.querySelector('.evaluation-management-launch'); launch.disabled = true; launch.textContent = 'Avaliação bloqueada'; if (dialog.open) dialog.close(); }});
    dialog.showModal();
  }, {signal: controller.signal});
  host.querySelector('[data-governance-close]').addEventListener('click', () => dialog.close(), {signal: controller.signal});
  dialog.addEventListener('close', () => { activeCleanup?.(); activeCleanup = null; body.innerHTML = ''; }, {signal: controller.signal});
  const cleanup = () => { if (disposed) return; disposed = true; controller.abort(); activeCleanup?.(); activeCleanup = null; if (dialog.open) dialog.close(); body.innerHTML = ''; };
  cleanup.suspend = () => activeCleanup?.suspend(); cleanup.resume = () => activeCleanup?.resume(); cleanup.setOnline = value => activeCleanup?.setOnline(value);
  cleanup.revalidate = () => { if (!current()) cleanup(); else activeCleanup?.revalidate(); };
  cleanup.updateProfile = nextProfile => { options.profile = nextProfile || options.profile; activeCleanup?.updateProfile?.(options.profile); };
  cleanup.canPreserveSession = (previous, next) => !accessBlocked && evaluationSessionCanPreserve(previous, next);
  return cleanup;
}
