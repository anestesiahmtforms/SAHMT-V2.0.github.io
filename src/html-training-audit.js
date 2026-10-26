import './html-training-audit.css';
import * as core from './domain/rop-audit.js';
import { escapeHtml as h } from './html-training-model.js';
import { createAuditViews } from './html-training-audit-views.js';

const steps=['Identificação','Testes da ROP','Coleta de casos','Verificações de apoio','Evidências e ações','Revisão e conclusão'];
export function mountTrainingAudit(root,{training,schema,api,isActive}) {
  const dialog=document.createElement('dialog');dialog.id='ht-audit-dialog';dialog.className='html-trainings';dialog.setAttribute('aria-label',`Auditoria de ${training.title}`);root.append(dialog);
  let alive=true,step=0,errors=[],records=[],draft=null,version=0,dirty=false,saving=false,message='Consultando histórico autorizado…';
  const uuid=()=>crypto.randomUUID(),authorized=()=>alive&&isActive()&&dialog.isConnected;
  const views=createAuditViews({schema,core,getDraft:()=>draft,uuid});
  const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Sao_Paulo'});
  function newDraft(){version=0;dirty=true;return {id:uuid(),trainingId:training.id,schemaVersion:schema.version,status:'draft',createdAt:new Date().toISOString(),context:{date:today(),sector:'',auditor:'',periodStart:'',periodEnd:'',population:'',sample:'',sampling:'',method:'',applicability:''},answers:{},checks:{},cases:[],evidence:[],actions:[],validation:{reviewer:'',notes:''}};}
  function select(record){draft=structuredClone(record.draft||record);draft.answers??={};draft.checks??={};draft.validation??={};draft.context??={};for(const key of ['cases','evidence','actions'])draft[key]??=[];version=record.version||draft.version||0;step=draft.status==='completed'?5:0;dirty=false;errors=[];}
  function update(){dialog.querySelectorAll('.audit-save-state').forEach(el=>el.textContent=message || (dirty?'Alterações não salvas no serviço.':'Registro carregado do serviço.'));}
  function render(preserve=false){
    if(!authorized()||!draft)return;
    const scroll=preserve?(dialog.querySelector('.audit-content')?.scrollTop||0):0,readOnly=draft.status==='completed';
    dialog.innerHTML=`<div class="audit-shell"><header class="audit-head"><div><span class="audit-kicker">Auditoria desta ROP</span><h2>${h(training.title)}</h2><small>${h(schema.tests?.length||0)} testes · ${readOnly?'Registro concluído, preservado no histórico':'Preenchimento guiado'}</small></div><button type="button" data-close class="audit-icon" aria-label="Fechar auditoria">×</button></header><div class="audit-tools"><span class="audit-save-state" role="status"></span><select data-history aria-label="Selecionar auditoria"><option value="">Auditoria atual</option>${records.map(r=>{const d=r.draft||r;return `<option value="${h(r.id||d.id)}"${d.id===draft.id?' selected':''}>${d.status==='completed'?'Concluída':'Rascunho'} · ${h(d.context?.date)} · ${h(d.context?.sector||'Sem setor')}</option>`;}).join('')}</select><button type="button" data-new>Nova auditoria</button>${!readOnly?'<button type="button" data-save>Salvar rascunho</button>':''}<button type="button" data-export>Exportar JSON</button></div><div class="audit-layout"><nav class="audit-nav" aria-label="Etapas da auditoria">${steps.map((s,i)=>`<button type="button" data-step="${i}"${i===step?' aria-current="step"':''}>${i+1}. ${s}</button>`).join('')}</nav><section class="audit-content">${errors.length?`<div role="alert" class="audit-errors"><strong>Confira as pendências</strong><ul>${errors.map(e=>`<li>${h(e.message)}</li>`).join('')}</ul></div>`:''}${views.render(step)}</section></div><footer class="audit-footer"><span class="audit-step-label">Etapa ${step+1} de 6<progress max="6" value="${step+1}"></progress></span><div><button type="button" data-back class="audit-secondary"${step===0?' disabled':''}>Voltar</button>${step<5?'<button type="button" data-next class="audit-open">Próxima etapa →</button>':readOnly?'<span>Conclusão preservada</span>':'<button type="button" data-finish class="audit-open">Concluir auditoria</button>'}</div></footer></div>`;
    dialog.querySelector('.audit-content').scrollTop=scroll;update();
    if(saving)dialog.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);
  }
  function touch(){dirty=true;message='';update();}
  function failure(err){if(!authorized())return;message=['CONFLICT','VERSION_CONFLICT','VERSION_CHANGED'].includes(err.code)?'Conflito de versão. O registro ou treinamento foi alterado em outro acesso; reabra a auditoria antes de salvar.':err.message||'Não foi possível salvar a auditoria.';errors=[{message}];if(err.status===401||err.status===403){dialog.close();dialog.remove();alive=false;return;}if(!draft){dialog.replaceChildren();const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=message;const close=document.createElement('button');close.textContent='Fechar';close.addEventListener('click',()=>{dialog.close();dialog.remove();alive=false;});dialog.append(p,close);return;}render(true);}
  async function save(complete=false){
    if(!authorized()||saving||draft.status==='completed')return;
    if(complete){errors=core.validateRopAudit(schema,draft);if(errors.length){step=errors[0].step;render();return;}}
    saving=true;message='Salvando no serviço…';render(true);
    try{
      const result=await api('AUDIT_SAVE',{trainingId:training.id,id:draft.id,expectedVersion:version,draft:structuredClone(draft),complete});
      if(!authorized())return;
      select(result.audit);records=records.filter(r=>(r.id||r.draft?.id)!==draft.id);records.push(result.audit);dirty=false;message=complete?'Auditoria concluída no serviço. Histórico preservado; nenhuma pontuação concedida.':'Rascunho salvo no serviço.';
    }catch(err){failure(err);}finally{saving=false;if(authorized())render(true);}
  }
  dialog.addEventListener('input',event=>{
    if(!authorized()||saving||draft?.status==='completed')return;
    const el=event.target;
    if(el.dataset.path)views.set(el.dataset.path,el.value);
    if(el.dataset.tests!==undefined)draft.actions[Number(el.dataset.tests)].tests=el.value.toUpperCase().split(',').map(t=>t.trim()).filter(t=>/^[TAV]\d+$/.test(t));
    touch();const stats=dialog.querySelector('#audit-case-stats');if(stats)stats.innerHTML=views.caseStats();
  });
  dialog.addEventListener('change',event=>{
    if(!authorized()||!event.target.hasAttribute('data-history'))return;
    const record=records.find(r=>(r.id||r.draft?.id)===event.target.value);
    if(record){select(record);message='Registro carregado do serviço.';render();}
  });
  dialog.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b||!authorized()||saving)return;
    if(b.hasAttribute('data-close')){if(dirty){message='Há alterações não salvas. Salve o rascunho ou use “Descartar alterações e fechar”.';render(true);const discard=document.createElement('button');discard.type='button';discard.textContent='Descartar alterações e fechar';discard.addEventListener('click',()=>{dialog.close();dialog.remove();alive=false;});dialog.querySelector('.audit-tools').append(discard);}else{dialog.close();dialog.remove();alive=false;}return;}
    if(b.dataset.step!==undefined){step=Number(b.dataset.step);errors=[];render();return;}
    if(b.hasAttribute('data-back')||b.hasAttribute('data-next')){step=Math.max(0,Math.min(5,step+(b.hasAttribute('data-next')?1:-1)));errors=[];render();return;}
    if(b.hasAttribute('data-save')){void save();return;}
    if(b.hasAttribute('data-finish')){void save(true);return;}
    if(b.hasAttribute('data-new')){if(dirty){message='Salve o rascunho atual antes de iniciar outra auditoria.';update();return;}draft=newDraft();step=0;errors=[];message='Nova auditoria ainda não salva.';render();return;}
    if(b.hasAttribute('data-export')){const blob=new Blob([JSON.stringify({format:'sahmt-rop-audit',version:1,model:{id:schema.id,version:schema.version},audit:draft},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`auditoria-${training.id}-${draft.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;}
    if(draft.status==='completed')return;
    if(b.dataset.answer){draft.answers[b.dataset.answer]??={};draft.answers[b.dataset.answer].status=b.dataset.value;touch();render(true);return;}
    if(b.dataset.add){const group=b.dataset.add,number=Math.max(0,...draft.evidence.map(e=>Number(e.code.slice(1))||0))+1;draft[group].push(group==='cases'?{id:uuid(),reference:'',criterion:'',result:'',finding:'',evidence:''}:group==='evidence'?{id:uuid(),code:'E'+String(number).padStart(3,'0'),reference:'',date:'',version:''}:{id:uuid(),tests:[],description:'',owner:'',due:'',status:'open',implementation:'',effectiveness:'',closedBy:'',closedAt:''});touch();render(true);return;}
    if(b.dataset.remove){draft[b.dataset.remove].splice(Number(b.dataset.index),1);touch();render(true);}
  });
  dialog.addEventListener('cancel',event=>{if(dirty){event.preventDefault();message='Salve o rascunho ou use o botão de fechar para descartar.';update();}});
  dialog.innerHTML='<p role="status">Consultando histórico autorizado…</p>';dialog.showModal();
  (async()=>{try{const result=await api('AUDIT_LIST',{trainingId:training.id});if(!authorized())return;records=result.audits||[];if(records.length)select(records[0]);else draft=newDraft();message=records.length?'Histórico carregado do serviço.':'Nova auditoria ainda não salva.';render();}catch(err){failure(err);}})();
  return ()=>{alive=false;dialog.close();dialog.remove();records=[];draft=null;};
}
