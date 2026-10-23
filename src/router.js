import {deployment} from './deployment-context.js';
const routes = new Set(['home', 'events', 'labels', 'management-hub', 'management', 'qmentum', 'checklist', 'training', 'notifications', 'occurrences', 'people', 'admin', 'offline']);

export function currentRoute() {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
  if (deployment.target === 'FB') return ['management','training','qmentum'].includes(route) ? route : 'management';
  return routes.has(route) ? route : 'home';
}

export function navigate(route) {
  if (!routes.has(route)) return;
  if (deployment.target === 'FB' && !['management','training'].includes(route)) {
    location.assign(deployment.faBase + '#/' + route); return;
  }
  if (deployment.target === 'FA' && deployment.externalManagementEnabled && ['management','training'].includes(route)) {
    location.assign(deployment.fbBase + '#/' + route); return;
  }
  location.hash = `#/${route}`;
}

export function shouldRenderHashChange(session) {
  return session?.status === 'signed-in';
}
