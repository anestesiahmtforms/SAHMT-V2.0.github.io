import './dosimetry.css';
import {DOSIMETRY_YEARS,DOSIMETRY_MONTHS,isDosimetryYear} from './dosimetry-domain.js';
import {createVaccinationClient} from './vaccination-client.js';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calendar='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h2m4 0h2m-8 3h2"/></svg>';
export function mountDosimetry(root,{user,onBack=()=>{},clientFactory=createVaccinationClient}={}){
 let disposed=false,client,clientPromise,subscribed=false,unsubscribe=()=>{},generation=0,busy=false,year=null,record=null,error='';
 root.classList.add('dosimetry-app');
 const live=()=>!disposed&&root.isConnected&&client?.valid()!==false;
 function invalidate(){generation++;record=null;busy=false;error='Sua sessão mudou. Entre novamente para consultar seu histórico individual.';render();}
 function years(){if(disposed)return;generation++;year=null;record=null;busy=false;error=live()?'':'Sua sessão mudou. Entre novamente para consultar seu histórico individual.';render();}
 function render(){
  if(disposed)return;
  const alert=error?`<p class="dosimetry-alert" role="alert">${h(error)}</p>`:'';
  const content=year===null?`<div class="dosimetry-years">${DOSIMETRY_YEARS.map(value=>`<button type="button" class="primary-button dosimetry-year" aria-label="${value}" data-dose-year="${value}" ${error?'disabled':''}>${calendar}<span>${value}</span><span aria-hidden="true">›</span></button>`).join('')}</div>`:`${busy?'<p role="status">Buscando seu relatório individual…</p>':!record&&!error?'<p class="dosimetry-alert" role="status">Não há relatório de dosimetria vinculado ao seu cadastro para este ano. Solicite a conferência à Gestão de Pessoas.</p>':''}<table class="dosimetry-table" aria-label="Dosimetria mensal individual de ${year}"><thead><tr><th scope="col">Mês</th><th scope="col">Dosimetria (mSv)</th></tr></thead><tbody>${DOSIMETRY_MONTHS.map((month,i)=>{const value=record?.months?.find(m=>m.month===i+1);return `<tr><th scope="row">${String(i+1).padStart(2,'0')}/${year} <span>${month}</span></th><td data-dose-month="${i+1}" class="${value?.kind==='MISSING'||!value?'is-missing':''}">${h(value?.display||'Não disponível')}</td></tr>`;}).join('')}</tbody></table><p class="dosimetry-legend"><strong>ANR:</strong> abaixo do nível de registro (&lt; 0,1 mSv); não equivale a zero. Meses sem informação: “Não disponível”.</p>`;
  root.dataset.doseView=year===null?'years':'record';
  root.innerHTML=`<section class="dosimetry-panel"><header class="dosimetry-header"><h2>Meu Histórico de Dosimetria${year===null?'':` · ${year}`}</h2></header>${alert}${content}</section>`;
  root.setAttribute('aria-busy',String(busy));
 }
 async function load(selected){
  if(!live()||!isDosimetryYear(selected))return;
  year=selected;const ticket=++generation;busy=true;record=null;error='';render();
  try{
   if(!client)client=await(clientPromise??=clientFactory(user));
   if(!live()||ticket!==generation){if(disposed)client?.dispose();return;}
   if(!subscribed){unsubscribe=client.subscribeInvalidated(invalidate);subscribed=true;}
   const result=await client.dosimetry('GET_OWN',{year:selected});
   if(!live()||ticket!==generation)return;
   if(result.year!==selected||result.record&&result.record.year!==selected)throw Error('O relatório retornado não corresponde ao ano selecionado. Solicite a conferência à Gestão de Pessoas.');
   record=result.record||null;
  }catch(e){if(!client)clientPromise=null;if(!live()||ticket!==generation)return;if([401,403].includes(e.status)){invalidate();return;}error=e.message||'Não foi possível consultar seu relatório agora.';}
  finally{if(live()&&ticket===generation){busy=false;render();}}
 }
 const back=()=>{if(year!==null)years();else onBack();return true;};
 const click=event=>{const choice=event.target.closest('[data-dose-year]');if(choice&&!choice.disabled)void load(Number(choice.dataset.doseYear));if(event.target.closest('[data-dose-back]'))back();if(event.target.closest('[data-dose-refresh]')&&!busy)void load(year);};
 root.addEventListener('click',click);render();
 const cleanup=()=>{disposed=true;generation++;unsubscribe();client?.dispose();root.removeEventListener('click',click);record=null;root.replaceChildren();root.classList.remove('dosimetry-app');root.removeAttribute('aria-busy');delete root.dataset.doseView;};cleanup.goBack=back;return cleanup;
}
