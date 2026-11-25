import {requestFunctionalDosimetry} from './functional-client.js';
import {dosimetryMonths} from './dosimetry-domain.js';
import {callInstitutionalSurvey} from './institutional-survey-client.js';
import {callRegistrationApi} from './registration-client.js';
import {ATTACHMENT_SUBJECTS,PROFESSIONAL_FIELDS,scheduleParticipationPercent} from './registration-domain.js';
import {INSTITUTIONAL_GROUPS} from './institutional-group.js';
import {formatBirthDateAge,formatDisplayDate,formatDisplayDateTime} from './date-format.js';
import {createFunctionalOccupationalReader} from './vaccination-client.js';
import {DOSIMETRY_YEARS} from './dosimetry-domain.js';
import {VACCINES,VACCINATION_DECLARATIONS,VACCINATION_STATUSES,VACCINATION_YEARS} from './vaccination-domain.js';

const surveys=['climate','stress','epidemiological'];
const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const colors=['#24736a','#659bb1','#b0762a','#705493','#b45463','#367eaa','#778549','#64696e'];

export function resultYears(key){
  const years=key==='dosimetry'?DOSIMETRY_YEARS:key==='vaccination'?VACCINATION_YEARS:[];
  const current=Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date()));
  return [...years].sort((a,b)=>Math.abs(a-current)-Math.abs(b-current)||b-a);
}

export async function loadFunctionalResult({key,year,uid,subjectUid,administrator=false,faAuth,isCurrent}){
  if(surveys.includes(key))return callInstitutionalSurvey({uid,isCurrent,authClient:faAuth,survey:key,action:'FK_AGGREGATE'});
  if(key==='notifications')return {pending:true};
  if(key==='dosimetry'){const result=await requestFunctionalDosimetry({faAuth,uid,isCurrent,input:{operation:'GET',subjectUid,year}});return {record:result.record?{...result.record,months:dosimetryMonths(result.record.values)}:null};}
  const own=subjectUid===uid;
  if(!own&&!administrator)return {ownOnly:true};
  if(key==='professionalRegistration'){
    const user=faAuth.currentUser;
    const current=()=>isCurrent()&&user?.uid===uid&&faAuth.currentUser===user;
    if(!current())throw Error('FK_SESSION_CHANGED');
    const input=own?{}:{uid:subjectUid};
    const [registration,receipts]=await Promise.all([
      callRegistrationApi({uid,isCurrent:current,kind:'professional',action:own?'BOOTSTRAP':'DETAIL',input}),
      callRegistrationApi({uid,isCurrent:current,kind:'drive',action:own?'LIST_OWN':'LIST_SUBJECT',input}).catch(()=>null)
    ]);
    if(!current())throw Error('FK_SESSION_CHANGED');
    const {record=null}=registration;
    const email=user.email?.trim().toLowerCase();
    if(record&&(record.uid!==subjectUid||(own&&(!email||record.email!==email))))return {record:null};
    return {record,files:Array.isArray(receipts?.files)?receipts.files:null};
  }
  if(key!=='vaccination')throw Error('FK_SOURCE_INVALID');
  const client=await createFunctionalOccupationalReader(faAuth.currentUser,{isCurrent,auth:faAuth});
  try{
    const {record,files}=await client.read(year,subjectUid);
    if(record&&(record.uid!==subjectUid||record.year!==year))return {record:null};
    return {record,files:Array.isArray(files)?files:null};
  }finally{client.dispose();}
}

const retiredProfessionalLabels={
  filiation:'Filiação anterior',
  crmState:'UF do CRM',
  shifts:'Horários, jornadas e plantões',
  surgicalDetails:'Áreas específicas ou subespecialidades de interesse',
  technicalSkills:'Competências técnicas',
  leadership:'Gestão, liderança e governança',
  complementarySkills:'Competências complementares'
};

function professionalAnswer(field,value){
  if(field.id==='birthDate')return formatDisplayDate(value);
  if(field.id==='cpf')return String(value??'').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
  if(field.type==='work-grid'&&Array.isArray(value)){
    const byDay=new Map();
    for(const entry of value){
      const [day,slot]=String(entry).split(':');
      const label=field.options.find(([id])=>id===day)?.[1]||(day==='7'?'Escala variável':day);
      if(!byDay.has(label))byDay.set(label,[]);
      if(slot)byDay.get(label).push(field.columns.find(([id])=>id===slot)?.[1]||slot);
    }
    return [...byDay].map(([day,slots])=>slots.length?day+' · '+slots.join(', '):day).join('\n');
  }
  const choice=value=>field.options?.find(([id])=>id===value)?.[1]??value;
  return Array.isArray(value)?value.map(choice).join(', '):choice(value);
}

function resultList(rows){
  return '<dl class="functional-result-list">'+rows.map(([label,value])=>
    '<div><dt>'+h(label)+'</dt><dd>'+h(value||'Não informado')+'</dd></div>').join('')+'</dl>';
}

