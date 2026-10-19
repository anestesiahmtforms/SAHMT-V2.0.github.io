import {operationalReportCacheId} from './offline-report-cache.js';

export async function inspectOfflineReadiness({uid, day, sigla = '', isAdmin = false, canManageLabels = false, readCache, assetsReady = false}) {
  const read = (kind, id) => readCache(uid, kind, id).catch(() => null);
  const [catalog, members, staff, schedule, stations, events, labels, checklist] = await Promise.all([
    read('eventCatalogs', 'operational'), read('eventMembers', 'all'), read('labelStaff', 'all'), read('scheduleDays', day), read('stations', 'all'),
    read('events', operationalReportCacheId('events', {uid, from: day, to: day, sigla, isAdmin, pageSize: 100})),
    read('labels', operationalReportCacheId('labels', {uid, from: day, to: day, sigla, canManage: canManageLabels, pageSize: 50})), read('checklists', day)
  ]);
  const items = stations?.data;
  const validStations = Array.isArray(items) && items.length === 28 && new Set(items.map(item => item.id)).size === 28 && items.every(item => item.id && typeof item.active === 'boolean');
  return {assetsReady, checkedAt: Date.now(), day, modules: {
    events: {formsReady: assetsReady && Boolean(catalog?.data?.payers?.length && catalog?.data?.creditors?.length && members?.data?.length && schedule?.data), dailyReportReady: Array.isArray(events?.data?.records)},
    labels: {formsReady: assetsReady && Array.isArray(staff?.data), dailyReportReady: Array.isArray(labels?.data?.records), entryMode: 'manual'},
    checklist: {formsReady: assetsReady && validStations, dailyReportReady: Array.isArray(checklist?.data?.records), stationCount: Array.isArray(items) ? items.length : 0}
  }};
}

export async function operationalAssetsReady(baseUrl) {
  if (!globalThis.caches) return false;
  const entries = await Promise.all(['', 'vendor/zxing.min.js', 'assets-manifest.json'].map(path => caches.match(`${baseUrl}${path}`)));
  return entries.every(Boolean);
}

export async function inspectDeviceStorage({navigator: device = globalThis.navigator, requestPersistence = false, matchMedia = globalThis.matchMedia} = {}) {
  const appleMobile = /iPhone|iPad|iPod/.test(device?.userAgent || '') || (/Mac/.test(device?.platform || '') && device?.maxTouchPoints > 1);
  const standalone = device?.standalone === true || Boolean(matchMedia?.('(display-mode: standalone)').matches);
  let persistent = null, usageBytes = null, quotaBytes = null;
  try {
    if (device?.storage?.persisted) persistent = await device.storage.persisted();
    if (requestPersistence && persistent !== true && device?.storage?.persist) persistent = await device.storage.persist();
  } catch { /* Storage access is optional; data entry must remain available. */ }
  try {
    const estimate = await device?.storage?.estimate?.();
    if (Number.isFinite(estimate?.usage)) usageBytes = Math.max(0, estimate.usage);
    if (Number.isFinite(estimate?.quota)) quotaBytes = Math.max(0, estimate.quota);
  } catch { /* Some private modes do not expose a storage estimate. */ }
  return {appleMobile, standalone, persistent, usageBytes, quotaBytes};
}
