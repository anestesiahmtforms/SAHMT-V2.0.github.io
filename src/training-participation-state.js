/** Presentation only. Points and completion are confirmed by the server. */
export function trainingActivityId(item) {
  if (item.trainingFormId || item.formId) return item.trainingFormId || item.formId;
  const match = /^(?:pdf_)?evaluation_(.+)$/.exec(String(item.id || ''));
  return match?.[1] || null;
}
export function trainingParticipationState(activity, participations = [], {uid, receipts = []} = {}) {
  const blue = {color:'blue', label:'Treinamento disponível', complete:false};
  if (!activity || !Number.isSafeInteger(activity.version) || activity.version<1) return {...blue,label:'Aguardando configuração do treinamento'};
  if (activity.trainingRevisionRequired === true || activity.status !== 'READY') return {...blue,label:'Treinamento em revisão ou aguardando liberação'};
  const records = participations.filter(row => row.uid === uid && row.recordType !== 'ATTEMPT' && row.version === activity.version &&
    (Boolean(activity.creditScopeId) && row.creditScopeId === activity.creditScopeId || row.activityId === activity.id));
  const record = records.find(row => row.recordType !== 'READING') || records[0];
  if (!record) {
    const started = receipts.some(row => row.uid === uid && row.formId === activity.id &&
      (activity.readingVersion === undefined ? row.materialVersion === activity.version : row.materialVersion === activity.readingVersion));
    return started ? {color:'yellow',label:'Treinamento parcial',complete:false} : blue;
  }
  const training = record.latestTraining || record.training;
  // Old records without stage evidence are not assumed complete.
  const full = training?.complete === true;
  const graded = activity.modalities?.test !== true || (Number.isFinite(training?.score) && Number.isFinite(training?.maxScore) && training.maxScore > 0 && training.score / training.maxScore >= 0.5);
  return full && graded ? {color:'green',label:'Treinamento completo',complete:true}
    : {color:'yellow',label: full && !graded ? 'Resultado inferior a 50% ou nota pendente' : 'Treinamento parcial',complete:false};
}

export function paintTrainingButton(button, state) {
  button.dataset.trainingState = state.color;
  button.classList.add('training-state-button');
  button.title = state.label;
  button.setAttribute('aria-label', (button.dataset.trainingTitle || button.textContent.trim()) + ' · ' + state.label);
}
