export const DEFAULT_APP_FEATURES = Object.freeze({
  checklist: true,
  labels: true,
  trainings: true,
  management: true,
  notifications: true,
  esg: false,
  innovation: false
});

export const FEATURE_ROUTE = Object.freeze({
  checklist: 'checklist',
  labels: 'labels',
  trainings: 'training',
  management: 'management',
  notifications: 'notifications'
});

export function normalizeAppFeatures(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_APP_FEATURES).map(([key, fallback]) => [
    key,
    typeof source[key] === 'boolean' ? source[key] : fallback
  ]));
}

export function featureEnabledForRoute(route, features = DEFAULT_APP_FEATURES) {
  const feature = Object.entries(FEATURE_ROUTE).find(([, targetRoute]) => targetRoute === route)?.[0];
  return !feature || normalizeAppFeatures(features)[feature] === true;
}
