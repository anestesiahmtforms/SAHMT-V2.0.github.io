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

export function offlineOperationalDashboardMarkup({day, snapshots = {}, permissions = {}, stations = []} = {}) {
  const sections = [];
  if (permissions.schedule) {
    const schedule = snapshots.schedule?.schedule;
    const positions = schedule ? (schedule.assignments || schedule.siglas || schedule.positions || []).map((item, index) => {
      const value = typeof item === 'string' ? {sigla: item} : item || {};
      return `<li><strong>${index + 1}. ${html(value.sigla || value.name || value.label || 'Posição')}</strong>${value.name && value.name !== value.sigla ? ` · ${html(value.name)}` : ''}</li>`;
    }).join('') : '';
    sections.push(`<section><h3>Escala do dia</h3>${cacheStamp(snapshots.schedule)}${schedule ? `<ol class="record-list">${positions}</ol>` : '<p class="empty-state">A escala de hoje ainda não foi salva neste aparelho.</p>'}</section>`);
  }
  if (permissions.checklist) {
    const records = snapshots.checklist?.records || [];
    const stationById = new Map(stations.map(station => [station.id, station]));
    const latestByStation = new Map();
    for (const record of records) if (record.stationId && !latestByStation.has(record.stationId)) latestByStation.set(record.stationId, record);
    const activeStations = stations.filter(station => station.active === true);
    const checklistRows = snapshots.checklist ? activeStations.map(station => {
      const record = latestByStation.get(station.id);
      return `<li><strong>${html(station.name || station.id)}</strong> · ${record ? html(record.condition || record.status || 'Registrado') : 'Sem checagem no snapshot salvo'}${record?.occurrence ? `<small>${html(record.occurrence)}</small>` : ''}</li>`;
    }) : [];
    const knownStations = new Set(activeStations.map(station => station.id));
    for (const record of records) if (record.stationId && !knownStations.has(record.stationId)) checklistRows.push(`<li><strong>${html(record.stationName || record.stationId)}</strong> · ${html(record.condition || record.status || 'Registrado')}${record.occurrence ? `<small>${html(record.occurrence)}</small>` : ''}</li>`);
    sections.push(`<section><h3>Checklist</h3>${cacheStamp(snapshots.checklist)}${checklistRows.length ? `<ul class="record-list">${checklistRows.join('')}</ul>` : !snapshots.checklist && activeStations.length ? `<p class="empty-state">O catálogo está salvo, mas o resultado diário do checklist não foi armazenado neste aparelho.</p>` : recordList(records, item => `<strong>${html(item.stationName || item.stationId || 'Arsenal')}</strong> · ${html(item.condition || item.status || 'Sem registro salvo')}${item.occurrence ? `<small>${html(item.occurrence)}</small>` : ''}`, snapshots.checklist ? 'Nenhum registro de checklist para esta data.' : undefined)}</section>`);
  }
  if (permissions.events) {
    const records = snapshots.events?.records || [];
    sections.push(`<section><h3>Eventos</h3>${cacheStamp(snapshots.events)}${recordList(records, item => `<strong>${html(item.memberStatus || item.memberName || item.eventType || 'Evento')}</strong>${item.eventType ? ` · ${html(item.eventType)}` : ''}${item.description ? `<small>${html(item.description)}</small>` : ''}`, snapshots.events ? 'Nenhum evento registrado para esta data.' : undefined)}</section>`);
  }
  if (permissions.labels) {
    const records = snapshots.labels?.records || [];
    sections.push(`<section><h3>Etiquetas</h3>${cacheStamp(snapshots.labels)}${recordList(records, item => `<strong>${html(item.patientName || 'Etiqueta')}</strong>${item.type ? ` · ${html(item.type)}` : ''}${item.encounterCode ? `<small>Atendimento ${html(item.encounterCode)}</small>` : ''}`, snapshots.labels ? 'Nenhuma etiqueta registrada para esta data.' : undefined)}</section>`);
  }
  if (!sections.length) return '<p class="empty-state">Seu perfil local não tem acesso de consulta a estes módulos.</p>';
  return `<section class="offline-operational-dashboard" aria-label="Consulta offline"><header><p class="eyebrow">CONSULTA OFFLINE · ${html(day)}</p><h2>Última cópia deste aparelho</h2></header><p class="sync-state" role="status">Somente leitura. Os dados podem estar desatualizados; alterações e confirmações estão indisponíveis sem validação do servidor.</p>${sections.join('')}</section>`;
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

