import {mountHtmlTrainings} from '../src/html-training.js';
const root=document.querySelector('#root');
const q=Array.from({length:6},(_,i)=>({id:`q${i}`,stem:`Pergunta ${i+1}`,points:1,options:[{id:'a',text:'Alternativa A'},{id:'b',text:'Alternativa B'}],correctOptionId:'a'}));
const training={id:'rop-01',title:'ROP demonstrativa de teste',category:'ROPs - Anestesiologia HMT',subcategory:'Segurança',managerUid:'manager',status:'PUBLISHED',version:1,sectionCount:2,selectedQuestionIds:q.slice(0,5).map(q=>q.id),audienceGroup:'GENERAL',hasAudit:true};
const sections=[{id:'s1',title:'Primeira seção',html:'<h2>Leitura segura</h2><p>Texto do treinamento.</p><script>parent.pwned=true</script><img src="https://invalid.test/pixel" onerror="parent.pwned=true">'},{id:'s2',title:'Segunda seção',html:'<p>Fim da leitura.</p>'}];
const schema={id:'audit1',trainingId:'rop-01',version:1,title:training.title,tests:[{code:'T1',text:'Registro está presente?'}],checks:[{code:'A1',text:'Requisito associado'},{code:'V1',text:'Foi encontrado erro?'}]};
let state={uid:'participant',trainingId:training.id,version:0,attempts:[],bestScore:0,ackPoints:0,run:null},auditRecords=[],holdList=false,releaseList,denyOpen=false;
window.calls=[];window.published=null;
const copy=v=>JSON.parse(JSON.stringify(v));
async function api(action,input){
 window.calls.push({action,input:copy(input)});
 if(action==='LIST'){if(holdList)await new Promise(r=>releaseList=r);return {trainings:[copy(training)]};}
 if(action==='OPEN'){if(denyOpen)throw Object.assign(new Error('Acesso revogado para esta conta.'),{status:403,code:'FORBIDDEN'});return {training:copy(training),state:copy(state),questions:q.slice(0,5).map(({correctOptionId,...question})=>question)};}
 if(action==='CONTENT')return {sections:copy(sections),revision:1};
 if(action==='BEGIN')state.run={id:crypto.randomUUID(),trainingVersion:1,readCount:0,stage:'READING'};
 if(action==='READ'){state.run.readCount++;if(state.run.readCount===2)state.run.stage='ACK';}
 if(action==='ACK'){state.ackPoints=1;state.run.stage='QUIZ';}
 if(action==='QUIZ'){state.run.answers=input.answers;state.run.stage='SUGGESTIONS';}
 if(action==='SUBMIT'){state.attempts.push({suggestion:input.suggestion,score:4});state.bestScore=4;state.run.stage='COMPLETED';return {state:copy(state),score:{total:5}};}
 if(action==='EDIT')return {training:copy(training),sections:copy(sections.map(s=>({...s,html:'<p>Conteúdo editável</p>'}))),bank:copy(q),auditSchema:copy(schema),suggestions:[{uid:'participant',version:3,attempts:[{suggestion:'Melhorar explicação'}]}]};
 if(action==='PUBLISH'){window.published=copy(input);training.version++;return {training:copy(training)};}
 if(action==='REVIEW')return {state:{},score:{total:6}};
 if(action==='AUDIT_LIST')return {audits:copy(auditRecords)};
 if(action==='AUDIT_SAVE'){const d={...copy(input.draft),version:input.expectedVersion+1,status:input.complete?'completed':'draft',completedAt:input.complete?Date.now():null};auditRecords=[d];return {audit:d};}
 state.version++;return {state:copy(state)};
}
let cleanup;
window.mount=(role='participant')=>{cleanup?.();state.uid=role;const profile=role==='admin'?{role:'administrador_app'}:{};cleanup=mountHtmlTrainings(root,{user:{uid:role},profile,api});return typeof cleanup;};
window.cleanup=()=>cleanup?.();window.holdList=()=>holdList=true;window.releaseList=()=>{holdList=false;releaseList?.();};
window.mountUnavailable=()=>{cleanup?.();cleanup=mountHtmlTrainings(root,{user:{uid:'participant'}});};
window.denyOpen=()=>denyOpen=true;
window.mount();
