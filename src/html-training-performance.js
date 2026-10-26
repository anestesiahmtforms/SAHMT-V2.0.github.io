const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=value=>value.toLocaleString('pt-BR',{maximumFractionDigits:2});
export function trainingScoreView(payload,uid){
 const score=payload?.score;
 const keys=['acknowledgement','test','suggestion','total'];
 const confirmed=Boolean(score&&score.uid===uid&&keys.every(key=>Number.isFinite(score[key])&&score[key]>=0)&&Number.isSafeInteger(score.version)&&score.version>=0&&Math.abs(score.total-score.acknowledgement-score.test-score.suggestion)<1e-8);
 return {confirmed,total:confirmed?score.total:null,score:confirmed?score:null,trainings:confirmed&&Array.isArray(payload.trainings)?payload.trainings:[]};
}
export function renderTrainingScore(payload,uid,base){
 const view=trainingScoreView(payload,uid);
 if(!view.confirmed)return '<h4>Resultados dos treinamentos</h4><p role="status">Aguardando confirmação dos resultados.</p>';
 const {score}=view;
 const combined=base?.subjectUid===uid&&base.presentation?.confirmed&&Number.isFinite(base.presentation.total)?base.presentation.total+score.total:null;
 return `<h4>Resultados dos treinamentos</h4>${combined!==null?`<p class="ht-score-combined">Total de pontos: <strong>${number(combined)}</strong></p>`:''}<p class="ht-score-total"><strong>${number(score.total)} pontos</strong> nos treinamentos HTML</p><dl class="ht-score-parts"><div><dt>Ciência</dt><dd>${number(score.acknowledgement)}</dd></div><div><dt>Maior nota</dt><dd>${number(score.test)}</dd></div><div><dt>Sugestões</dt><dd>${number(score.suggestion)}</dd></div></dl><p class="record-meta">Sugestões recebem pontos somente após avaliação do gestor ou administrador.</p>${view.trainings.length?`<details><summary>Ver resultados por treinamento</summary><ul>${view.trainings.map(item=>`<li><strong>${escape(item.title||item.trainingId)}</strong><span>Ciência: ${number(Number(item.acknowledgement)||0)} · Maior nota: ${number(Number(item.test)||0)} · Sugestões: ${number(Number(item.suggestion)||0)}</span></li>`).join('')}</ul></details>`:'<p>Nenhum treinamento pontuado até o momento.</p>'}`;
}

/** Independent loading: an unavailable legacy balance never blocks new training results. */
export function mountHtmlTrainingPerformance(root,{user,container=root,isCurrent=()=>true,api:providedApi}={}){
 let alive=true,seq=0,subject=user.uid,payload=null,base=null,client=null,unsubscribe=null;
 const valid=()=>alive&&root.isConnected&&isCurrent()&&(!client||client.valid());
 const render=()=>{if(valid())root.innerHTML=renderTrainingScore(payload,subject,base);};
 async function load(uid=subject){
  subject=uid;payload=null;const ticket=++seq;
  if(valid())root.innerHTML='<h4>Resultados dos treinamentos</h4><p role="status">Atualizando resultados…</p>';
  try{
   if(!providedApi&&!client){const {createHtmlTrainingClient}=await import('./html-training.js');client=await createHtmlTrainingClient(user);if(!alive)return;unsubscribe=client.subscribeInvalidated(()=>{seq++;payload=null;if(alive)root.textContent='Sua sessão mudou. Entre novamente.';});}
   const result=await (providedApi||client.api)('SCORE',{subjectUid:uid});
   if(!valid()||ticket!==seq)return;
   payload=result;render();
  }catch(error){if(!valid()||ticket!==seq)return;root.innerHTML='<h4>Resultados dos treinamentos</h4><p role="status">Não foi possível confirmar os resultados agora. Tente atualizar novamente.</p><button type="button" class="secondary-button" data-html-score-retry>Atualizar resultados</button>';}
 }
 const onChange=event=>{if(event.target.matches?.('[data-evaluation-person]')&&event.target.value)void load(event.target.value);};
 const refresh=()=>{void load();};
 const retry=event=>{if(event.target.closest?.('[data-html-score-retry]'))refresh();};
 const offline=()=>{seq++;payload=null;if(valid())root.innerHTML='<h4>Resultados dos treinamentos</h4><p role="status">Sem conexão. Aguarde para confirmar os resultados.</p>';};
 container.addEventListener('change',onChange);root.addEventListener('click',retry);
 window.addEventListener('html-training-score-updated',refresh);
 window.addEventListener('online',refresh);window.addEventListener('offline',offline);
 void import('./html-training-performance.css');void load();
 const stop=()=>{alive=false;seq++;unsubscribe?.();container.removeEventListener('change',onChange);root.removeEventListener('click',retry);window.removeEventListener('html-training-score-updated',refresh);window.removeEventListener('online',refresh);window.removeEventListener('offline',offline);payload=null;};
 stop.setBase=value=>{base=value;if(value.subjectUid!==subject)void load(value.subjectUid);else render();};
 return stop;
}
