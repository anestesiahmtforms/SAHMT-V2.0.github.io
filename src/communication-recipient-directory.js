import {escapeNoticeHtml as esc} from './communication-notice-text.js';

const categories=[
  {id:'EFETIVO',label:'EQUIPE'},
  {id:'RESIDENTE_1',label:'R1'},
  {id:'RESIDENTE_2',label:'R2'},
  {id:'RESIDENTE_3',label:'R3'},
  {id:'SUBSTITUTO',label:'SUBSTITUTOS'},
];
const collator=new Intl.Collator('pt-BR',{sensitivity:'base',numeric:true});
const rankFromRole=role=>{
  const value=String(role||'');
  return value.match(/\bR[\s_-]*([123])\b/i)?.[1]||value.match(/\bRESIDENTE[\s_-]*([123])\b/i)?.[1]||'';
};

export function recipientCategory(user){
  const assigned=categories.find(category=>user.memberCategories?.includes?.(category.id));
  if(assigned)return assigned;
  if(user.institutionalGroup==='team')return categories[0];
  if(user.institutionalGroup==='substitute')return categories[4];
  if(user.institutionalGroup==='resident'){
    const rank=rankFromRole(user.role);
    return rank?categories[Number(rank)]:{id:'RESIDENTE_UNCLASSIFIED',label:'RESIDENTES · R1/R2/R3 SEM CLASSIFICAÇÃO'};
  }
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
  const order=[...categories,{id:'RESIDENTE_UNCLASSIFIED',label:'RESIDENTES · R1/R2/R3 SEM CLASSIFICAÇÃO'}];
  const content=order.map(category=>{
    const members=groups.get(category.id)?.users||[];
    if(!members.length)return '';
    members.sort((a,b)=>collator.compare(name(a),name(b))||String(a.uid).localeCompare(String(b.uid)));
    return `<optgroup label="${category.label}">${members.map(user=>`<option value="${esc(user.uid)}"${user.uid===selected?' selected':''}>${esc(name(user))}</option>`).join('')}</optgroup>`;
  }).join('');
  return `<option value="">${users.length?esc(placeholder):'Nenhum destinatário disponível'}</option>${content}`;
}