export function renderProfessionalRegistration({record,files=[]}){
  let details='<p>Nenhum cadastro profissional salvo até o momento.</p>';
  if(record){
    const answers=record.answers||{},previous=record.legacyAnswers||{},groups=new Map();
    let section='';
    for(const field of PROFESSIONAL_FIELDS){
      if(field.section){section=field.section;groups.set(section,[]);}
      const value=answers[field.id];
      if(field.when&&!value&&answers[field.when[0]]!==field.when[1])continue;
      const rows=groups.get(section);
      rows.push([field.label,professionalAnswer(field,value)]);
      if(field.id==='birthDate'&&value){
        const age=formatBirthDateAge(value);
        if(age)rows.push(['Idade atual',age]);
      }
      if(field.id==='workDays'){
        const percent=scheduleParticipationPercent(value);
        if(percent!==null)rows.push(['Índice de participação na escala',
          (percent/100).toLocaleString('pt-BR',{style:'percent',maximumFractionDigits:2})]);
      }
    }
    const metadata=[['Situação','Cadastro registrado'],['Ciclo',record.cycle],['E-mail da conta',record.email],
      ['Grupo',INSTITUTIONAL_GROUPS[record.group]],['Cadastro realizado em',formatDisplayDateTime(record.createdAt)],
      ['Última atualização',formatDisplayDateTime(record.updatedAt)],
      ['Declaração de veracidade',record.truth===true?'Confirmada':'']];
    details=resultList(metadata.filter(([,value])=>value))
      +[...groups].map(([title,rows])=>'<section><h3>'+h(title)+'</h3>'+resultList(rows)+'</section>').join('');
    const earlier=PROFESSIONAL_FIELDS.filter(field=>previous[field.id]).map(field=>[field.label,professionalAnswer(field,previous[field.id])]);
    for(const [id,label] of Object.entries(retiredProfessionalLabels)){
      const value=previous[id]||answers[id];
      if(value)earlier.push([label,value]);
    }
    if(earlier.length)details+='<section><h3>Respostas de versões anteriores</h3>'+resultList(earlier)+'</section>';
  }
  const attachments=renderReceipts(files,subject=>ATTACHMENT_SUBJECTS[subject]);
  return '<div class="functional-professional">'+details+'<section><h3>Comprovantes</h3>'+attachments+'</section></div>';
}

function renderReceipts(files,subjectLabel){
  if(files===null)return '<p>Não foi possível consultar os comprovantes agora.</p>';
  if(!files.length)return '<p>Nenhum comprovante enviado.</p>';
  return resultList(files.map(file=>[subjectLabel(file.subject)||'Comprovante',
    [file.name,formatDisplayDateTime(file.uploadedAt)].filter(Boolean).join(' · ')]));
}

function renderVaccination({record,files=[]}){
  let details='<p>Nenhum cadastro vacinal salvo neste período.</p>';
  if(record){
    const metadata=[['Nome',record.displayName],['E-mail da conta',record.email],['Ano',record.year],['Grupo',record.category],
      ['Cadastro realizado em',formatDisplayDateTime(record.createdAt)],['Última atualização',formatDisplayDateTime(record.updatedAt)]];
    const states=VACCINES.map(({id,label})=>[label,VACCINATION_STATUSES.find(state=>state.id===record.states?.[id])?.label]);
    const declaration=VACCINATION_DECLARATIONS.find(choice=>choice.id===record.declaration)?.label;
    const confirmations=[['Declaração sobre os comprovantes',declaration],['Declaração de veracidade',record.truth===true?'Confirmada':''],
      ['Ciência das orientações',typeof record.awareness==='boolean'?(record.awareness?'Confirmada':'Pendente'):''],['Observações',record.notes]];
    details=resultList([...metadata.filter(([,value])=>value),...states,...confirmations]);
  }
  const attachments=renderReceipts(files,subject=>VACCINES.find(vaccine=>vaccine.id===subject)?.label);
  return '<div class="functional-professional">'+details+'<section><h3>Comprovantes</h3>'+attachments+'</section></div>';
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
    if(result.status==='OPEN')return '<p>Pesquisa em andamento. As estatísticas coletivas serão exibidas após o encerramento e a publicação do relatório.</p>';
    if(result.status!=='READY')return '<p>O relatório coletivo aguarda publicação.</p>';
    return '<p>Resultados coletivos por grupo</p>'+result.groups.map(group=>'<section class="functional-survey-result"><h3>'+h(group.label)+'</h3>'
      +(group.charts.length?group.charts.map(pie).join(''):'<p>Sem distribuição publicável para este grupo.</p>')+'</section>').join('');
  }
  if(result.pending)return '<p>Nenhuma notificação disponível. O registro será feito pela administração.</p>';
  if(result.ownOnly)return '<p>Este resultado pessoal está disponível ao titular em sua própria sessão.</p>';
  if(key==='professionalRegistration')return renderProfessionalRegistration(result);
  if(key==='vaccination')return renderVaccination(result);
  const record=result.record;
  if(!record)return '<p>Nenhum registro disponível para consulta.</p>';
  return '<dl class="functional-result-list">'+record.months.map(month=>'<div><dt>'+h(month.label)+'</dt><dd>'
    +h(month.display)+(month.kind==='MEASURED'?' mSv':month.kind==='CODE'&&month.description?' · '+h(month.description):'')+'</dd></div>').join('')+'</dl>';
}
