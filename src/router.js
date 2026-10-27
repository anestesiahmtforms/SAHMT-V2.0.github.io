import {deployment} from './deployment-context.js';
import {rememberModuleNavigation,rememberManagementReturn} from './module-navigation.js';
import {repairAppFiles,staleModuleFailure} from './app-repair.js';
const routes = new Set(['home', 'events', 'labels', 'management-hub', 'management', 'qmentum', 'checklist', 'training', 'notifications', 'occurrences', 'people', 'admin', 'offline']);
let navigationGeneration=0;

export function currentRoute() {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
  if (deployment.target === 'FB') return ['management','training','qmentum'].includes(route) ? route : 'management';
  return routes.has(route) ? route : 'home';
}

export async function navigate(route, {panel} = {}) {
  if (!routes.has(route)) return;
  const generation=++navigationGeneration,sourceHash=location.hash;
  const isCurrent=()=>generation===navigationGeneration&&location.hash===sourceHash;
  const suffix = route === 'management-hub' && ['records', 'indicators', 'results', 'surveys'].includes(panel) ? '/' + panel : '';
  if (deployment.target === 'FB' && !['management','training'].includes(route)) {
    rememberModuleNavigation(deployment.faBase);
    location.assign(deployment.faBase + '#/' + route + suffix); return;
  }
  if (deployment.target === 'FA' && deployment.externalManagementEnabled && ['management','training'].includes(route)) {
    let ready=false;
    try{const {ensureManagementSession}=await import('./management-entry-session.js');if(!isCurrent())return;ready=await ensureManagementSession({isCurrent});}
    catch(error){if(isCurrent()&&staleModuleFailure(error)&&repairAppFiles({target:'FA',hash:'#/'+route,automatic:true}))return;}
    if(!isCurrent())return;
    if(!ready){
      rememberManagementReturn('#/'+route);location.hash='#/offline';return;
    }
    rememberModuleNavigation(deployment.fbBase);
    location.assign(deployment.fbBase + '#/' + route); return;
  }
  location.hash = `#/${route}${suffix}`;
}

export function shouldRenderHashChange(session) {
  // The authenticated restricted shell also has navigation controls. render()
  // keeps data/actions gated until the profile is confirmed; ignoring the hash
  // here leaves the old page visible after returning from the separate FB app.
  return ['signed-in', 'auth-limited'].includes(session?.status);
}
