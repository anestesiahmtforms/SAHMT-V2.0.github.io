import {formatBirthDateAge,formatDisplayDate} from './date-format.js';
import {MEMBER_CATEGORIES} from './member-categories.js';
import {PROFESSIONAL_FIELDS} from './registration-domain.js';
import {isSystemOwnerEmail} from './system-account-exclusions.js';

const text=value=>typeof value==='string'?value.trim():'';
const address=value=>{
 const email=text(value).toLowerCase();
 return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';
};
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function uniqueBy(items,key) {
 const index=new Map();
 for(const item of items){
  const value=key(item);
  if(value)index.set(value,index.has(value)?null:item);
 }
 return index;
}

export function combinePeople(contacts,profiles) {
 const accounts=profiles.filter(profile=>text(profile.uid)&&(!profile.id||profile.id===profile.uid)
  &&address(profile.email)&&!isSystemOwnerEmail(profile.email));
 const byUid=uniqueBy(accounts,profile=>profile.uid);
 const byEmail=uniqueBy(accounts,profile=>address(profile.email));
 const bySigla=uniqueBy(accounts,profile=>text(profile.sigla));
 const contactEmails=uniqueBy(contacts,contact=>address(contact.email));
 const contactSiglas=uniqueBy(contacts,contact=>text(contact.sigla));
 const linked=new Set();
 const rows=contacts.map(contact=>{
  const email=address(contact.email),sigla=text(contact.sigla);
  let profile=email?byEmail.get(email):bySigla.get(sigla);
  if(profile&&(
   byUid.get(profile.uid)!==profile||byEmail.get(address(profile.email))!==profile||
   contactSiglas.get(sigla)!==contact||(email&&contactEmails.get(email)!==contact)||
   (profile.sigla&&profile.sigla!==sigla)||(!email&&contactEmails.has(address(profile.email)))))profile=null;
  if(profile)linked.add(profile);
  return {contact,profile,email:email||address(profile?.email),name:text(contact.name)||text(profile?.displayName)||email};
 });
 for(const profile of accounts){
  if(linked.has(profile))continue;
  rows.push({contact:null,profile,email:address(profile.email),name:text(profile.displayName)||profile.email});
 }
 const byDirectoryEmail=uniqueBy(rows,row=>row.email);
 for(const row of rows)row.canLinkProfessional=Boolean(row.email&&byDirectoryEmail.get(row.email)===row&&
  (!row.profile||byUid.get(row.profile.uid)===row.profile)&&!isSystemOwnerEmail(row.email));
 return rows.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base'}));
}

const fieldIds=new Set(['fullName','motherName','fatherName','birthDate','cpf','crm','rqe','phone','address',
 'formation','institutionalParticipation','lattes']);
const personalFields=PROFESSIONAL_FIELDS.filter(field=>fieldIds.has(field.id));
function professionalFields(record) {
 const answers=record.answers||{};
 const rows=personalFields.flatMap(field=>{
  const value=answers[field.id];
  if(!Array.isArray(value)&&!text(value))return [];
  const output=field.id==='birthDate'?formatDisplayDate(value)
   :field.id==='cpf'&&typeof value==='string'?value.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4')
   :Array.isArray(value)?value.map(item=>field.options?.find(([key])=>key===item)?.[1]||'').filter(Boolean).join(', ')
   :value;
  const age=field.id==='birthDate'&&formatBirthDateAge(value);
  return [[field.label,output],...(age?[['Idade atual',age]]:[])];
 });
 const oldFiliation=text(answers.filiation||record.legacyAnswers?.filiation);
 if(oldFiliation&&(!answers.motherName||!answers.fatherName))rows.push(['Filiação',oldFiliation]);
 return rows;
}

