const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const number = value => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', {maximumFractionDigits:2}).format(value) : '—';
const time = value => {
  if (!value) return 'Data indisponível';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', {dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(date) : 'Data indisponível';
};
export const SAHMT_PERFORMANCE_CATEGORIES = Object.freeze([
  {id:'OPERATIONS',label:'ATIVIDADES OPERACIONAIS',source:'Checklist e escala · FG / FI'},
  {id:'MANAGEMENT',label:'TREINAMENTOS E GESTÃO',source:'Atividades de gestão · FB'},
  {id:'RECORDS',label:'ATIVIDADES DE REGISTROS',source:'Registros confirmados · FC'},
  {id:'SURVEYS',label:'ATIVIDADES EM ENQUETES',source:'Enquetes e consultas · FE'},
  {id:'NOTIFICATIONS',label:'NOTIFICAÇÕES',source:'Lançamentos administrativos'},
  {id:'CONTINUING_EDUCATION',label:'EDUCAÇÃO CONTINUADA',source:'Lançamentos administrativos'},
]);
const notificationKinds = [['ADVERSE_EVENT','Evento adverso'],['MEETING','Participação em reunião'],['INFRACTION','Infração'],['PRAISE','Elogio']];
const ready = snapshot => snapshot?.status === 'READY' && typeof snapshot.batchId === 'string' && snapshot.batchId.length > 0 && Number.isFinite(snapshot.summary?.total);
const validPoints = text => String(text).trim() !== '' && Number.isFinite(Number(text)) && Math.abs(Number(text)) <= 1e6 && Math.abs(Number(text) * 100 - Math.round(Number(text) * 100)) < 1e-7;
const options = (items, selected) => items.map(([value,label]) => `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('');

function manualMarkup(state) {
  if (!state.manualOpen) return '<button type="button" class="sp-secondary" data-sp-manual>Adicionar lançamento manual</button>';
  const draft = state.draft || {}, disabled = state.saving || state.correcting ? ' disabled' : '';
  const people = state.people || [];
  return `<section class="sp-admin" aria-label="Lançamento administrativo"><h3>Lançamento manual</h3><p>O valor será incluído na próxima apuração diária. Use valores negativos para débitos.</p>${state.peopleLoading ? '<p role="status">Carregando pessoas autorizadas…</p>' : ''}${state.peopleError ? '<p role="alert">Não foi possível carregar as pessoas autorizadas.</p><button type="button" data-sp-people-retry>Tentar novamente</button>' : ''}<form data-sp-manual-form><fieldset${disabled}><legend class="sp-visually-hidden">Dados do lançamento</legend><label>Pessoa<select name="uid" required${people.length ? '' : ' disabled'}><option value="">Selecione uma pessoa</option>${options(people.map(person => [person.uid,person.displayName || person.uid]),draft.uid)}</select></label><label>Categoria<select name="category" required data-sp-manual-category>${options([['NOTIFICATIONS','Notificações'],['CONTINUING_EDUCATION','Educação continuada']],draft.category || 'NOTIFICATIONS')}</select></label><label${draft.category === 'CONTINUING_EDUCATION' ? ' hidden' : ''} data-sp-kind-label>Tipo de ocorrência<select name="kind">${options(notificationKinds,draft.kind || 'ADVERSE_EVENT')}</select></label><label>Pontos<input name="points" type="number" step="0.01" min="-1000000" max="1000000" required inputmode="decimal" value="${escape(draft.points || '')}"></label><label class="sp-form-wide">Justificativa<textarea name="reason" required minlength="8" maxlength="1000" rows="3">${escape(draft.reason || '')}</textarea></label><div class="sp-form-wide"><button type="submit"${people.length ? '' : ' disabled'}>${state.saving ? 'Salvando…' : 'Registrar para próxima apuração'}</button></div></fieldset></form></section>`;
}

function manualAuditMarkup(state) {
  if (!state.manualOpen) return '';
  const selected = state.correction;
  return `<section class="sp-admin sp-manual-audit" data-sp-manual-audit aria-label="Histórico administrativo"><h3>Histórico dos lançamentos manuais</h3><p>Selecione a pessoa no formulário acima para consultar ou corrigir seus lançamentos. Correções preservam o registro original e aguardam a próxima apuração.</p><button type="button" data-sp-manual-history${state.manualLoading ? ' disabled' : ''}>${state.manualLoading ? 'Consultando…' : 'Consultar lançamentos manuais'}</button>${state.manualError ? `<p role="alert">${escape(state.manualError)}</p>` : ''}${state.manualRows ? `<ol class="sp-history-list">${state.manualRows.map(row => `<li><div><strong>${escape(row.category === 'CONTINUING_EDUCATION' ? 'Educação continuada' : 'Notificações')} · ${escape(number(row.points))} pontos${row.correctsId ? ' · Correção' : ''}</strong><p>${escape(row.reason)}</p><small>${escape(time(row.createdAt))} · Responsável: ${escape(row.actorUid)}</small>${!row.correctsId && Number.isFinite(row.currentPoints) && Number.isInteger(row.currentVersion) ? `<small>Valor atual: ${escape(number(row.currentPoints))} · versão ${row.currentVersion}</small><button type="button" data-sp-correct="${escape(row.id)}">Corrigir lançamento</button>` : ''}</div></li>`).join('') || '<li>Nenhum lançamento manual disponível para esta pessoa.</li>'}</ol>` : ''}${selected ? `<form data-sp-correction-form><fieldset${state.correcting ? ' disabled' : ''}><legend>Corrigir lançamento</legend><label>Valor corrigido em pontos<input name="points" type="number" step="0.01" min="-1000000" max="1000000" required value="${escape(selected.points)}"></label><label class="sp-form-wide">Justificativa da correção<textarea name="reason" required minlength="8" maxlength="1000" rows="3">${escape(selected.reason)}</textarea></label><div class="sp-form-wide"><button type="submit">${state.correcting ? 'Confirmando…' : 'Registrar correção para próxima apuração'}</button></div></fieldset></form>` : ''}</section>`;
}

export function sahmtPerformanceMarkup(snapshot, state = {}) {
  const schedule = '<p class="sp-schedule">Apuração diária às <strong>02h00 de Brasília</strong>.</p>';
  const status = `<p class="sp-message" data-sp-message role="status" aria-live="polite">${escape(state.message || '')}</p>`;
  const admin = snapshot?.canManage === true ? manualMarkup(state) + manualAuditMarkup(state) : '';
  if(snapshot?.status==='SCHEDULED')return `<section class="sahmt-performance" aria-label="Desempenho individual"><div class="sp-empty"><p role="status">A pontuação começa em <strong>${escape(time(snapshot.effectiveFrom))}</strong>, no horário de Brasília.</p>${schedule}</div></section>`;
  if (!ready(snapshot)) return `<section class="sahmt-performance" aria-label="Desempenho individual"><div class="sp-empty"><p role="status">${state.loadError ? 'Não foi possível consultar a apuração. Tente novamente.' : snapshot ? (snapshot.incomplete ? 'A apuração diária não foi concluída porque uma das fontes não pôde ser confirmada. Nenhum saldo parcial foi publicado.' : 'O desempenho consolidado está em preparação. Nenhuma apuração completa está disponível.') : 'Carregando seu desempenho…'}</p>${schedule}${snapshot || state.loadError ? '<button type="button" data-sp-retry>Consultar novamente</button>' : ''}</div>${admin}${status}</section>`;
  const percentage = snapshot.summary.percentage;
  const summary = `<div class="sp-summary"><article class="sp-total"><span>Pontuação total</span><strong data-sp-total>${escape(number(snapshot.summary.total))}</strong><small>Saldo confirmado das seis categorias</small></article><article class="sp-relative"><span>Percentual relativo</span><strong>${Number.isFinite(percentage) ? `${escape(number(percentage))}%` : 'Indisponível'}</strong><small>${Number.isFinite(percentage) ? 'Seu total em relação ao maior total elegível' : 'Sem referência positiva para comparação'}</small></article></div><div class="sp-batch"><p>Última apuração concluída: <strong>${escape(time(snapshot.updatedAt))}</strong></p><p>Corte dos lançamentos: ${escape(time(snapshot.cutoff))}</p>${schedule}${snapshot.stale ? '<p class="sp-warning" role="status">A última apuração está desatualizada. Os valores abaixo pertencem ao último lote completo.</p>' : ''}</div>`;
  const category = SAHMT_PERFORMANCE_CATEGORIES.find(item => item.id === state.category);
  const trainingLink = state.canOpenTraining && category?.id === 'MANAGEMENT'
    ? '<button type="button" class="sp-secondary" data-sp-open-training>Abrir atividades de treinamento</button>'
    : '';
  let content;
  if (category) {
    const history = state.history || {}, rows = history.rows || [];
    content = `<section class="sp-history" aria-label="Histórico da categoria"><button type="button" class="sp-back" data-sp-back>← Voltar às categorias</button><div class="sp-history-title"><h3 tabindex="-1" data-sp-history-title>${category.label}</h3><strong>${escape(number(snapshot.summary.byCategory?.[category.id]))} pontos</strong></div><p>${category.source}</p><p>Somente lançamentos confirmados nesta apuração.</p>${trainingLink}${rows.length ? `<ol class="sp-history-list">${rows.map(row => `<li><div><strong>${escape(row.label || 'Lançamento confirmado')}</strong><small>${escape(time(row.createdAt))} · ${escape(row.source || '')}</small></div><span class="${row.points < 0 ? 'sp-debit' : 'sp-credit'}">${escape(number(row.points))}</span></li>`).join('')}</ol>` : !state.historyLoading && !state.historyError ? '<p class="sp-empty">Nenhum lançamento confirmado nesta categoria.</p>' : ''}${state.historyLoading ? '<p role="status">Carregando lançamentos…</p>' : ''}${state.historyError ? `<p role="alert">${escape(state.historyError)}</p><button type="button" data-sp-history-retry>Tentar novamente</button>` : ''}${history.nextCursor && !state.historyError ? `<button type="button" class="sp-secondary" data-sp-more${state.historyLoading ? ' disabled' : ''}>Carregar mais</button>` : ''}</section>`;
  } else {
    content = `<div class="sp-categories" aria-label="Categorias de desempenho">${SAHMT_PERFORMANCE_CATEGORIES.map(item => `<button type="button" class="sp-category" data-sp-category="${item.id}"><span class="sp-category-copy"><strong>${item.label}</strong><small>${item.source}</small></span><span class="sp-category-score">${escape(number(snapshot.summary.byCategory?.[item.id]))}<small>pontos</small></span><span aria-hidden="true">›</span></button>`).join('')}</div>${admin}`;
  }
  return `<section class="sahmt-performance" aria-label="Desempenho individual">${summary}<button type="button" class="sp-refresh" data-sp-refresh>Consultar apuração novamente</button>${state.loadError ? '<p class="sp-warning" role="alert">Não foi possível atualizar. Os valores da última apuração consultada foram preservados.</p>' : ''}${snapshot.incomplete ? '<p class="sp-warning" role="status">A apuração mais recente não foi concluída. Este painel mantém o último resultado completo.</p>' : ''}${content}${Object.keys(snapshot.periodsBySource || {}).length ? `<details class="sp-periods"><summary>Períodos considerados</summary><p>Os saldos são acumulados desde a ativação de cada origem, até o corte desta apuração.</p><ul>${Object.entries(snapshot.periodsBySource).map(([source, period]) => `<li>${escape(source)}: desde ${escape(time(period.effectiveFrom))}</li>`).join('')}</ul></details>` : ''}${status}</section>`;
}

function formValues(form) {
  return Object.fromEntries(['uid','category','kind','points','reason'].map(key => [key,String(form.elements[key]?.value ?? '')]));
}

export function mountSahmtPerformance(root, {request, isCurrent = () => true, onOpenTraining} = {}) {
  let disposed = false, snapshot = null, historyVersion = 0, loadVersion = 0, pending = null, correctionPending = null, manualVersion = 0;
  const state = {draft:{},people:[],manualOpen:false,canOpenTraining:typeof onOpenTraining === 'function'};
  const current = () => !disposed && isCurrent();
  const render = () => { if (current()) root.innerHTML = sahmtPerformanceMarkup(snapshot,state); };
  const load = async () => {
    if (!current()) return;
    const version = ++loadVersion;
    historyVersion++;state.category = null;state.history = null;state.historyLoading = false;
    state.loadError = false;render();
    try { const value = await request('GET_SAHMT_PERFORMANCE',{});if (!current() || version !== loadVersion) return;snapshot = value;state.message = ''; }
    catch { if (!current() || version !== loadVersion) return;state.loadError = true; }
    render();
  };
  const loadHistory = async (append = false) => {
    if (!current() || !ready(snapshot) || state.historyLoading) return;
    const category = state.category, batchId = snapshot.batchId, version = ++historyVersion;
    const cursor = append ? state.history?.nextCursor : null;
    if (!append) state.history = {rows:[],nextCursor:null};
    state.historyLoading = true;state.historyError = '';render();
    try {
      const value = await request('LIST_SAHMT_HISTORY',{category,batchId,...(cursor ? {cursor} : {})});
      if (!current() || version !== historyVersion || category !== state.category) return;
      if (value.batchId !== batchId) {
        state.history = {rows:[],nextCursor:null};state.historyError = 'A apuração mudou. Volte às categorias e consulte a apuração novamente.';
      } else if (!Array.isArray(value.rows)) state.historyError = 'O histórico está indisponível. Tente novamente.';
      else {
        const existing = append ? state.history.rows : [], ids = new Set(existing.map(row => row.id));
        state.history = {rows:[...existing,...value.rows.filter(row => !ids.has(row.id))],nextCursor:typeof value.nextCursor === 'string' && value.nextCursor ? value.nextCursor : null};
      }
    } catch { if (!current() || version !== historyVersion) return;state.historyError = 'Não foi possível consultar os lançamentos. Tente novamente.'; }
    if (!current() || version !== historyVersion) return;
    state.historyLoading = false;render();root.querySelector('[data-sp-history-title]')?.focus?.();
  };
  const loadPeople = async () => {
    if (!current() || state.peopleLoading || snapshot?.canManage !== true) return;
    state.peopleLoading = true;state.peopleError = false;render();
    try { const value = await request('LIST_SAHMT_PEOPLE',{});if (!current()) return;if (!Array.isArray(value.people)) throw Error('UNAVAILABLE');state.people = value.people.filter(person => typeof person.uid === 'string' && person.uid); }
    catch { if (!current()) return;state.peopleError = true; }
    if (!current()) return;state.peopleLoading = false;render();
  };
  const loadManual = async () => {
    if (!current() || snapshot?.canManage !== true || state.manualLoading || state.correcting || state.saving) return;
    const uid = state.draft.uid;
    if (!state.people.some(person => person.uid === uid)) { state.message = 'Selecione uma pessoa autorizada para consultar os lançamentos.';render();return; }
    const version = ++manualVersion;state.manualLoading = true;state.manualError = '';state.correction = null;render();
    try { const value = await request('LIST_SAHMT_MANUAL',{uid});if (!current() || version !== manualVersion || uid !== state.draft.uid) return;if (!Array.isArray(value.rows)) throw Error('UNAVAILABLE');state.manualRows = value.rows; }
    catch { if (!current() || version !== manualVersion) return;state.manualError = 'Não foi possível consultar o histórico administrativo. Tente novamente.'; }
    if (!current() || version !== manualVersion) return;state.manualLoading = false;render();
  };
  const click = event => {
    if (!current()) return;
    const button = event.target.closest('[data-sp-category],[data-sp-back],[data-sp-more],[data-sp-retry],[data-sp-refresh],[data-sp-history-retry],[data-sp-manual],[data-sp-people-retry],[data-sp-manual-history],[data-sp-correct],[data-sp-open-training]');
    if (!button) return;
    const data = button.dataset;
    if ('spCategory' in data && SAHMT_PERFORMANCE_CATEGORIES.some(item => item.id === data.spCategory)) {
      state.category = data.spCategory;state.historyLoading = false;void loadHistory();
    } else if ('spBack' in data) { historyVersion++;state.category = null;state.history = null;state.historyLoading = false;render(); }
    else if ('spMore' in data) void loadHistory(true);
    else if ('spHistoryRetry' in data) void loadHistory(false);
    else if ('spRetry' in data || 'spRefresh' in data) void load();
    else if ('spManual' in data && snapshot?.canManage === true) { state.manualOpen = true;void loadPeople(); }
    else if ('spPeopleRetry' in data) void loadPeople();
    else if ('spManualHistory' in data) void loadManual();
    else if ('spOpenTraining' in data && state.category === 'MANAGEMENT') onOpenTraining?.();
    else if ('spCorrect' in data && snapshot?.canManage === true && !state.correcting) {
      const row = state.manualRows?.find(item => item.id === data.spCorrect && !item.correctsId && Number.isFinite(item.currentPoints) && Number.isInteger(item.currentVersion));
      if (row) { state.correction = {entryId:row.id,expectedVersion:row.currentVersion,points:String(row.currentPoints),reason:''};render(); }
    }
  };
  const input = event => {
    if (!current()) return;
    const form = event.target.closest('[data-sp-manual-form],[data-sp-correction-form]');
    if (!form) return;
    if (form.dataset?.spCorrectionForm !== undefined) { if (state.correction) Object.assign(state.correction,{points:String(form.elements.points?.value ?? ''),reason:String(form.elements.reason?.value ?? '')});return; }
    const previousUid = state.draft.uid;
    state.draft = formValues(form);
    if (previousUid !== state.draft.uid) { manualVersion++;state.manualRows = null;state.correction = null;state.manualLoading = false;root.querySelector('[data-sp-manual-audit] .sp-history-list')?.remove?.();root.querySelector('[data-sp-correction-form]')?.remove?.(); }
    if (event.target.name === 'category') {
      const kindLabel = root.querySelector('[data-sp-kind-label]');
      if (kindLabel) kindLabel.hidden = state.draft.category === 'CONTINUING_EDUCATION';
    }
  };
  const submit = async event => {
    const form = event.target.closest('[data-sp-manual-form],[data-sp-correction-form]');
    if (!form) return;
    event.preventDefault();
    if (!current() || state.saving || state.correcting || snapshot?.canManage !== true) return;
    if (form.dataset?.spCorrectionForm !== undefined) {
      if (!state.correction || state.correcting) return;
      const pointsText = String(form.elements.points?.value ?? ''), reason = String(form.elements.reason?.value ?? '').trim();
      Object.assign(state.correction,{points:pointsText,reason});
      if (!validPoints(pointsText) || reason.length < 8 || reason.length > 1000) { state.message = 'Informe pontos com até duas casas decimais e justificativa de 8 a 1.000 caracteres.';render();return; }
      const payload = {entryId:state.correction.entryId,expectedVersion:state.correction.expectedVersion,points:Number(pointsText),reason}, signature = JSON.stringify(payload);
      try {
        if (!correctionPending || correctionPending.signature !== signature) correctionPending = {signature,requestId:globalThis.crypto.randomUUID()};
        state.correcting = true;state.message = 'Confirmando a correção no servidor…';render();
        await request('CORRECT_SAHMT_MANUAL',{requestId:correctionPending.requestId,...payload});
        if (!current()) return;correctionPending = null;state.correction = null;state.message = 'Correção registrada. O valor corrigido será incluído na próxima apuração diária.';
        state.correcting = false;void loadManual();
      } catch { if (!current()) return;state.message = 'Não foi possível confirmar a correção. Os dados foram preservados; tente novamente sem duplicar. Se houve outra correção, consulte novamente o histórico.'; }
      if (!current()) return;state.correcting = false;render();return;
    }
    const draft = formValues(form);state.draft = draft;
    const points = Number(draft.points),reason = draft.reason.trim(),education = draft.category === 'CONTINUING_EDUCATION';
    if (!state.people.some(person => person.uid === draft.uid) || !['NOTIFICATIONS','CONTINUING_EDUCATION'].includes(draft.category) || (!education && !notificationKinds.some(([kind]) => kind === draft.kind)) || !validPoints(draft.points) || reason.length < 8 || reason.length > 1000) {
      state.message = 'Revise a pessoa, a categoria, os pontos (até duas casas decimais) e a justificativa (8 a 1.000 caracteres).';render();return;
    }
    const payload = {uid:draft.uid,category:draft.category,kind:education ? 'CONTINUING_EDUCATION' : draft.kind,points,reason};
    const signature = JSON.stringify(payload);
    try {
      if (!pending || pending.signature !== signature) pending = {signature,requestId:globalThis.crypto.randomUUID()};
      state.saving = true;state.message = 'Confirmando o lançamento no servidor…';render();
      await request('ADD_SAHMT_MANUAL',{requestId:pending.requestId,...payload});
      if (!current()) return;
      pending = null;state.draft = {...draft,points:'',reason:''};state.message = 'Lançamento registrado. Aguardando a próxima apuração diária às 02h00 de Brasília.';
    } catch { if (!current()) return;state.message = 'Não foi possível confirmar o lançamento. Seus dados foram preservados; tente novamente para confirmar sem duplicar.'; }
    if (!current()) return;state.saving = false;render();
  };
  root.addEventListener('click',click);root.addEventListener('input',input);root.addEventListener('change',input);root.addEventListener('submit',submit);
  void load();
  return () => {
    disposed = true;historyVersion++;manualVersion++;snapshot = null;pending = null;correctionPending = null;state.people = [];state.draft = {};state.manualRows = null;state.correction = null;
    root.removeEventListener('click',click);root.removeEventListener('input',input);root.removeEventListener('change',input);root.removeEventListener('submit',submit);root.replaceChildren();
  };
}
