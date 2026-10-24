import {deployment} from './deployment-context.js';
import {rememberModuleNavigation,rememberManagementReturn} from './module-navigation.js';
import {repairAppFiles,staleModuleFailure} from './app-repair.js';
const routes = new Set(['home', 'events', 'labels', 'management-hub', 'management', 'qmentum', 'checklist', 'training', 'notifications', 'occurrences', 'people', 'admin', 'offline']);

export function currentRoute() {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
  if (deployment.target === 'FB') return ['management','training','qmentum'].includes(route) ? route : 'management';
  return routes.has(route) ? route : 'home';
}

export async function navigate(route, {panel} = {}) {
  if (!routes.has(route)) return;
  const suffix = route === 'management-hub' && ['records', 'indicators', 'results', 'surveys'].includes(panel) ? '/' + panel : '';
  if (deployment.target === 'FB' && !['management','training'].includes(route)) {
    rememberModuleNavigation(deployment.faBase);
    location.assign(deployment.faBase + '#/' + route + suffix); return;
  }
  if (deployment.target === 'FA' && deployment.externalManagementEnabled && ['management','training'].includes(route)) {
    let ready=false;
    try{const {ensureManagementSession}=await import('./management-entry-session.js');ready=await ensureManagementSession();}
    catch(error){if(staleModuleFailure(error)&&repairAppFiles({target:'FA',hash:'#/'+route,automatic:true}))return;}
    if(!ready){
      rememberManagementReturn('#/'+route);location.hash='#/offline';return;
    }
    rememberModuleNavigation(deployment.fbBase);
    location.assign(deployment.fbBase + '#/' + route); return;
  }
  location.hash = `#/${route}${suffix}`;
}

export function shouldRenderHashChange(session) {
  return session?.status === 'signed-in';
}
