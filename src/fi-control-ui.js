import {isValidDateKey} from './schedule-date.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const admin=p=>p?.role==='administrador_app'||p?.permissions?.admin===true;
const passiveLink=value=>{
 if(typeof value!=='string')return '';
 if(/^#\/(?:management|schedule|labels|checklist|communications|home)(?:\/[^\s<>"']*)?$/.test(value))return value;
 try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&['drive.google.com','docs.google.com'].includes(u.hostname)&&/^\/(?:file|document|spreadsheets|presentation)\/d\/[A-Za-z0-9_-]+\/preview$/.test(u.pathname))return u.href;}catch{}return '';
};
function previousMonth(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit'}).formatToParts(new Date()),year=Number(parts.find(p=>p.type==='year').value),month=Number(parts.find(p=>p.type==='month').value);return new Date(Date.UTC(year,month-2,1)).toISOString().slice(0,7);}
export function renderFiControl({profile={},pilot=false,searchOnly=false}={}){
 const home='<button type="button" data-fi-nav="home">Voltar à Home</button>';
 if(!searchOnly&&!admin(profile))return `<section class="fi-control"><p>Acesso reservado a administradores.</p>${home}</section>`;
 const title=searchOnly?'Buscar no ecossistema':'Central Administrativa';
 const navigation=!searchOnly&&!pilot?'<button type="button" data-fi-nav="people">Pessoas</button><button type="button" data-fi-nav="admin">Administração</button><button type="button" data-fi-nav="app-updates-control">Controle de atualizações</button>':'';
 const search=searchOnly||pilot?`<section class="fi-control-panel"><h2>Pesquisar no app</h2><p>Digite palavras-chave ou faça uma pergunta, como “Qual minha posição na escala amanhã?”. Materiais inativos aparecem em modo de consulta, conforme suas permissões.</p><form data-fi-search><label>O que você procura?<input name="query" type="search" maxlength="1000" required autocomplete="off" placeholder="Ex.: protocolo de segurança"></label><button type="submit">Pesquisar</button></form><p data-fi-status role="status" aria-live="polite"></p><div data-fi-results></div></section>`:'';
 const month=previousMonth();
 const monthly=!searchOnly?`<section class="fi-control-panel"><h2>Análise mensal e plano de ação</h2><p>Resultados dos indicadores e propostas para revisão da administração.</p><form data-fi-monthly><label>Mês de referência<input name="period" type="month" value="${month}" max="${month}" required></label><button type="submit">Gerar análise</button><button type="button" data-fi-history>Consultar análises</button></form><div data-fi-monthly-results aria-live="polite"></div></section>`:'';
 return `<section class="fi-control"><header class="fi-control-heading"><div><span class="fi-control-kicker">SAHMT · ${pilot?'PILOTO FI':searchOnly?'PESQUISA':'CENTRAL'}</span><h1>${title}</h1></div></header><nav class="fi-control-navigation" aria-label="Navegação">${navigation}${home}</nav>${search}${monthly}</section>`;
}
const isSearchPartial=data=>data?.coverage?.some(r=>r.status==='UNAVAILABLE')===true;
function renderScheduleAnswer(schedule){
 const day=isValidDateKey(schedule.day)?schedule.day:'';
 const date=day.split('-').reverse().join('/');
 const positions=Array.isArray(schedule.positions)?schedule.positions.filter(p=>Number.isSafeInteger(p)&&p>0):[];
 const messages={
  found:positions.length===1?`Sua posição na escala de ${date} é ${positions[0]}.`:`Suas posições na escala de ${date} são ${positions.join(', ')}.`,
  not_assigned:`Sua sigla não aparece na escala de ${date}.`,
  schedule_missing:`A escala de ${date} ainda não está disponível para consulta.`,
  date_required:'Informe uma data para consultar sua posição na escala. Você também pode usar “hoje” ou “amanhã”.',
  invalid_date:'Informe uma data válida por vez, no formato DD/MM/AAAA.',
  identity_unlinked:'A Escala precisa ter uma sigla ativa vinculada ao e-mail da sua conta para identificar sua posição.',
  forbidden:'Sua conta não tem permissão para consultar a Escala.',
  unavailable:'A Escala está temporariamente indisponível. Tente novamente.'
 };
 const message=Object.hasOwn(messages,schedule.status)?messages[schedule.status]:messages.unavailable;
 const link=day?`<a href="#/schedule/${day}">Abrir escala desta data</a>`:'';
 return `<section class="fi-answer" role="status"><h3>Escala</h3><p>${esc(message)}</p>${link}</section>`;
}
const pageSize=20;
const sourceNames={FB:'Gestão',FF:'Comunicados',FG:'Checklist',FH:'Etiquetas',FJ:'Escala e Eventos'};
export function renderFiResults(data,limit=pageSize){
 if(data?.schedule)return renderScheduleAnswer(data.schedule);
 const results=Array.isArray(data?.results)?data.results:[];
 const notes=(data?.coverage||[]).filter(r=>r.status==='CONTENT_NOT_INDEXED'||r.status==='INVOLVEMENT_MAPPING_REQUIRED'||r.status==='UNAVAILABLE').map(r=>r.detail||'Parte dos conteúdos está temporariamente indisponível.');
 const unique=[...new Set(notes)];
 const visible=results.slice(0,limit),total=Number.isSafeInteger(data?.totalMatches)?data.totalMatches:results.length;
 const summary=results.length?`Exibindo ${visible.length} de ${total} resultado(s) autorizado(s).`:isSearchPartial(data)?'Não houve resultados nas fontes consultadas.':'Nenhum resultado encontrado entre os materiais disponíveis para sua conta.';
 const more=visible.length<results.length?'<button type="button" data-fi-more>Ver mais resultados</button>':'';
 return `<p role="status">${summary}</p>${visible.map(r=>{const url=passiveLink(r.url),source=Object.hasOwn(sourceNames,r.source)?sourceNames[r.source]:'';return `<article class="fi-result" tabindex="-1"><h3>${esc(r.title)}</h3>${source?`<p class="fi-muted">${source}</p>`:''}${r.readOnly?'<span class="fi-readonly">Inativo — somente consulta</span>':''}<p>${esc(r.snippet)}</p>${url?`<a href="${esc(url)}"${url.startsWith('https:')?' target="_blank" rel="noopener noreferrer"':''}>Abrir material para consulta</a>`:'<p class="fi-muted">Somente a descrição está disponível neste resultado.</p>'}</article>`;}).join('')}${more}${unique.map(note=>`<p class="fi-muted">${esc(note)}</p>`).join('')}`;
}
function renderMonthly(result){
 if(result.status!=='complete')return `<p role="status">${esc(({incomplete:'Ainda faltam dados consolidados desta competência. Não foram estimados valores ausentes.',disabled:'A síntese por IA aguarda configuração.',budget_exhausted:'O orçamento de IA disponível foi atingido.',running:'Esta análise já está em processamento.',lease_expired:'A janela desta execução terminou. Consulte as análises ou tente novamente.',failed:'Não foi possível gerar a análise. A última versão concluída foi preservada.'})[result.status]||'Nenhuma análise disponível.')}</p>`;
 const r=result.report;return `<article class="fi-monthly-report"><h3>${esc(result.period)} · Proposta para revisão</h3><p>${esc(r.summary)}</p><div class="fi-table-scroll"><table><thead><tr><th>Ação</th><th>Prioridade</th><th>Responsável sugerido</th><th>Prazo sugerido</th><th>Critério de sucesso</th></tr></thead><tbody>${r.actions.map(a=>`<tr><td>${esc(a.action)}</td><td>${esc(a.priority)}</td><td>${esc(a.ownerSuggested)}</td><td>${esc(a.dueSuggested)}</td><td>${esc(a.successMetric)}</td></tr>`).join('')}</tbody></table></div>${r.technicalRecommendations?.length?'<h4>Melhorias técnicas sugeridas</h4>'+r.technicalRecommendations.map(a=>`<p>${esc(a.proposal)}<br>Validação: ${esc(a.validation)}</p>`).join(''):''}</article>`;
}
export function mountFiControl(host,{request,isCurrent=()=>true,onNavigate=()=>{},profile={},pilot=false,searchOnly=false}){
 host.innerHTML=renderFiControl({profile,pilot,searchOnly});let disposed=false,searchGeneration=0,monthlyGeneration=0;
 const current=()=>!disposed&&isCurrent(),search=host.querySelector('[data-fi-search]'),status=host.querySelector('[data-fi-status]');
 const resultHost=host.querySelector('[data-fi-results]');
 let found=null,visible=pageSize;
 resultHost?.addEventListener('click',event=>{
  if(!current()||!found||!event.target.closest('[data-fi-more]'))return;
  const firstNew=visible;
  visible+=pageSize;
  resultHost.innerHTML=renderFiResults(found,visible);
  resultHost.querySelectorAll('.fi-result')[firstNew]?.focus();
 });
 host.querySelectorAll('[data-fi-nav]').forEach(button=>button.addEventListener('click',()=>{if(current())onNavigate(button.dataset.fiNav);}));
 search?.addEventListener('submit',async event=>{
  event.preventDefault();if(!current())return;const ticket=++searchGeneration,button=search.querySelector('button');button.disabled=true;status.textContent='Pesquisando conteúdos autorizados…';
  found=null;visible=pageSize;resultHost.replaceChildren();
  try{const result=await request('search',{query:search.elements.query.value});if(!current()||ticket!==searchGeneration)return;found=result;resultHost.innerHTML=renderFiResults(found,visible);status.textContent=result.schedule?'':isSearchPartial(result)?'Pesquisa parcial. Algumas fontes não puderam ser consultadas.':'Pesquisa concluída.';}
  catch(error){if(current()&&ticket===searchGeneration)status.textContent=['FI_DAILY_REQUEST_LIMIT','FI_SOURCE_READ_BUDGET'].includes(error.code||error.message)?'O limite diário de consultas foi atingido. Tente novamente amanhã.':'Não foi possível pesquisar. Confira sua conexão e tente novamente.';}
  finally{if(current()&&ticket===searchGeneration)button.disabled=false;}
 });
 const monthly=host.querySelector('[data-fi-monthly]'),target=host.querySelector('[data-fi-monthly-results]');
 monthly?.addEventListener('submit',async event=>{event.preventDefault();if(!current())return;const ticket=++monthlyGeneration,button=monthly.querySelector('[type="submit"]'),history=host.querySelector('[data-fi-history]');button.disabled=true;history.disabled=true;target.textContent='Preparando a análise mensal…';try{const result=await request('monthly.generate',{period:monthly.elements.period.value,requestId:crypto.randomUUID()});if(current()&&ticket===monthlyGeneration)target.innerHTML=renderMonthly(result);}catch{if(current()&&ticket===monthlyGeneration)target.textContent='Não foi possível consultar os indicadores desta competência.';}finally{if(current()&&ticket===monthlyGeneration){button.disabled=false;history.disabled=false;}}});
 host.querySelector('[data-fi-history]')?.addEventListener('click',async()=>{if(!current())return;const ticket=++monthlyGeneration,submit=monthly.querySelector('[type="submit"]'),history=host.querySelector('[data-fi-history]');submit.disabled=true;history.disabled=true;target.textContent='Consultando análises…';try{const rows=await request('monthly.list',{});if(current()&&ticket===monthlyGeneration)target.innerHTML=rows.length?rows.map(r=>renderMonthly(r.result)).join(''):'<p>Nenhuma análise mensal concluída.</p>';}catch{if(current()&&ticket===monthlyGeneration)target.textContent='Não foi possível consultar as análises.';}finally{if(current()&&ticket===monthlyGeneration){submit.disabled=false;history.disabled=false;}}});
 return ()=>{disposed=true;found=null;searchGeneration++;monthlyGeneration++;host.replaceChildren();};
}
