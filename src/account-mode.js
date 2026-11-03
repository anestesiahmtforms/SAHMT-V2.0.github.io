import {governanceSessionReady} from './governance-access.js';

const modeEmail = 'wx2064@gmail.com';
const storageKey = 'sahmt.team-mode-uid';
const teamPermissions = Object.freeze(Object.fromEntries([
  'scheduleRead', 'eventsRead', 'labelsRead', 'labelsWrite', 'checklistRead', 'checklistWrite',
  'checklistSign', 'trainingsRead', 'notificationsRead', 'occurrencesWrite', 'managementModuleEnabled',
  'performanceModuleEnabled', 'managementRead', 'managementIndicatorsRead'
].map(permission => [permission, true])));

function hasModeSelector(session) {
  return governanceSessionReady(session) && session.user.email.trim().toLowerCase() === modeEmail &&
    (session.profile.role === 'administrador_app' || session.profile.permissions?.admin === true);
}

// This is an app view. The authenticated Firebase identity and server grants stay with the account.
export function createAccountMode() {
  let authenticated;
  let teamUid = '';
  try { teamUid = sessionStorage.getItem(storageKey) || ''; } catch {}

  function save(uid) {
    teamUid = uid;
    try {
      if (uid) sessionStorage.setItem(storageKey, uid);
      else sessionStorage.removeItem(storageKey);
    } catch {}
  }

  function presentation() {
    if (!hasModeSelector(authenticated)) return authenticated;
    if (authenticated.user.uid !== teamUid) return {...authenticated, accountMode: 'administrator'};
    return {...authenticated, accountMode: 'team', profile: {
      ...authenticated.profile,
      role: 'temporario',
      permissions: teamPermissions
    }};
  }

  return {
    update(next) {
      authenticated = next;
      if (teamUid && (next.status === 'signed-out' || (next.user?.uid && next.user.uid !== teamUid) ||
        (next.status === 'signed-in' && !hasModeSelector(next)))) save('');
      return presentation();
    },
    select(mode) {
      if (!hasModeSelector(authenticated) || authenticated.offline || authenticated.validatingProfile ||
        !['administrator', 'team'].includes(mode) || mode === presentation().accountMode) return null;
      save(mode === 'team' ? authenticated.user.uid : '');
      return presentation();
    }
  };
}
