const labels={
  pending:'Ocorrências aguardando encerramento',
  clear:'Sem pendências em análise',
  preparing:'Aguardando preparação',
  open:'Em análise',
  'responses-closed':'Respostas encerradas',
  published:'Resultado publicado',
  'awaiting-acknowledgement':'Resultado disponível para ciência',
  acknowledged:'Ciência registrada',
  'pre-analysis':'Pré-análise aberta à equipe',
  'awaiting-preparation':'Aguardando preparação ou análise final',
  finalized:'Evento finalizado'
};

export function setOccurrenceAnalysisState(button,state) {
  button.dataset.analysisState=state;
  button.setAttribute('aria-description',labels[state]);
}

export function occurrenceAnalysisState(entry) {
  if(entry.origin==='app'){
    if(entry.analysisClosed===true)return entry.acknowledged===true?'acknowledged':'awaiting-acknowledgement';
    if(entry.responsesClosedAt)return 'responses-closed';
    return entry.analysisStarted===true?'pre-analysis':'preparing';
  }
  if(entry.eventClosed===true)return 'finalized';
  if(entry.analysisClosed===true)return 'published';
  if(entry.responsesClosedAt)return 'responses-closed';
  return entry.analysisStarted===true?'open':'preparing';
}

export function occurrenceChainState(records,origin) {
  if(origin==='app'){
    const states=records.map(occurrenceAnalysisState);
    if(states.includes('pre-analysis'))return 'pre-analysis';
    return states.some(state=>state!=='acknowledged')?'awaiting-preparation':'clear';
  }
  return records.some(entry=>entry.eventClosed!==true)?'pending':'clear';
}

export async function readOccurrenceChain(repository,uid,origin) {
  let after=null;
  let waiting=false;
  do {
    const page=await repository.listFollowups({uid,origin,after});
    const state=occurrenceChainState(page.entries,origin);
    if(state==='pending'||state==='pre-analysis')return state;
    if(state==='awaiting-preparation')waiting=true;
    after=page.next;
  } while(after);
  return waiting?'awaiting-preparation':'clear';
}
