export const trainingCategories=Object.freeze(['Protocolos','Diretrizes','ROPs','Documentos administrativos']);
const folderOrder={Protocolos:['Protocolos do SAHMT','Protocolos da Instituição'],ROPs:['Cultura de segurança','Comunicação','Uso de medicamentos','Vida profissional / Força de Trabalho','Controle de Infecção','Avaliação de riscos'],'Documentos administrativos':['Acesso restrito','Acesso geral']};
const category=item=>String(item.category||'').startsWith('ROPs')?'ROPs':item.category||'Outros documentos';
const subcategory=item=>String(item.subcategory||'').trim();

/** Only receives the already authorized catalog. Folder clicks perform no reads. */
export function trainingFolderLevel(catalog,path=[]){
 const selected=path.slice(0,2),root=selected[0];
 const rows=root?catalog.filter(item=>category(item)===root):catalog;
 const childNames=Object.keys(folderOrder).includes(root)?folderOrder[root]:[];
 const present=[...new Set(rows.map(subcategory).filter(Boolean))];
 const names=[...childNames,...present.filter(name=>!childNames.includes(name)).sort((a,b)=>a.localeCompare(b,'pt-BR'))];
 if(!root){
  const roots=[...trainingCategories,...new Set(catalog.map(category).filter(name=>!trainingCategories.includes(name)))];
  return {path:[],folders:roots.map(name=>({name,path:[name],count:catalog.filter(item=>category(item)===name).length})),trainings:[]};
 }
 if(selected.length===1)return {path:selected,folders:names.map(name=>({name,path:[root,name],count:rows.filter(item=>subcategory(item)===name).length})),
  trainings:rows.filter(item=>!subcategory(item)).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'))};
 return {path:selected,folders:[],trainings:rows.filter(item=>subcategory(item)===selected[1]).sort((a,b)=>a.title.localeCompare(b.title,'pt-BR'))};
}
