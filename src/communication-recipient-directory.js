import {escapeNoticeHtml as esc} from './communication-notice-text.js';
import {canonicalMemberCategory} from './member-categories.js';

const categories=[
  {id:'EFETIVO',label:'EQUIPE'},
  {id:'RESIDENTE',label:'RESIDENTES'},
  {id:'SUBSTITUTO',label:'SUBSTITUTOS'},
];
const collator=new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true});
export function recipientCategory(user){
  const assigned=categories.find(category=>user.memberCategories?.map?.(canonicalMemberCategory).includes(category.id));
  if(assigned)return assigned;
  if(user.institutionalGroup==='team')return categories[0];
  if(user.institutionalGroup==='substitute')return categories[2];
  if(user.institutionalGroup==='resident')return categories[1];
  return null;
}

export function communicationRecipientOptions(users,{selected='',placeholder='Selecione um destinatário'}={}){
  const groups=new Map();
  for(const user of users){
    const category=recipientCategory(user);if(!category)continue;
    if(!groups.has(category.id))groups.set(category.id,{...category,users:[]});
    groups.get(category.id).users.push(user);
  }
  const name=user=>String(user.displayName||user.name||'Nome não informado').trim();
  const content=categories.map(category=>{
    const members=groups.get(category.id)?.users||[];
    if(!members.length)return '';
    members.sort((a,b)=>collator.compare(name(a),name(b))||String(a.uid).localeCompare(String(b.uid)));
    return `<optgroup label="${category.label}">${members.map(user=>`<option value="${esc(user.uid)}"${user.uid===selected?' selected':''}>${esc(name(user))}</option>`).join('')}</optgroup>`;
  }).join('');
  return `<option value="">${users.length?esc(placeholder):'Nenhum destinatário disponível'}</option>${content}`;
}