function fieldList(rows){
 const fields=rows.filter(([,value])=>value);
 return fields.length?`<dl class="people-fields">${fields.map(([label,value])=>`<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>`:'';
}

function personCard({contact,profile,name,email},index,roleLabel){
 return `<li>
  <div class="contact-list-heading"><strong>${h([contact?.sigla||profile?.sigla,name].filter(Boolean).join(' · '))}</strong>
  ${contact?`<button class="secondary-button" type="button" data-contact-edit="${h(contact.sigla)}">Editar</button>`:''}</div>
  <small>${h([contact?.role||roleLabel(profile?.role),contact?.phone||profile?.phone,email].filter(Boolean).join(' · '))}</small>
  <details data-person="${index}"><summary>Informações pessoais</summary>
   ${fieldList([['Nome',name],['E-mail',email],['Telefone',contact?.phone||text(profile?.phone)],
    ['Link WhatsApp',contact?.whatsAppLink],['CRM',contact?.crm],['Entrada na equipe',formatDisplayDate(contact?.entryDate)],
    ['Função',contact?.role],['Perfil no app',roleLabel(profile?.role)],
    ['Grupo',Array.isArray(profile?.memberCategories)?profile.memberCategories.map(key=>MEMBER_CATEGORIES[key]).filter(Boolean).join(' · '):''],
    ['Contato',contact?(contact.active?'Ativo':'Inativo'):''],
    ['Acesso ao app',profile?(profile.active&&profile.access?'Ativo':'Bloqueado'):'']])}
   <div data-person-fk></div><div data-person-fc aria-live="polite"></div>
  </details>
 </li>`;
}

const peopleGroups=[
 ['EFETIVO','Equipe',['equipe','efetivo']],
 ['RESIDENTE_3','R3',['r3','residente 3','residente r3']],
 ['RESIDENTE_2','R2',['r2','residente 2','residente r2']],
 ['RESIDENTE_1','R1',['r1','residente 1','residente r1']],
 ['SUBSTITUTO','Substituto',['substituto','substituta']]
];

function renderPeopleGroups(rows,roleLabel){
 if(!rows.length)return '<p class="empty-state">Nenhuma pessoa encontrada nas fontes consultadas.</p>';
 const unassigned='SEM_GRUPO';
 const groups=new Map([...peopleGroups.map(([id])=>[id,[]]),[unassigned,[]]]);
 rows.forEach((row,index)=>{
  const categories=row.profile?.memberCategories;
  const assigned=peopleGroups.find(([id])=>Array.isArray(categories)&&categories.includes(id));
  const role=text(row.contact?.role).toLowerCase().replace(/\s+/g,' ');
  const group=assigned||peopleGroups.find(([, , roles])=>roles.includes(role));
  groups.get(group?.[0]||unassigned).push(personCard(row,index,roleLabel));
 });
 return [...peopleGroups,[unassigned,'Sem grupo definido']].map(([id,label])=>{
  const cards=groups.get(id);
  if(id===unassigned&&!cards.length)return '';
  return `<section aria-labelledby="people-group-${id}">
   <h3 id="people-group-${id}">${label}</h3>
   ${cards.length?`<ul class="record-list people-directory">${cards.join('')}</ul>`:'<p class="empty-state">Nenhuma pessoa neste grupo.</p>'}
  </section>`;
 }).join('');
}

export function mountPeopleDirectory(host,{contacts,profiles,registrationRequest,readTeamEntry,occurrenceGrantAccess,contactFailed=false,profilesFailed=false,isCurrent,onEdit,roleLabel}) {
 const rows=combinePeople(contacts,profiles);
 const partial=[contactFailed&&'Contatos',profilesFailed&&'Contas do app'].filter(Boolean);
 host.innerHTML=`${partial.length?`<p role="status">${h(partial.join(' e '))} · consulta indisponível.</p>`:''}
 ${renderPeopleGroups(rows,roleLabel)}`;
 const bySigla=new Map(contacts.map(contact=>[contact.sigla,contact]));
 host.querySelectorAll('[data-contact-edit]').forEach(button=>button.addEventListener('click',()=>{
  const contact=bySigla.get(button.dataset.contactEdit);
  if(contact&&isCurrent())onEdit(contact);
 }));
 let catalog;
 const registrations=()=>catalog||=(registrationRequest('LIST',{}).then(({rows})=>{
  if(!Array.isArray(rows))throw Error('PEOPLE_FC_LIST');
  return uniqueBy(rows,row=>address(row.email));
 }).catch(error=>{catalog=null;throw error;}));
 host.querySelectorAll('[data-person]').forEach(details=>{
  const row=rows[Number(details.dataset.person)];
  let loading=false,loaded=false;
  const target=details.querySelector('[data-person-fc]');
  const fk=details.querySelector('[data-person-fk]');
  if(occurrenceGrantAccess&&row.profile&&row.canLinkProfessional)for(const [kind,title,label] of [
   ['hospital','Núcleo de Segurança do Hospital','Pode registrar relatos no SAHMT'],
   ['descriptions','Registros de Ocorrências','Pode editar as descrições das ocorrências']
  ]){
   details.insertAdjacentHTML('beforeend',`<div class="people-occurrence-grant" data-people-occurrence-grant="${kind}"><h4>${title}</h4>`+
    `<label><input type="checkbox" disabled> ${label}</label>`+
    '<button type="button" class="secondary-button" disabled>SALVAR PERMISSÃO</button><p role="status"></p></div>');
   const grant=details.querySelector(`[data-people-occurrence-grant="${kind}"]`),checkbox=grant.querySelector('input'),button=grant.querySelector('button'),status=grant.querySelector('p');
   let ready=false,busy=false;
   const refresh=async()=>{
    busy=true;button.disabled=true;status.textContent='Consultando permissão…';
    try{
     const enabled=await occurrenceGrantAccess(kind,row.profile.uid);
     if(!isCurrent())return;
     checkbox.checked=enabled;checkbox.disabled=false;ready=true;status.textContent='';button.textContent='SALVAR PERMISSÃO';
    }catch{if(isCurrent()){status.textContent='Permissão indisponível no FC.';button.textContent='TENTAR NOVAMENTE';}}
    finally{busy=false;button.disabled=false;}
   };
   details.addEventListener('toggle',()=>{if(details.open&&!ready&&!busy&&isCurrent())void refresh();});
   button.addEventListener('click',async()=>{
    if(busy||!isCurrent())return;
    if(!ready){void refresh();return;}
    busy=true;checkbox.disabled=button.disabled=true;status.textContent='Salvando…';
    try{await occurrenceGrantAccess(kind,row.profile.uid,checkbox.checked);if(isCurrent())status.textContent='Permissão salva.';}
    catch{if(isCurrent())status.textContent='Não foi possível confirmar a permissão. Tente novamente.';}
    finally{busy=false;checkbox.disabled=button.disabled=false;}
   });
   checkbox.addEventListener('input',()=>{button.textContent='SALVAR PERMISSÃO';});
  }
  details.addEventListener('toggle',async()=>{
   if(!details.open||!isCurrent()||loading||loaded)return;
   loading=true;
   let failed=false;
   const requests=[];
   if(readTeamEntry&&row.profile?.active===true&&row.profile?.access===true&&row.canLinkProfessional&&!formatDisplayDate(row.contact?.entryDate)){
    requests.push(readTeamEntry(row.profile.uid).then(date=>{
     if(isCurrent()&&date)fk.innerHTML=fieldList([['Entrada na equipe',formatDisplayDate(date)]]);
    }).catch(()=>{}));
   }
   if(registrationRequest&&row.canLinkProfessional){
    target.textContent='Consultando Cadastro Profissional…';
    requests.push((async()=>{
     try{
      const entry=(await registrations()).get(row.email);
      if(!isCurrent())return;
      if(entry===null){target.textContent='Há mais de um cadastro profissional para este e-mail.';return;}
      if(!entry){target.textContent='Cadastro Profissional ainda não vinculado.';return;}
      const {record}=await registrationRequest('DETAIL',{uid:entry.uid});
      if(!isCurrent())return;
      if(record?.uid!==entry.uid||address(record?.email)!==row.email)throw Error('PEOPLE_FC_IDENTITY');
      target.innerHTML='<h4>Cadastro Profissional · FC</h4>'+fieldList(professionalFields(record));
     }catch{
      failed=true;
      if(isCurrent())target.textContent='Cadastro Profissional indisponível. Feche e reabra para tentar novamente.';
     }
    })());
   }
   await Promise.all(requests);
   loading=false;loaded=!failed;
  });
 });
}
