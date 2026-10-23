import './management-hub.css';

const paths={
 groups:'M3 7h18v14H3zM7 7V3h10v4M7 12h10M7 16h7',
 performance:'m3 17 6-6 4 3 8-10M15 4h6v6M3 21h18',
 records:'M5 3h14v18H5zM9 7h6M9 11h6M9 15h6',
 occurrence:'M12 3 2 21h20L12 3ZM12 9v5M12 17v1',
 indicators:'M4 21V11h4v10M10 21V3h4v18M16 21V7h4v14',
 results:'M3 3v18h18M7 15l4-5 4 3 6-8',
 surveys:'M3 3h18v14H9l-6 4V3ZM7 7h10M7 11h6'
};
const icon=kind=>'<svg class="management-hub-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[kind]+'</svg>';
const panels={
 home:{title:'Gestão',icon:'groups',items:[
  {label:'Grupos de Gestão',icon:'groups',route:'management',access:'groups'},
  {label:'Desempenho',icon:'performance',route:'training',access:'performance'},
  {label:'Registros',icon:'records',panel:'records',access:'records'},
  {label:'Resultados dos Indicadores',icon:'results',panel:'results',access:'results'},
  {label:'Enquetes e Consultas',icon:'surveys',panel:'surveys',access:'surveys'}
 ]},
 records:{title:'Registros',icon:'records',parent:'home',items:[
  {label:'Registros de Ocorrências',icon:'occurrence',route:'occurrences',access:'occurrences'},
  {label:'Registro de Indicadores',icon:'indicators',route:'qmentum',access:'qmentum'}
 ]},
 results:{title:'Resultados dos Indicadores',icon:'results',parent:'home',message:'Os resultados dos indicadores serão disponibilizados nesta área.'},
 surveys:{title:'Enquetes e Consultas',icon:'surveys',parent:'home',message:'As enquetes e consultas serão disponibilizadas nesta área.'}
};

// This menu reads no database. Each destination retains its existing session,
// profile and server authorization checks. Future FD/FE areas stay empty.
export function mountManagementHub(root,{access={},initialPanel='home',onNavigate,onExit,onPanelChange=()=>{}}={}){
 if(initialPanel==='indicators')initialPanel='records';
 const panelAllowed=name=>name==='home'||access[name]===true;
 let disposed=false,panel=Object.hasOwn(panels,initialPanel)&&panelAllowed(initialPanel)?initialPanel:'home';
 root.innerHTML='<dialog class="management-hub-dialog" aria-labelledby="management-hub-title"><header class="management-hub-header"><div data-hub-heading-icon></div><h2 id="management-hub-title" tabindex="-1"></h2></header><section class="management-hub-body" data-hub-body></section><footer class="management-hub-footer"><button class="secondary-button" type="button" data-hub-back></button></footer></dialog>';
 const dialog=root.querySelector('dialog'),body=dialog.querySelector('[data-hub-body]'),back=dialog.querySelector('[data-hub-back]');
 const render=()=>{
  const spec=panels[panel];dialog.dataset.panel=panel;
  dialog.querySelector('#management-hub-title').textContent=spec.title;
  dialog.querySelector('[data-hub-heading-icon]').innerHTML=icon(spec.icon);
  body.innerHTML=spec.items?'<div class="management-hub-grid">'+spec.items.map((item,index)=>{
   const allowed=!item.access||access[item.access]===true;
   return '<button type="button" class="management-hub-button" data-hub-item="'+index+'"'+(allowed?'':' disabled aria-disabled="true" title="Acesso não liberado para este perfil"')+'>'+icon(item.icon)+'<span>'+item.label+'</span><span class="management-hub-arrow" aria-hidden="true">›</span></button>';
  }).join('')+'</div>':'<div class="management-hub-empty">'+icon(spec.icon)+'<p>'+spec.message+'</p></div>';
  back.textContent=spec.parent?'VOLTAR':'FECHAR';body.scrollTop=0;onPanelChange(panel);
  dialog.querySelector('#management-hub-title').focus({preventScroll:true});
 };
 const goBack=()=>{const parent=panels[panel].parent;if(parent){panel=parent;render();}else onExit();};
 const click=event=>{
  const button=event.target.closest('[data-hub-item]');if(!button||button.disabled)return;
  const item=panels[panel].items?.[Number(button.dataset.hubItem)];
  if(!item||item.access&&access[item.access]!==true)return;
  if(item.panel){panel=item.panel;render();}else if(item.route)onNavigate(item.route);
 };
 const cancel=event=>{event.preventDefault();goBack();};
 const close=()=>{if(!disposed)onExit();};
 body.addEventListener('click',click);back.addEventListener('click',goBack);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',close);
 render();if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
 return ()=>{disposed=true;body.removeEventListener('click',click);back.removeEventListener('click',goBack);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',close);if(dialog.open&&typeof dialog.close==='function')dialog.close();root.replaceChildren();};
}
