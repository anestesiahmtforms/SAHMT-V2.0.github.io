import './style.css';
import './stress.css';
import {DIMENSIONS,QUESTIONS,SCALE,GROUPS,VERSION,CYCLE,calculate,validateSubmission} from '../stress-domain/schema.js';
import {GUIDANCE,SAFETY_NOTE,LIMITATION} from '../stress-domain/guidance.js';
import {send} from './stress-transport.js';
const app=document.querySelector('#app');
app.innerHTML=`<header><p class="eyebrow">SAHMT · SAÚDE E BEM-ESTAR</p><h1>Estresse e fadiga no trabalho</h1><p>Autoavaliação de sinais de fadiga e sobrecarga · últimos 7 dias · 5–8 minutos</p></header>
<section class="notice"><h2>Antes de responder</h2><p>Considere os últimos 7 dias e escolha a frequência de cada experiência. As 30 respostas são necessárias para calcular a pontuação de 0 a 150. Nenhuma pergunta solicita nome, e-mail ou login.</p><p>${LIMITATION}</p><p>Participação voluntária. Sua pontuação individual será mostrada nesta página; o painel de gestão exibe apenas relatórios agregados após o encerramento, com proteção de grupos pequenos. Dados brutos ficam restritos ao acesso técnico autorizado. A infraestrutura pode gerar registros técnicos e metadados; não há garantia de anonimato absoluto. O rascunho e o resultado não são guardados neste aparelho após sair da página.</p></section>
<form><label class="consent"><input name="consent" type="checkbox" required> Li as informações e concordo em participar voluntariamente.</label>
<label class="profile">Grupo e atividade (obrigatório)<select name="group" required><option value="" selected disabled>Selecione seu grupo</option>${Object.entries(GROUPS).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><p>Os resultados das duas secretárias não serão divulgados isoladamente. Outros recortes podem ser protegidos para impedir deduções por diferença.</p>
<p id="progress" role="status"></p>${DIMENSIONS.map(d=>`<section><h2>${d.label}</h2>${QUESTIONS.filter(q=>q.dimension===d.id).map(q=>`<fieldset><legend>${q.id}. ${q.text}</legend><div class="options">${SCALE.map(([value,label])=>`<label><input type="radio" name="${q.id}" value="${value}" required><span>${value} · ${label}</span></label>`).join('')}</div></fieldset>`).join('')}</section>`).join('')}
<section><h2>Estresse percebido (opcional)</h2><label>Nos últimos 7 dias, quão intenso foi o estresse relacionado ao trabalho?<select name="stress_rating"><option value="">Prefiro deixar esta pergunta sem resposta</option>${Array.from({length:11},(_,i)=>`<option value="${i}">${i}${i===0?' — nenhum estresse':i===10?' — intensidade máxima':''}</option>`).join('')}</select></label><p>Essa medida de 0 a 10 é apresentada separadamente e não altera a pontuação de fadiga.</p></section>
<p>Pedimos um envio por pessoa neste ciclo. O link sem login não permite garantir unicidade; reenvios nesta mesma página usam o mesmo código aleatório.</p><button type="submit" class="primary">Calcular meu resultado e enviar</button><p id="form-status" role="status"></p></form><section id="result" hidden tabindex="-1"></section>`;
const form=app.querySelector('form'),resultHost=app.querySelector('#result'),status=app.querySelector('#form-status');
const token=[...crypto.getRandomValues(new Uint8Array(16))].map(n=>n.toString(16).padStart(2,'0')).join('');
let payload=null,sending=false;
form.addEventListener('change',()=>{app.querySelector('#progress').textContent=`${QUESTIONS.filter(q=>form.querySelector(`input[name="${q.id}"]:checked`)).length} de 30 itens respondidos.`;});
function showResult(result){
 const guidance=GUIDANCE[result.band];
 resultHost.hidden=false;resultHost.replaceChildren();
 const heading=document.createElement('h2');heading.textContent='Seu resultado de autoavaliação';
 const total=document.createElement('p');total.className='stress-score';total.textContent=`${result.total} / 150 pontos`;
 const band=document.createElement('p');band.className='stress-band';band.textContent=`${result.bandLabel} — faixa institucional`;
 const summary=document.createElement('p');summary.textContent=guidance.summary;
 const list=document.createElement('ul');for(const text of guidance.actions){const item=document.createElement('li');item.textContent=text;list.append(item);}
 resultHost.append(heading,total,band,summary,list);
 for(const d of result.dimensions){const p=document.createElement('p');p.textContent=`${d.label}: ${d.score}/${d.maximum}`;resultHost.append(p);}
 if(result.stressRating!==undefined){const p=document.createElement('p');p.textContent=`Estresse percebido: ${result.stressRating}/10 — medida separada da fadiga.`;resultHost.append(p);}
 const safety=document.createElement('p');safety.className='notice';safety.textContent=SAFETY_NOTE;
 const limits=document.createElement('p');limits.textContent=LIMITATION;
 const link=document.createElement('a');link.href='/stress-orientacoes.html';link.target='_blank';link.rel='noopener noreferrer';link.referrerPolicy='no-referrer';link.textContent='Ver todas as orientações e documentos do SAHMT';
 const receipt=document.createElement('p');receipt.id='stress-receipt';receipt.setAttribute('role','status');receipt.setAttribute('aria-live','polite');
 const retry=document.createElement('button');retry.type='button';retry.id='stress-retry';retry.textContent='Tentar enviar novamente';retry.hidden=true;retry.onclick=submitPayload;
 resultHost.append(safety,limits,link,receipt,retry);resultHost.focus();resultHost.scrollIntoView({behavior:'smooth',block:'start'});
}
async function submitPayload(){
 if(sending)return;sending=true;
 const receipt=document.querySelector('#stress-receipt'),retry=document.querySelector('#stress-retry');retry.hidden=true;receipt.textContent='Seu resultado já está disponível. Enviando a resposta sem identificação…';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{await send(payload,controller.signal);receipt.textContent='Resposta recebida. Guarde suas orientações se desejar; esta página não salva seu resultado no aparelho.';payload=null;}
 catch(error){receipt.textContent=error.message==='NOT_ACCEPTED'?'Seu resultado permanece disponível. O envio não foi aceito; o ciclo pode estar fechado.':'Seu resultado permanece disponível. Não foi possível confirmar o envio. Você pode tentar reenviar o mesmo conteúdo sem recarregar a página.';retry.hidden=error.message==='NOT_ACCEPTED';}
 finally{clearTimeout(timer);sending=false;}
}
form.addEventListener('submit',event=>{
 event.preventDefault();if(payload||sending)return;
 try{const data=new FormData(form),answers={};for(const q of QUESTIONS){const value=data.get(q.id);if(value===null||value==='')throw Error('COMPLETE_ALL_30');answers[q.id]=Number(value);}
 const rating=data.get('stress_rating');payload=validateSubmission({survey_cycle:CYCLE,survey_version:VERSION,submission_id:token,group:data.get('group'),answers,...(rating!==null&&rating!==''?{stress_rating:Number(rating)}:{})});
 const result=calculate(payload.answers,payload.stress_rating);form.hidden=true;showResult(result);submitPayload();
 }catch{payload=null;status.textContent='Selecione o grupo e responda os 30 itens para calcular o resultado.';}
});
