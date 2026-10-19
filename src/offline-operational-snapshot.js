const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const REPORT_MODULES = new Set(['events', 'labels']);

function isDayKey(value) {
  if (!DAY_KEY.test(value || '')) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function offlineOperationalCacheId(kind, day, access = {}) {
  if (!REPORT_MODULES.has(kind) || !isDayKey(day)) return '';
  const sigla = String(access.sigla || '').trim().toUpperCase();
  const broad = kind === 'events' ? access.isAdmin === true : access.canManage === true;
  return `${kind}:${day}:${broad ? 'broad' : 'scoped'}:${sigla || 'none'}`;
}

export async function writeOfflineOperationalSnapshot({uid, kind, day, access = {}, records, confirmed = false, writeSafeCache} = {}) {
  const id = offlineOperationalCacheId(kind, day, access);
  if (!uid || !id || !confirmed || !Array.isArray(records) || records.some(record => record.pendingFirestore || record.pendingSync || record.syncFailed || record.syncConflict || record.hasPendingWrites) || typeof writeSafeCache !== 'function') return false;
  await writeSafeCache(uid, 'offlineOperational', id, {records: records.map(({stale, ...record}) => record)});
  return true;
}

function html(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
}

function recordList(records, describe, emptyMessage = 'Nenhum registro deste dia está disponível na cópia deste aparelho. Conecte-se e abra o relatório para prepará-la.') {
  if (!records?.length) return `<p class="empty-state">${html(emptyMessage)}</p>`;
  return `<ul class="record-list">${records.map(record => `<li>${describe(record)}</li>`).join('')}</ul>`;
}

function cacheStamp(snapshot) {
  return snapshot?.cachedAt ? `<small class="record-meta">Cópia salva em ${html(new Date(snapshot.cachedAt).toLocaleString('pt-BR'))}</small>` : '';
}

export function mountOfflineOperationalDashboard(host, markup) {
  if (!host || typeof host.insertAdjacentHTML !== 'function' || typeof markup !== 'string' || !markup.trim()) return false;
  host.querySelector?.('.offline-operational-dashboard')?.remove();
  host.insertAdjacentHTML('beforeend', markup);
  return true;
}

export function offlineOperationalDashboardMarkup({day, route = 'home', snapshots = {}, permissions = {}, stations = [], eventCatalog = {}, eventSchedule = null, labelStaffSiglas = []} = {}) {
  const sections = [];
  if (route === 'home' && permissions.schedule) {
    const schedule = snapshots.schedule?.schedule;
    const positions = schedule ? (schedule.assignments || schedule.siglas || schedule.positions || []).map((item, index) => {
      const value = typeof item === 'string' ? {sigla: item} : item || {};
      return `<li class="sigla-card"><strong>${index + 1}. ${html(value.sigla || value.name || value.label || 'Posição')}</strong>${value.name && value.name !== value.sigla ? `<small>${html(value.name)}</small>` : ''}</li>`;
    }).join('') : '';
    sections.push(`<section class="offline-operational-section panel"><h3>Escala do dia</h3>${cacheStamp(snapshots.schedule)}${schedule ? `<ol class="siglas-grid">${positions}</ol>` : '<p class="empty-state">A escala de hoje ainda não foi salva neste aparelho.</p>'}</section>`);
  }
  if (route === 'checklist' && permissions.checklist) {
    const records = snapshots.checklist?.records || [];
    const latestByStation = new Map();
    for (const record of records) if (record.stationId && !latestByStation.has(record.stationId)) latestByStation.set(record.stationId, record);
    const activeStations = stations.filter(station => station.active === true);
    const checklistRows = snapshots.checklist ? activeStations.map(station => {
      const record = latestByStation.get(station.id);
      return `<li><strong>${html(station.name || station.id)}</strong> · ${record ? html(record.condition || record.status || 'Registrado') : 'Sem checagem no snapshot salvo'}${record?.occurrence ? `<small>${html(record.occurrence)}</small>` : ''}</li>`;
    }) : [];
    const knownStations = new Set(activeStations.map(station => station.id));
    for (const record of records) if (record.stationId && !knownStations.has(record.stationId)) checklistRows.push(`<li><strong>${html(record.stationName || record.stationId)}</strong> · ${html(record.condition || record.status || 'Registrado')}${record.occurrence ? `<small>${html(record.occurrence)}</small>` : ''}</li>`);
    const checklistForms = permissions.checklistWrite ? activeStations.map(station => `<form class="quick-form offline-write-form" data-offline-write-form="checklists" data-station-id="${html(station.id)}"><h4>${html(station.name || station.id)}</h4><label>Condição<select name="condition" required><option value="">Selecione</option><option value="SIM">Conforme</option><option value="NAO">Não conforme</option></select></label><label>Ocorrência (obrigatória se não conforme)<textarea name="occurrence" rows="2" maxlength="1000"></textarea></label><button class="primary-button" type="submit">Salvar Checklist offline</button><p class="record-meta" data-offline-write-status role="status" aria-live="polite"></p></form>`).join('') : '';
    sections.push(`<section class="offline-operational-section panel"><h3>Checklist</h3>${cacheStamp(snapshots.checklist)}${checklistRows.length ? `<ul class="record-list">${checklistRows.join('')}</ul>` : !snapshots.checklist && activeStations.length ? `<p class="empty-state">O catálogo está salvo, mas o resultado diário do checklist não foi armazenado neste aparelho.</p>` : recordList(records, item => `<strong>${html(item.stationName || item.stationId || 'Arsenal')}</strong> · ${html(item.condition || item.status || 'Sem registro salvo')}${item.occurrence ? `<small>${html(item.occurrence)}</small>` : ''}`, snapshots.checklist ? 'Nenhum registro de checklist para esta data.' : undefined)}${checklistForms}</section>`);
  }
  if (route === 'events' && permissions.events) {
    const records = snapshots.events?.records || [];
    const scheduleRows = (eventSchedule?.assignments || eventSchedule?.siglas || eventSchedule?.positions || []).flatMap((item) => {
      const value = typeof item === 'string' ? {sigla: item} : item || {};
      return (Array.isArray(value.siglas) && value.siglas.length ? value.siglas : [value.sigla]).filter(Boolean).map(sigla => ({sigla: String(sigla).trim().toUpperCase(), name: value.name || sigla}));
    });
    const members = [...new Map(scheduleRows.map(item => [item.sigla, item])).values()];
    const eventForm = permissions.eventsWrite ? `<form class="quick-form offline-write-form" data-offline-write-form="events"><h4>Registrar Evento neste aparelho</h4><p class="record-meta">O lançamento ficará local até você revisar e confirmar o envio.</p><label>Data<input name="eventDate" type="date" value="${html(day)}" required></label><label>Escalado<select name="memberSigla" required ${members.length ? '' : 'disabled'}><option value="">Selecione pela escala salva</option>${members.map(item => `<option value="${html(item.sigla)}">${html(item.name)} · ${html(item.sigla)}</option>`).join('')}</select></label><label>Tipo<select name="eventType" required><option value="">Selecione</option>${['Pessoal','Férias','ATRASO','Suporte','Gestão','Congresso','Saúde','Ausência','Outros'].map(value => `<option>${html(value)}</option>`).join('')}</select></label><label>Descrição<textarea name="description" rows="2" maxlength="1000"></textarea></label><label>Múltiplo do atraso<select name="delayMultiple"><option value="">Selecione</option>${Array.from({length: 7}, (_, index) => `<option value="${index}">${index}</option>`).join('')}</select></label><label>Turno<select name="shift"><option value="">Selecione</option><option>Manhã</option><option>Tarde</option><option>Integral</option></select></label><label>Substituto<input name="substitute" maxlength="120"></label><label>Pagador<select name="payer" required><option value="">Selecione</option>${(eventCatalog.payers || []).map(value => `<option>${html(value)}</option>`).join('')}</select></label><label>Credor<select name="creditor" required><option value="">Selecione</option>${(eventCatalog.creditors || []).map(value => `<option>${html(value)}</option>`).join('')}</select></label><label>Valor a pagar<input name="amountToPay" type="number" min="0" step="0.01" value="0" required></label><button class="primary-button" type="submit" ${members.length && eventCatalog.payers?.length && eventCatalog.creditors?.length ? '' : 'disabled'}>Salvar Evento offline</button><p class="record-meta" data-offline-write-status role="status" aria-live="polite"></p></form>` : '';
    sections.push(`<section class="offline-operational-section panel"><h3>Eventos</h3>${cacheStamp(snapshots.events)}${recordList(records, item => `<strong>${html(item.memberStatus || item.memberName || item.eventType || 'Evento')}</strong>${item.eventType ? ` · ${html(item.eventType)}` : ''}${item.description ? `<small>${html(item.description)}</small>` : ''}`, snapshots.events ? 'Nenhum evento registrado para esta data.' : undefined)}${eventForm}</section>`);
  }
  if (route === 'labels' && permissions.labels) {
    const records = snapshots.labels?.records || [];
    const labelForm = permissions.labelsWrite ? `<form class="quick-form offline-write-form" data-offline-write-form="labels"><h4>Registrar Etiqueta neste aparelho</h4><p class="record-meta">Os dados ficarão neste aparelho até a revisão e confirmação do envio.</p><label>Data<input name="date" type="date" value="${html(day)}" required></label><label>Nome do paciente<input name="patientName" maxlength="160" required></label><label>Convênio<input name="insurance" maxlength="120"></label><label>Atendimento<input name="encounterCode" maxlength="80" required></label><label>Cirurgia<input name="procedureCode" maxlength="80"></label><label>Tipo<select name="type" required><option value="">Selecione</option><option>Particular</option><option>Complementação</option><option>Convênio</option><option>Consulta Pré-anestésica</option><option>SADT</option></select></label><label>Credor<select name="creditor" required><option value="">Selecione</option><option>Caixa</option><option>Plantão</option><option>Plantão/Caixa</option></select></label><label>Valor (opcional)<input name="amount" inputmode="decimal" maxlength="32"></label><label>Siglas dos plantonistas (se aplicável)<select name="staffSiglas" multiple size="4">${labelStaffSiglas.map(value => `<option>${html(value)}</option>`).join('')}</select></label><button class="primary-button" type="submit">Salvar Etiqueta offline</button><p class="record-meta" data-offline-write-status role="status" aria-live="polite"></p></form>` : '';
    sections.push(`<section class="offline-operational-section panel"><h3>Etiquetas</h3>${cacheStamp(snapshots.labels)}${recordList(records, item => `<strong>${html(item.patientName || 'Etiqueta')}</strong>${item.type ? ` · ${html(item.type)}` : ''}${item.encounterCode ? `<small>Atendimento ${html(item.encounterCode)}</small>` : ''}`, snapshots.labels ? 'Nenhuma etiqueta registrada para esta data.' : undefined)}${labelForm}</section>`);
  }
  if (!sections.length) return `<section class="offline-operational-dashboard" aria-label="Consulta offline"><p class="offline-readonly-notice sync-state" role="status">Não há uma cópia offline disponível para esta área neste aparelho.</p></section>`;
  return `<section class="offline-operational-dashboard" aria-label="Consulta offline"><p class="offline-readonly-notice sync-state" role="status">Consultas mostram uma cópia local, possivelmente desatualizada. Os registros offline ficam vinculados a esta conta no aparelho e só serão enviados após confirmação manual.</p><div class="offline-operational-sections content-grid">${sections.join('')}</div></section>`;
}
export async function readOfflineOperationalSnapshot({uid, kind, day, access = {}, readSafeCache, now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000} = {}) {
  if (typeof uid !== 'string' || !uid.trim() || !isDayKey(day) || typeof readSafeCache !== 'function') return null;
  let cacheKind, cacheId;
  if (kind === 'schedule') { cacheKind = 'scheduleDays'; cacheId = day; }
  else if (kind === 'checklist') { cacheKind = 'checklists'; cacheId = day; }
  else if (REPORT_MODULES.has(kind)) { cacheKind = 'offlineOperational'; cacheId = offlineOperationalCacheId(kind, day, access); }
  else return null;
  if (!cacheId) return null;
  const cached = await readSafeCache(uid, cacheKind, cacheId);
  if (!cached || cached.uid !== uid || !Number.isFinite(cached.cachedAt) || now - cached.cachedAt < 0 || now - cached.cachedAt > maxAgeMs) return null;
  const data = cached.data;
  if (kind === 'schedule') {
    if (!data || typeof data !== 'object' || !Array.isArray(data.positions || data.assignments || data.siglas)) return null;
    return {kind, day, schedule: data, stale: true, cachedAt: cached.cachedAt, readOnly: true};
  }
  const records = kind === 'checklist' ? data?.records : data?.records;
  if (!Array.isArray(records)) return null;
  return {kind, day, records: records.map(record => ({...record, stale: true})), priorRecords: kind === 'checklist' && Array.isArray(data.priorRecords) ? data.priorRecords.map(record => ({...record, stale: true})) : [], stale: true, cachedAt: cached.cachedAt, readOnly: true};
}

