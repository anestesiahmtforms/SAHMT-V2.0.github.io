import {dosimetryMonths} from './dosimetry-domain.js';
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountFunctionalDosimetry(root,{subjectUid,request,isCurrent=()=>true,now=()=>new Date()}={}){
 let disposed=false,year=now().getFullYear(),generation=0;
 const live=()=>!disposed&&isCurrent()&&root.isConnected;
 function render(record,message=''){if(!live())return;const years=Array.from({length:Math.max(now().getFullYear()+1,2027)-2025+1},(_,i)=>2025+i).reverse();
 root.innerHTML='<section class="functional-dosimetry"><label class="functional-result-year">Ano <select aria-label="Ano" data-fk-dose-year>'+years.map(y=>'<option '+(y===year?'selected':'')+'>'+y+'</option>').join('')+'</select></label><p role="status">'+h(message)+'</p><dl class="functional-result-list">'+dosimetryMonths(record?.values||Array(12).fill(null)).map(m=>'<div><dt>'+h(m.label)+'</dt><dd>'+h(m.display)+(m.kind==='MEASURED'?' mSv':'')+'</dd></div>').join('')+'</dl><p class="functional-dose-note">ANR: abaixo do nível de registro; não equivale a zero.</p></section>';}
 async function load(){const ticket=++generation;render(null,'Consultando…');try{const r=await request({operation:'GET',subjectUid,year});if(live()&&ticket===generation){if(r.uid!==subjectUid||r.year!==year)throw Error();render(r.record,r.record?'':'Nenhum registro disponível para este ano.');}}catch{if(live()&&ticket===generation)render(null,'Não foi possível consultar a dosimetria. Selecione o ano para tentar novamente.');}}
 const change=e=>{if(live()&&e.target.matches('[data-fk-dose-year]')){year=Number(e.target.value);void load();}};
 root.addEventListener('change',change);void load();return()=>{disposed=true;generation++;root.removeEventListener('change',change);root.replaceChildren();};
}
