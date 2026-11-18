import {deployment} from './deployment-context.js';

const storageKey = 'sahmt-communication-activity-selection';
const maxAge = 30 * 60 * 1000;
const composerHash = '#/management-hub/communication';
const trainingHash = '#/management/area-gestao-de-documentos';
const surveysHash = '#/management-hub/surveys';
export const surveyActivityPanels = Object.freeze({
  climate: 'climateForm',
  stress: 'stressForm',
  epidemiological: 'epidemiological'
});

export function activitySelectionUrl(kind) {
  if (kind === 'TRAINING') return deployment.fbBase + trainingHash;
  if (kind === 'SURVEY') return deployment.faBase + surveysHash;
  return '';
}

const account = user => user?.emailVerified === true ? user.email?.trim().toLowerCase() || '' : '';

function readSelection() {
  try {
    const selection = JSON.parse(sessionStorage.getItem(storageKey));
    const elapsed = Date.now() - selection?.startedAt;
    return selection?.draft && elapsed >= 0 && elapsed < maxAge ? selection : null;
  } catch {
    return null;
  }
}

function writeSelection(selection) {
  sessionStorage.setItem(storageKey, JSON.stringify(selection));
}

export function startActivitySelection(user, kind, draft) {
  if (!account(user) || !activitySelectionUrl(kind)) return false;
  try {
    writeSelection({
      owner: account(user),
      source: kind,
      startedAt: Date.now(),
      draft
    });
    return true;
  } catch {
    return false;
  }
}

export function activitySelectionFor(user, kind) {
  const selection = readSelection();
  const destination = deployment.faBase + composerHash;
  const owner = account(user);
  if (!owner || selection?.owner !== owner || selection.source !== kind || selection.returning) return null;

  function returnToComposer(id, title) {
    const current = readSelection();
    const isSameSelection = current?.owner === owner && current.source === kind && current.startedAt === selection.startedAt && !current.returning;
    if (!isSameSelection) {
      location.assign(destination);
      return;
    }
    const draft = current.draft;
    if (id && (draft.activityId !== id || draft.kind !== kind)) {
      draft.activityId = id;
      draft.kind = kind;
      draft.minimumScore = '';
    }
    if (id) draft.sourceActivity = {id, kind, title};
    writeSelection({...current, draft, returning: true});
    location.assign(destination);
  }

  return {
    surveyForPanel(panel) {
      return kind === 'SURVEY' ? Object.keys(surveyActivityPanels).find(id => surveyActivityPanels[id] === panel) : undefined;
    },
    select(id, title) {
      if (kind === 'SURVEY' ? !Object.hasOwn(surveyActivityPanels, id) : !/^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,199}$/.test(id)) return;
      returnToComposer(id, title);
    },
    cancel() {
      returnToComposer();
    }
  };
}

export function restoreActivitySelection(user) {
  const selection = readSelection();
  if (!selection || selection.owner !== account(user)) return undefined;
  try {
    sessionStorage.removeItem(storageKey);
    return selection.draft;
  } catch {
    return undefined;
  }
}
