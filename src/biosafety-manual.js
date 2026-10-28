import './biosafety-manual.css';
import {createVaccinationClient} from './vaccination-client.js';
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountBiosafetyManual(root,{user,onBack=()=>{},clientFactory=createVaccinationClient}={}){
 let disposed=false,client,unsubscribe=()=>{},generation=0,busy=true,manual=null,error='';
 root.classList.add('biosafety-manual-app');
 function render(){
  if(disposed)return;
  root.innerHTML=`<section class="biosafety-manual-panel"><header class="biosafety-manual-header"><div><p class="eyebrow">BIOSSEGURANÇA · HMT</p><h2>MANUAL DE BIOSSEGURANÇA - HMT</h2></div><button class="secondary-button" type="button" data-manual-back>VOLTAR PARA BIOSSEGURANÇA</button></header>${busy?'<p role="status">Carregando o manual…</p>':error?`<p role="alert" class="biosafety-manual-alert">${h(error)}</p>`:manual?`<p class="biosafety-manual-meta">${h(manual.documentCode)} · Versão ${h(manual.revision)} · Emissão: ${h(manual.issuedOn.split('-').reverse().join('/'))}</p><iframe class="biosafety-manual-frame" title="Manual de Biossegurança HMT em HTML" sandbox="" referrerpolicy="no-referrer"></iframe>`:''}</section>`;
  root.setAttribute('aria-busy',String(busy));
  const frame=root.querySelector('iframe');if(frame&&manual)frame.srcdoc=manual.html;
 }
 function invalidate(){generation++;manual=null;busy=false;error='Sua sessão mudou. Entre novamente para consultar o manual.';render();}
 const click=event=>{if(event.target.closest('[data-manual-back]'))onBack();};root.addEventListener('click',click);render();
 void(async()=>{
  const ticket=++generation;
  try{
   client=await clientFactory(user);if(disposed){client?.dispose();return;}
   if(!client.valid()){invalidate();return;}
   unsubscribe=client.subscribeInvalidated(invalidate);
   const result=await client.manual('GET_MANUAL',{});
   if(disposed||ticket!==generation)return;if(!client.valid()){invalidate();return;}
   if(!result||typeof result.html!=='string'||typeof result.documentCode!=='string'||typeof result.revision!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(result.issuedOn||''))throw Error('Não foi possível confirmar o conteúdo do manual.');
   manual=result;
  }catch(e){if(!disposed&&ticket===generation){manual=null;error=[401,403].includes(e.status)?'Sua sessão mudou. Entre novamente para consultar o manual.':e.message||'Não foi possível abrir o manual agora.';}}
  finally{if(!disposed&&ticket===generation){busy=false;render();}}
 })();
 const cleanup=()=>{disposed=true;generation++;unsubscribe();client?.dispose();manual=null;root.removeEventListener('click',click);root.replaceChildren();root.classList.remove('biosafety-manual-app');root.removeAttribute('aria-busy');};cleanup.goBack=()=>{onBack();return true;};return cleanup;
}
