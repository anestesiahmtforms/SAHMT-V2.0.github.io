const labels={
  pending:'Ocorrências aguardando encerramento',
  clear:'Sem pendências em análise',
  preparing:'Aguardando preparação',
  open:'Em análise',
  published:'Resultado publicado',
  finalized:'Evento finalizado'
};

export function setOccurrenceAnalysisState(button,state) {
  button.dataset.analysisState=state;
  button.setAttribute('aria-description',labels[state]);
}

export function occurrenceAnalysisState(entry) {
  if(entry.eventClosed===true)return 'finalized';
  if(entry.analysisClosed===true)return 'published';
  return entry.analysisStarted===true?'open':'preparing';
}

export function occurrenceChainState(records) {
  return records.some(entry=>entry.eventClosed!==true)?'pending':'clear';
}

export async function readOccurrenceChain(repository,uid,origin) {
  let after=null;
  do {
    const page=await repository.listFollowups({uid,origin,after});
    if(occurrenceChainState(page.entries)==='pending')return 'pending';
    after=page.next;
  } while(after);
  return 'clear';
}
