/** Personal presentation comes only from authorized server state, never local storage. */
export function htmlTrainingActivityState(training, state, uid) {
  const empty={color:'red',label:'Não iniciado',reading:false,assessment:false,suggestion:false,perfect:false,complete:false};
  if(!state||!uid||state.uid!==uid||state.trainingId&&state.trainingId!==training.id)return empty;
  const attempts=Array.isArray(state.attempts)?state.attempts:[];
  const completed=attempts.filter(a=>a.trainingVersion===training.version&&Number.isFinite(a.completedAt)&&a.completedAt>0);
  const run=state.run?.trainingVersion===training.version?state.run:null;
  const reading=completed.some(a=>Number.isFinite(a.acknowledgedAt)&&a.acknowledgedAt>0)||Boolean(run?.acknowledgedAt);
  const assessment=completed.some(a=>Number.isFinite(a.score))||Boolean(run&&['SUGGESTIONS','COMPLETED'].includes(run.stage)&&run.answers&&Object.keys(run.answers).length===5);
  const suggestion=completed.some(a=>typeof a.suggestion==='string'&&a.suggestion.trim().length>0);
  const perfect=completed.some(a=>Number.isFinite(a.score)&&Number.isFinite(a.maxScore)&&a.maxScore>0&&a.maxScore===training.maxScore&&Math.abs(a.score-a.maxScore)<1e-8);
  const complete=reading&&assessment&&suggestion&&perfect;
  const started=attempts.length>0||Boolean(state.run)||reading||assessment||suggestion;
  const label=complete?'Concluído · nota máxima':!started?'Não iniciado':!reading?'Leitura em andamento':!assessment?'Avaliação pendente':!suggestion?'Sugestão pendente':!perfect?'Nota abaixo da máxima':'Em andamento';
  return {color:complete?'green':started?'yellow':'red',label,reading,assessment,suggestion,perfect,complete};
}

/** Metadata and text are independently authorized and can travel in parallel. */
export async function loadHtmlTrainingDocument(api,{trainingId,version}) {
  const opening=api('OPEN',{trainingId});
  if(!Number.isSafeInteger(version)||version<1){
    const opened=await opening;
    return {opened,content:await api('CONTENT',{trainingId,version:opened.training.version})};
  }
  const [authorization,body]=await Promise.allSettled([opening,api('CONTENT',{trainingId,version})]);
  if(authorization.status==='rejected')throw authorization.reason;
  const opened=authorization.value;
  let content;
  if(opened.training.version!==version){
    if(body.status==='rejected'&&body.reason?.code!=='VERSION_CHANGED')throw body.reason;
    content=await api('CONTENT',{trainingId,version:opened.training.version});
  }else{
    if(body.status==='rejected')throw body.reason;
    content=body.value;
  }
  if(content.revision!==undefined&&content.revision!==opened.training.version)throw Object.assign(new Error('O documento foi atualizado. Abra-o novamente.'),{code:'VERSION_CHANGED',status:409});
  return {opened,content};
}

/** Only visible titles are checked, with bounded work that yields to opening a document. */
export async function hydrateHtmlTrainingActivities({trainings,read,isCurrent,onResult,onError=()=>{},concurrency=2}) {
  let cursor=0;
  const worker=async()=>{while(isCurrent()&&cursor<trainings.length){const training=trainings[cursor++];try{const result=await read(training);if(isCurrent())onResult(training,result);}catch(error){if(isCurrent())onError(training,error);}}};
  await Promise.all(Array.from({length:Math.min(concurrency,trainings.length)},worker));
}
