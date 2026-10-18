import './demo.css';
import './training-state.css';
import {createDemoSession,DEMO_PERSONAS,DEMO_MODULES} from './demo-session.js';
const session=createDemoSession(),app=document.querySelector('#app');
const escape=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={schedule:'ESCALAS',events:'EVENTOS',labels:'ETIQUETAS',checklist:'CHECKLIST',management:'GESTÃO',training:'DESEMPENHO',notifications:'INFORMAÇÕES',occurrences:'REGISTRO DE OCORRÊNCIAS',people:'PESSOAS',qmentum:'INDICADORES QMENTUM',admin:'ADMINISTRAÇÃO'};
const icons={schedule:'📅',events:'📋',labels:'🏷️',checklist:'✓',management:'📚',training:'📊',notifications:'📢',occurrences:'📝',people:'👥',qmentum:'📈',admin:'⚙️'};
const fields={events:['Data','Posição na escala','Local','Procedimento'],labels:['Identificação fictícia','Procedimento','Observação'],occurrences:['Data','Setor','Tipo de ocorrência','Descrição','Encaminhamento'],qmentum:['Competência','Indicador','Numerador','Denominador','Análise crítica'],people:['Nome fictício','Função','Contato fictício'],notifications:['Título','Comunicado'],admin:['Nome fictício','Perfil','Permissões simuladas']};
let route='home',message='',openTraining=null,read=false;
const titles={'training-1':'Protocolo de demonstração','training-2':'Diretriz de demonstração'};
const button=(text,action,extra='')=>`<button type="button" class="demo-button training-state-button" data-action="${action}" ${extra}>${text}</button>`;
function frame(body){const profile=session.snapshot().profile;
 app.innerHTML=`<div class="demo-banner">DEMONSTRAÇÃO · DADOS FICTÍCIOS · NENHUMA GRAVAÇÃO REAL</div><main class="demo-wrap"><header class="demo-header"><img src="./assets/icon-192.png" alt="SAHMT"><h1>SAHMT · ${route==='home'?'DEMONSTRAÇÃO':escape(names[route] || 'TREINAMENTO')}</h1>${profile?`<p>${escape(profile.name)} · ${escape(profile.role)}</p><button class="secondary-button" type="button" data-action="switch">TROCAR PERFIL</button><button class="secondary-button" type="button" data-action="logout">SAIR DA DEMONSTRAÇÃO</button>`:''}</header>${message?`<p role="status" class="demo-status">${escape(message)}</p>`:''}${body}${profile?'<footer><button class="secondary-button" type="button" data-action="home">HOME</button><button class="secondary-button" type="button" data-action="reset">REINICIAR DADOS FICTÍCIOS</button></footer>':''}</main>`;
}
function trainingCards(){return `<p class="training-state-legend">Azul: disponível ou revisado · Amarelo: parcial ou resultado inferior a 50% · Verde: completo e pelo menos 50%. Repetições não duplicam pontos.</p><div class="demo-grid">${Object.entries(titles).map(([id,title])=>{const state=session.trainingState(id);return button(`${escape(title)}<small>${state.label} · versão ${session.snapshot().versions[id]}</small>`,'training',`data-id="${id}" data-training-state="${state.color}"`);}).join('')}</div>`;}
function render(){const state=session.snapshot();
 if(!state.persona){route='home';frame(`<section class="demo-panel"><h2>ESCOLHA O PERFIL DE TESTE</h2><p>Use dados fictícios. Os exercícios ficam somente na memória desta página; recarregar ou reiniciar descarta os registros. Não há login Google nem acesso à produção.</p><div class="demo-grid">${Object.entries(DEMO_PERSONAS).map(([key,value])=>button(escape(value.role),'login',`data-persona="${key}"`)).join('')}</div></section>`);return;}
 if(openTraining){renderTraining();return;}
 if(route==='home'){frame(`<section class="demo-panel"><div class="demo-grid">${DEMO_MODULES.filter(key=>key!=='admin'||state.persona==='admin').map(key=>button(`${icons[key]} ${names[key]}`,'route',`data-route="${key}"`)).join('')}</div></section>`);return;}
 if(route==='management'||route==='training'){
  frame(`<section class="demo-panel">${route==='training'?`<h2>Saldo fictício: ${state.points} pontos</h2>`:'<h2>GESTÃO DE DOCUMENTOS · ACESSO GERAL</h2>'}${trainingCards()}${state.persona==='admin'?`<h3>REVISÃO SIMULADA</h3>${Object.entries(titles).map(([id,title])=>button(`Publicar nova versão · ${escape(title)}`,'revision',`data-id="${id}"`)).join('<br>')}`:''}<p>Estes dois materiais e seus questionários são exemplos criados para treinamento. Nenhum documento ou Forms real é aberto.</p></section>`);return;}
 if(route==='schedule'){frame(`<section class="demo-panel"><h2>ESCALA FICTÍCIA DO DIA</h2><ol><li>Participante de demonstração · ESCALADO</li><li>Membro fictício B</li><li>Membro fictício C</li></ol><p>Exemplo para navegação. Não altera a escala da equipe.</p></section>`);return;}
 if(route==='checklist'){frame(`<section class="demo-panel"><h2>RELATÓRIO DIÁRIO · ARSENAIS FICTÍCIOS</h2><form data-checklist>${['Arsenal A','Arsenal B','Arsenal C'].map((title,index)=>`<label>${title}<select name="arsenal${index}"><option value="">Sem checagem</option><option>Conforme</option><option>Não conforme</option><option>Inativo</option></select></label>`).join('')}<button type="submit" class="primary-button">CONFERÊNCIA DO PRECEPTOR · SIMULAR</button></form>${records('checklist')}</section>`);return;}
 const config=fields[route];
 frame(`<section class="demo-panel"><h2>${escape(names[route])} · SIMULAÇÃO</h2>${route==='notifications'&&state.persona!=='admin'?'<p>Comunicado fictício: bem-vindo à demonstração SAHMT.</p>':`<form data-record="${route}">${(config || ['Descrição']).map((field,index)=>`<label>${escape(field)}<input name="field${index}" maxlength="500" required></label>`).join('')}<button type="submit" class="primary-button">${route==='admin'?'SIMULAR CONFIGURAÇÃO':'SIMULAR REGISTRO'}</button></form>`}${records(route)}</section>`);
}
function records(module){return `<h3>REGISTROS FICTÍCIOS DESTE PERFIL</h3>${(session.snapshot().records[module] || []).map(row=>`<article class="demo-record">${Object.entries(row).filter(([key])=>!['createdAt','simulated'].includes(key)).map(([key,value])=>`<p><strong>${escape(key)}</strong>: ${escape(value)}</p>`).join('')}<small>${new Date(row.createdAt).toLocaleString('pt-BR')} · Simulado</small></article>`).join('') || '<p>Nenhum registro simulado.</p>'}`;}
function renderTraining(){const id=openTraining,title=titles[id];frame(`<section class="demo-panel"><h2>${escape(title)}</h2><div class="demo-reader" tabindex="0"><h3>Material de apoio fictício</h3><p>Este exemplo apresenta o fluxo de leitura, ciência e perguntas. Na produção, cada item contém o material aprovado pela instituição e a versão correspondente.</p><p>O participante deve consultar o conteúdo e responder ao questionário. O resultado da primeira resposta validada na versão define os pontos. Refazer não adiciona pontos. Uma revisão publicada do material ou questões inicia outra versão.</p><p>As cores indicam a situação individual: azul para uma nova versão, amarelo para treinamento incompleto ou nota inferior a 50%, verde para todas as etapas concluídas com nota igual ou superior a 50%.</p><p>Fim do material fictício.</p></div><label><input type="checkbox" data-read ${read?'checked':''}> Concluí a leitura do exemplo</label><form data-quiz class="demo-quiz" ${read?'':'hidden'}>${['Qual cor indica uma versão revisada ainda não realizada?','Refazer a mesma versão gera novos pontos?'].map((question,index)=>`<label>${question}<select name="q${index}"><option value="">Selecione</option>${(index===0?['Azul','Verde','Amarelo']:['Não','Sim']).map(value=>`<option>${value}</option>`).join('')}</select></label>`).join('')}<label><input type="checkbox" name="ack"> Declaro ciência do material de demonstração</label><div class="demo-training-actions"><button type="button" class="secondary-button" data-action="partial">SALVAR PARCIAL · SIMULAR</button><button type="submit" class="primary-button">ENVIAR RESPOSTA · SIMULAR</button></div></form><br><button type="button" class="secondary-button" data-action="back">VOLTAR</button></section>`);}
app.addEventListener('click',event=>{const control=event.target.closest('[data-action]');if(!control)return;const action=control.dataset.action;message='';
 try{
  if(action==='login')session.login(control.dataset.persona);
  if(action==='logout'||action==='switch'){session.logout();openTraining=null;}
  if(action==='reset'){session.reset();route='home';openTraining=null;}
  if(action==='home'){route='home';openTraining=null;}
  if(action==='route')route=control.dataset.route;
  if(action==='training'){openTraining=control.dataset.id;read=false;}
  if(action==='revision'){session.reviseTraining(control.dataset.id);message='Nova versão fictícia publicada: o treinamento voltou a azul para os dois perfis.';}
  if(action==='back'){openTraining=null;}
  if(action==='partial'){session.attemptTraining(openTraining,{complete:false,score:0,maxScore:10,submitted:false});openTraining=null;message='Progresso parcial simulado. Nenhuma resposta enviada e nenhum ponto concedido.';}
 }catch{message='Ação indisponível neste perfil de demonstração.';}
 render();window.scrollTo({top:0,left:0,behavior:'instant'});
});
app.addEventListener('change',event=>{if(event.target.matches('[data-read]')){read=event.target.checked;render();}});
app.addEventListener('submit',event=>{event.preventDefault();const form=event.target;message='';
 try{
  const values=Object.fromEntries(new FormData(form));
  if(form.matches('[data-quiz]')){const complete=read&&values.ack==='on'&&Boolean(values.q0)&&Boolean(values.q1);const score=(values.q0==='Azul'?5:0)+(values.q1==='Não'?5:0);session.attemptTraining(openTraining,{complete,score,maxScore:10});openTraining=null;message='Resposta simulada. O saldo conserva os pontos da primeira resposta desta versão.';}
  else if(form.matches('[data-checklist]')){if(Object.values(values).some(value=>!value)){message='Conclua a checagem dos três arsenais fictícios antes da conferência.';render();return;}session.record('checklist',values);message='Conferência fictícia registrada.';}
  else{const module=form.dataset.record;const payload=Object.fromEntries(Object.entries(values).map(([key,value],index)=>[(fields[module] || ['Descrição'])[index],String(value).trim()]));session.record(module,payload);message='Registro apenas simulado. Nenhum dado foi enviado.';}
 }catch{message='Não foi possível simular esta ação.';}
 render();
});
// No Firebase/session/service worker bootstrapping, external links or network client.
render();
