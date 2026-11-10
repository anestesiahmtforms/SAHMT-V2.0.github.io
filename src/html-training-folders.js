export const validTrainingFolderPath=path=>Array.isArray(path)&&path.length>0&&path.length<=64&&path.every(part=>typeof part==='string'&&part===part.trim()&&part.length>0&&part.length<=160&&!/[\u0000-\u001f]/.test(part));
const canonicalCategory=value=>/^rops/i.test(String(value||''))?'ROPs':String(value||'').trim()||'Outros documentos';
export function trainingAccessPath(training){
 if(validTrainingFolderPath(training?.folderPath))return [canonicalCategory(training.folderPath[0]),...training.folderPath.slice(1)];
 return [canonicalCategory(training?.category),...(String(training?.subcategory||'').trim()?[String(training.subcategory).trim()]:[])];
}
export function trainingPathAllowed(access,path){
 const disabled=Array.isArray(access?.disabled)?access.disabled:[];
 return !path.some((_,index)=>disabled.includes(JSON.stringify(path.slice(0,index+1))));
}
export function parseTrainingFolderAccess(value){
 if(!value||!Number.isSafeInteger(value.version)||value.version<0||!Array.isArray(value.disabled))return null;
 for(const key of value.disabled){
  if(typeof key!=='string')return null;
  try{
   const path=JSON.parse(key);
   if(!validTrainingFolderPath(path)||JSON.stringify(trainingAccessPath({folderPath:path}))!==key)return null;
  }catch{return null;}
 }
 return {version:value.version,disabled:[...value.disabled]};
}
export const trainingCategories=Object.freeze(['Protocolos','Diretrizes','ROPs','Documentos administrativos']);
const folderOrder={Protocolos:['Protocolos do SAHMT','Protocolos da Instituição'],ROPs:['Cultura de segurança','Comunicação','Uso de medicamentos','Vida profissional / Força de Trabalho','Controle de Infecção','Avaliação de riscos'],'Documentos administrativos':['Acesso restrito','Acesso geral']};
const within=(path,parent)=>parent.every((part,index)=>path[index]===part);

/** Metadata-only paths keep administrative controls reachable without content. */
export function trainingFolderLevel(catalog,path=[],folderPaths=[]){
 const selected=[...path],rows=catalog.map(item=>({item,path:trainingAccessPath(item)})).filter(row=>within(row.path,selected));
 const paths=[...rows.map(row=>row.path),...folderPaths.filter(validTrainingFolderPath).filter(candidate=>within(candidate,selected))];
 const defaults=selected.length===0?trainingCategories:selected.length===1?(folderOrder[selected[0]]||[]):[];
 const present=[...new Set(paths.filter(candidate=>candidate.length>selected.length).map(candidate=>candidate[selected.length]))];
 const names=[...defaults,...present.filter(name=>!defaults.includes(name)).sort((a,b)=>a.localeCompare(b,'pt-BR'))];
 return {path:selected,folders:names.map(name=>{const child=[...selected,name];return {name,path:child,count:rows.filter(row=>within(row.path,child)).length};}),
  trainings:rows.filter(row=>row.path.length===selected.length).map(row=>row.item).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'))};
}
