export const VACATIONS_2027_REFERENCE=Object.freeze({
 source:'https://anestesiahmtforms.github.io/ferias2027/',
 driveFolder:'https://drive.google.com/drive/folders/1MmQUTSE0oWVpgrhV8IBzTW7h0E8O3okl',
 spreadsheet:'https://docs.google.com/spreadsheets/d/1NFR4jJUV2HRWD68hrh3zT8g6N1i3sGrQ5LXexf-Xm8w/edit',
});
export const VACATION_MONTHS=[
 ['janeiro','JANEIRO',[5,6,7,8],3],['fevereiro','FEVEREIRO',[5,6,7,8],9],
 ['marco','MARÇO',[13,14,15,16,17],3],['abril','ABRIL',[13,14,15,16],9],
 ['maio','MAIO',[22,23,24,25],3],['junho','JUNHO',[22,23,24,25,26],9],
 ['julho','JULHO',[31,32,33,34],3],['agosto','AGOSTO',[31,32,33,34],9],
 ['setembro','SETEMBRO',[39,40,41,42,43],3],['outubro','OUTUBRO',[39,40,41,42],9],
 ['novembro','NOVEMBRO',[48,49,50,51],3],['dezembro','DEZEMBRO',[48,49,50,51,52],9],
];
export const vacationSigla=value=>String(value||'').trim().toUpperCase().split('(')[0].trim().split(/\s+/)[0];
export function vacationSlot(id){
 for(const [month,,rows,column] of VACATION_MONTHS)for(let w=0;w<rows.length;w++)for(let s=0;s<3;s++)if(id===`${month}-${w}-${s}`)return {month,week:w,slot:s,row:rows[w],column:column+s};
 return null;
}
const halfDays=[[['CH','FL']],[['RO','AA']],[['DE','BA'],['LC','GU']],[['RO','AA']],[['L2','BA'],['GB','AA']]];
export function vacationOverlap(values,rules){
 const people=values.map(vacationSigla).filter(Boolean);let total=0;
 for(let a=0;a<people.length;a++)for(let b=a+1;b<people.length;b++)for(let day=0;day<5;day++){
  if(rules[people[a]]?.[day]&&rules[people[b]]?.[day])total+=halfDays[day].some(pair=>pair.includes(people[a])&&pair.includes(people[b]))?.5:1;
 }
 return total;
}
export function vacationSchedule(values,rulesRows){
 const rules=Object.fromEntries(rulesRows.slice(1).filter(r=>vacationSigla(r[0])).map(r=>[vacationSigla(r[0]),r.slice(1,6).map(v=>vacationSigla(v)==='X'?1:0)]));
 return {rules,siglas:Object.keys(rules).sort(),months:VACATION_MONTHS.map(([id,name,rows,column])=>({id,name,weeks:rows.map((row,index)=>{
  const cells=values[row-1]||[],right=column===9,slots=Array.from({length:3},(_,s)=>({id:`${id}-${index}-${s}`,value:String(cells[column+s-1]??'')}));
  return {label:String(cells[right?6:0]||`${index+1}ª semana`),period:String(cells[right?7:1]||''),overlapDays:vacationOverlap(slots.map(s=>s.value),rules),slots};
 })}))};
}
export function simulateVacation(data,sourceId,targetId){
 const weeks=data.months.flatMap(m=>m.weeks.map(w=>({...w,month:m.name}))),source=weeks.find(w=>w.slots.some(s=>s.id===sourceId)),target=weeks.find(w=>w.slots.some(s=>s.id===targetId));
 const own=source?.slots.find(s=>s.id===sourceId),other=target?.slots.find(s=>s.id===targetId);
 if(!data.ownSigla||!own||!other||source===target||vacationSigla(own.value)!==data.ownSigla)throw Error('Selecione uma das suas semanas e um destino de outra semana.');
 const copies=[source,target].map(w=>({...w,slots:w.slots.map(s=>({...s}))}));
 copies[0].slots.find(s=>s.id===sourceId).value=other.value;
 copies[1].slots.find(s=>s.id===targetId).value=own.value;
 return copies.map(w=>{
  const siglas=w.slots.map(s=>vacationSigla(s.value)).filter(Boolean),unknown=siglas.filter(s=>!Array.isArray(data.rules[s])),duplicate=new Set(siglas).size!==siglas.length;
  const days=unknown.length?null:vacationOverlap(w.slots.map(s=>s.value),data.rules);
  return {...w,days,unknown,duplicate,allowed:days!==null&&days<=3&&!duplicate};
 });
}
export function canUseVacationModule(session){
 const u=session?.user,p=session?.profile;
 return Boolean(session?.status==='signed-in'&&u?.uid&&u.emailVerified===true&&p?.uid===u.uid&&p.active===true&&p.access===true&&typeof u.email==='string'&&p.email?.trim().toLowerCase()===u.email.trim().toLowerCase());
}
export function vacationMessage(error){return ({
 VACATIONS_FORBIDDEN:'Seu perfil precisa estar ativo e liberado. Ajustes são exclusivos do administrador.',
 VACATIONS_CONFLICT:'A escala foi alterada. Atualize e confira o lançamento antes de salvar novamente.',
 VACATIONS_BUSY:'Há outro ajuste em andamento. Aguarde um momento e atualize a escala.',
 VACATIONS_PENDING:'O resultado deste ajuste ainda precisa ser confirmado. Atualize a escala antes de tentar outra alteração.',
 VACATIONS_INPUT_INVALID:'Confira o lançamento, a sigla e a justificativa obrigatória.',
 VACATIONS_SHEETS_UNAVAILABLE:'Não foi possível acessar a planilha da escala. Confira a conexão e o acesso do serviço FE.',
 VACATIONS_SESSION_CHANGED:'Sua sessão mudou. Volte e abra a escala novamente.',
 })[error?.code||error?.message]||'Não foi possível confirmar a escala. Tente atualizar novamente.';}
