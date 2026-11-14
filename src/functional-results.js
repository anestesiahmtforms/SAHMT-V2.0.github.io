import {callInstitutionalSurvey} from './institutional-survey-client.js';
import {callRegistrationApi} from './registration-client.js';
import {createFunctionalOccupationalReader} from './vaccination-client.js';
import {DOSIMETRY_YEARS} from './dosimetry-domain.js';
import {VACCINES,VACCINATION_STATUSES,VACCINATION_YEARS} from './vaccination-domain.js';

const surveys=['climate','stress','epidemiological'];
const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const colors=['#24736a','#659bb1','#b0762a','#705493','#b45463','#367eaa','#778549','#64696e'];

export function resultYears(key){
  const years=key==='dosimetry'?DOSIMETRY_YEARS:key==='vaccination'?VACCINATION_YEARS:[];
  const current=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date()));
  return [...years].sort((a,b)=>Math.abs(a-current)-Math.abs(b-current)||b-a);
}

export async function loadFunctionalResult({key,year,uid,subjectUid,faAuth,isCurrent}){
  if(surveys.includes(key))return callInstitutionalSurvey({uid,isCurrent,authClient:faAuth,survey:key,action:'FK_AGGREGATE'});
  if(key==='notifications')return {pending:true};
  if(subjectUid!==uid)return {ownOnly:true};
  if(key==='professionalRegistration'){
    const {record}=await callRegistrationApi({uid,isCurrent,kind:'professional',action:'BOOTSTRAP'});
    if(record?.uid!==uid)return {record:null};
    const {crm,crmState,rqe,formation}=record.answers||{};
    return {record:{cycle:record.cycle,crm,crmState,rqe,formation}};
  }
  const client=await createFunctionalOccupationalReader(faAuth.currentUser,{isCurrent});
  try{
    const {record}=await client.read(key,year);
    return {record:record?.year===year&&(key==='dosimetry'||record.uid===uid)?record:null};
  }finally{client.dispose();}
}

function pie({label,slices}){
  const segments=slices.filter(slice=>Number.isFinite(slice.value)&&slice.value>0);
  const total=segments.reduce((sum,slice)=>sum+slice.value,0);
  let start=0;
  const stops=segments.map((slice,index)=>{
    const end=start+slice.value/total*100;
    const stop=colors[index%colors.length]+' '+start+'% '+end+'%';
    start=end;
    return stop;
  });
  const percent=new Intl.NumberFormat('pt-BR',{style:'percent',maximumFractionDigits:1});
  return '<figure class="functional-pie"><figcaption>'+h(label)+'</figcaption>'
    +'<div class="functional-pie-disc" aria-hidden="true" style="background:conic-gradient('+stops.join(',')+')"></div><ul>'
    +segments.map((slice,index)=>'<li><i aria-hidden="true" style="background:'+colors[index%colors.length]+'"></i>'+h(slice.label)+' <strong>'+percent.format(slice.value/total)+'</strong></li>').join('')
    +'</ul></figure>';
}

export function renderFunctionalResult(key,result){
  if(surveys.includes(key)){
    if(result.status==='OPEN')return '<p>O resultado coletivo será exibido após o encerramento do ciclo e a publicação do relatório.</p>';
    if(result.status!=='READY')return '<p>O relatório coletivo aguarda publicação.</p>';
    return result.groups.map(group=>'<section class="functional-survey-result"><h3>'+h(group.label)+'</h3>'
      +(group.charts.length?group.charts.map(pie).join(''):'<p>Sem distribuição publicável para este grupo.</p>')+'</section>').join('');
  }
  if(result.pending)return '<p>Nenhuma notificação disponível. O registro será feito pela administração.</p>';
  if(result.ownOnly)return '<p>Este resultado pessoal está disponível ao titular em sua própria sessão.</p>';
  const record=result.record;
  if(!record)return '<p>Nenhum registro disponível para consulta.</p>';
  if(key==='professionalRegistration'){
    const rows=[['Situação','Cadastro registrado'],['Ciclo',record.cycle],['CRM',[record.crm,record.crmState].filter(Boolean).join(' / ')],
      ['RQE',record.rqe],['Formação e qualificações',record.formation]];
    return '<dl class="functional-result-list">'+rows.filter(([,value])=>value).map(([label,value])=>
      '<div><dt>'+h(label)+'</dt><dd>'+h(value)+'</dd></div>').join('')+'</dl>';
  }
  if(key==='vaccination')return '<p>Situação informada no cadastro vacinal.</p><dl class="functional-result-list">'
    +VACCINES.map(({id,label})=>'<div><dt>'+h(label)+'</dt><dd>'+h(VACCINATION_STATUSES.find(state=>state.id===record.states?.[id])?.label||'Não informado')+'</dd></div>').join('')+'</dl>';
  return '<dl class="functional-result-list">'+record.months.map(month=>'<div><dt>'+h(month.label)+'</dt><dd>'
    +h(month.display)+(month.kind==='MEASURED'?' mSv':month.kind==='CODE'&&month.description?' · '+h(month.description):'')+'</dd></div>').join('')+'</dl>';
}
