import './html-training.css';
import { deployment } from './deployment-context.js';
import { escapeHtml as h, canManageTraining, isTrainingAdmin, readerDocument } from './html-training-model.js';
import { mountTrainingAudit } from './html-training-audit.js';
import {trainingCategories,trainingFolderLevel} from './html-training-folders.js';
import {renderTrainingDocumentCard} from './html-training-card.js';
import {htmlTrainingActivityState, loadHtmlTrainingDocument, hydrateHtmlTrainingActivities} from './html-training-activity.js';

const categories = trainingCategories;
const uuid = () => globalThis.crypto.randomUUID();
const button = (action, label, extra='') => `<button type="button" data-ht="${action}" ${extra}>${label}</button>`;
const field = (name,label,value='',type='text',extra='') => `<label class="ht-field">${h(label)}<input name="${h(name)}" type="${type}" value="${h(value)}" ${extra}></label>`;
const area = (name,label,value='',extra='') => `<label class="ht-field">${h(label)}<textarea name="${h(name)}" ${extra}>${h(value)}</textarea></label>`;

export async function createHtmlTrainingClient(user) {
  if (deployment.target !== 'FB' || deployment.projectId !== 'sahmt-gestao-5ae66') throw new Error('Treinamentos disponíveis somente no ambiente FB.');
  const endpoint = String(import.meta.env.VITE_HTML_TRAINING_ENDPOINT || '').trim();
  if (!endpoint) throw new Error('Treinamentos indisponíveis: o serviço HTML ainda não foi configurado neste ambiente.');
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' && !(['localhost','127.0.0.1'].includes(url.hostname) && import.meta.env.DEV)) throw new Error('Endereço do serviço de treinamentos inválido.');
  const [{ auth },{onAuthStateChanged}] = await Promise.all([import('./firebase-auth.js'),import('firebase/auth')]);
  const valid = () => auth?.currentUser?.uid === user.uid && auth.app?.options?.projectId === 'sahmt-gestao-5ae66';
  return {
    valid,
    subscribeInvalidated(callback) { return onAuthStateChanged(auth,()=>{if(!valid())callback();}); },
    async api(action,input) {
      if (!valid()) throw Object.assign(new Error('Sua sessão mudou. Entre novamente.'),{code:'SESSION_CHANGED'});
      const token = await auth.currentUser.getIdToken();
      if (!valid()) throw Object.assign(new Error('Sua sessão mudou.'),{code:'SESSION_CHANGED'});
      const response = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({action,input}),cache:'no-store',credentials:'omit'});
      if (!valid()) throw Object.assign(new Error('Sua sessão mudou.'),{code:'SESSION_CHANGED'});
      const data = await response.json();
      if (!response.ok) throw Object.assign(new Error(data.message || 'Não foi possível concluir a operação.'),{code:data.code || data.error?.code,status:response.status});
      return data;
    }
  };
}

/** Mount returns cleanup immediately, including while startup/auth is pending. */
export function mountHtmlTrainings(root, {user,profile={},api:providedApi} = {}) {
  let alive=true, revision=0, api=providedApi, valid=()=>true, auditCleanup=null, unsubscribe=null, busy=false, operationId=0;
  let catalog=[], active=null, state=null, questions=[], content=null, editor=null, mode='catalog', error='', notice='', folderPath=[], readIndex=0, confirm=false, answers={}, suggestion='', submitRequest=null, editorParent='catalog';
  const uid=user?.uid, activityStates=new Map();
  let progressGeneration=0;
  const activityFor=training=>{const entry=activityStates.get(training.id);return htmlTrainingActivityState(training,entry?.version===training.version?entry.state:null,uid);};
  function refreshVisibleActivities(){
    const token=revision,generation=++progressGeneration;
    const visible=trainingFolderLevel(catalog,folderPath).trainings.filter(t=>t.status==='PUBLISHED');
    const validProgress=()=>current(token)&&mode==='catalog'&&generation===progressGeneration;
    const paint=(training,activity)=>{for(const b of root.querySelectorAll('[data-ht="open"]'))if(b.dataset.id===training.id){b.dataset.activityState=activity.color;b.setAttribute('aria-description',activity.label);const status=b.querySelector('.ht-document-status');if(status)status.textContent=activity.label;const icon=b.querySelector('.ht-document-chevron');if(icon)icon.textContent=activity.complete?'✓':'↗';}};
    void hydrateHtmlTrainingActivities({trainings:visible,isCurrent:validProgress,read:t=>call('OPEN',{trainingId:t.id},token),
      onResult(training,result){if(result.training.version!==training.version)return;activityStates.set(training.id,{version:training.version,state:result.state});paint(training,activityFor(training));},
      onError(training){activityStates.delete(training.id);paint(training,{...htmlTrainingActivityState(training),label:'Atividades ainda não confirmadas'});}});
  }
  const current = token => alive && root.isConnected && token===revision && user?.uid===uid && valid();
  const stop = () => {alive=false;revision++;progressGeneration++;activityStates.clear();unsubscribe?.();auditCleanup?.();auditCleanup=null;root.classList.remove('html-trainings','ht-reading','ht-catalog-view');root.removeAttribute('aria-busy');root.replaceChildren();};
  async function call(action,input={},token=revision) {
    if(!current(token))throw Object.assign(new Error('Sua sessão mudou. Entre novamente.'),{code:'SESSION_CHANGED'});
    const result=await api(action,input);
    if(!current(token)) throw Object.assign(new Error('Resposta de sessão encerrada.'),{code:'STALE_RESPONSE'});
    return result;
  }
  function fail(err) {
    if(!alive || err?.code==='STALE_RESPONSE') return;
    if(mode==='opening'){mode='catalog';active=null;content=null;state=null;}
    if(err?.status===401 || err?.status===403 || ['SESSION_CHANGED','FORBIDDEN','UNAUTHORIZED','ACCESS_DENIED'].includes(err?.code)) {
      revision++;progressGeneration++;activityStates.clear();active=null;content=null;editor=null;questions=[];state=null;catalog=[];mode='denied';
      auditCleanup?.();auditCleanup=null;
    }
    error=err?.code==='VERSION_CHANGED'?'O treinamento foi atualizado. Reabra o item para continuar a versão atual; nenhuma tentativa foi consumida.':err?.code==='VERSION_CONFLICT'?'Outro acesso alterou este registro. Reabra o treinamento para carregar a versão atual antes de salvar.':err?.message || 'O serviço não respondeu. Tente novamente.';
    render();
  }
  async function perform(fn) {
    if(busy) return;
    const operation=++operationId; busy=true; error=''; renderBusy();
    try {await fn();} catch(err){if(operation===operationId)fail(err);} finally {if(operation===operationId){busy=false;if(alive)renderBusy();}}
  }
  function goBack(){
    if(!current(revision))return false;
    // Leaving a pending read invalidates its response without trapping the modal.
    if(busy){revision++;operationId++;busy=false;if(mode==='opening'||mode==='participant'){mode='catalog';active=null;state=null;content=null;}render();if(mode==='catalog')refreshVisibleActivities();return true;}
    if(mode==='editor'){mode=editorParent;editor=null;error='';render();if(mode==='catalog')refreshVisibleActivities();return true;}
    if(mode!=='catalog'&&mode!=='denied'){void perform(loadCatalog);return true;}
    if(mode==='catalog'&&folderPath.length){folderPath=folderPath.slice(0,-1);render();refreshVisibleActivities();return true;}
    return false;
  }
  function renderBusy(){root.setAttribute('aria-busy',String(busy));root.querySelectorAll('button[data-ht]').forEach(b=>{if(!b.dataset.locked)b.disabled=busy&&b.dataset.ht!=='back';});}
  function top(){
    if(mode==='catalog'){
      const titles={Protocolos:'PROTOCOLOS',Diretrizes:'DIRETRIZES',ROPs:'ROPs','Documentos administrativos':'Documentos Administrativos'};
      const title=folderPath.length?(titles[folderPath[0]]||folderPath[0]):'Gestão de Documentos';
      return `<header class="ht-head"><div><h2>${h(title)}</h2></div></header>`;
    }
    return `<header class="ht-head"><div><p class="ht-eyebrow">ACERVO INSTITUCIONAL · FB</p><h2>${h(active?.title || 'Treinamentos')}</h2><p>Leitura · Avaliação · Sugestão</p></div>${mode!=='denied'?button('back','VOLTAR','class="ht-secondary"'):''}</header>`;
  }
  function catalogue(){
    const level=trainingFolderLevel(catalog,folderPath),visible=level.trainings;
    const folderButton=(path,label,extra='')=>button('folder',label,`data-folder="${h(JSON.stringify(path))}" ${extra}`);
    const book='<span class="ht-book-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5C8 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-2-1-6-2-10 1Zm0 0v15M6 8h3M6 12h3m6-4h3m-3 4h3"/></svg></span>';
    const folders=level.folders.map(folder=>folderButton(folder.path,`${book}<span class="ht-folder-copy"><strong>${h(folder.name)}</strong></span><span class="ht-folder-arrow" aria-hidden="true">›</span>`,'class="ht-folder ht-navigation-book"')).join('');
    const documents=visible.map(t=>renderTrainingDocumentCard(t,{canManage:canManageTraining(t,user,profile),activity:activityFor(t)})).join('');
    const count=level.folders.length+visible.length;
    const grid=count?`<div class="ht-browser-grid ht-folders${visible.length?' ht-catalog':''}" style="--ht-grid-rows:${Math.ceil(count/2)}" role="group" aria-label="Pastas e documentos">${folders}${documents}</div>`:'<div class="ht-empty"><h3>Nenhum documento disponível nesta pasta</h3><p>Somente os materiais autorizados para seu perfil aparecem aqui.</p></div>';
    return (folderPath.length?`<div class="ht-folder-toolbar">${folderButton(folderPath.slice(0,-1),'VOLTAR','class="ht-secondary"')}</div>`:'')+grid;
  }
  function summary(){const attempts=state?.attempts?.length || 0;return `<div class="ht-summary"><span><b>${attempts}/2</b> tentativas concluídas</span><span><b>${h(state?.bestScore ?? 0)}</b> maior nota</span><span><b>${h(state?.ackPoints ?? 0)}</b> ponto de ciência</span></div>`;}
  function manageBar(){return canManageTraining(active,user,profile)?`<aside class="ht-management">${button('edit','Editar treinamento',`data-id="${h(active.id)}" class="ht-secondary"`)}${active.hasAudit?`<div class="ht-audit-banner"><div><strong>Auditoria desta ROP</strong><p>Instrumento operacional vinculado ao tema. A conclusão não concede pontos.</p></div>${button('audit','Realizar auditoria')}</div>`:''}</aside>`:'';}
  function readingView(){
    const sections=content?.sections||[],section=sections[readIndex];if(!section)return '';
    const reading=state?.run?.stage==='READING';
    return `<section class="ht-panel ht-reader"><div class="ht-reading-head"><div><span class="ht-eyebrow">LEITURA · SEÇÃO ${readIndex+1} DE ${sections.length}</span><h3>${h(section.title||'Conteúdo')}</h3></div></div><iframe class="ht-content-frame" title="Conteúdo protegido do treinamento" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe><div class="ht-actions">${readIndex>0?button('previous','← Seção anterior','class="ht-secondary"'):''}${reading?button('read',readIndex<(state.run.readCount||0)?'Próxima seção →':'Li esta seção e desejo continuar'):readIndex<sections.length-1?button('browse-next','Próxima seção →','class="ht-secondary"'):''}</div></section>`;
  }
  function participation(){
    const run=state?.run, attempts=state?.attempts?.length||0;
    let view='';
    if(!run || run.stage==='COMPLETED')view=attempts?`<section class="ht-panel"><h3>Resultado registrado</h3><p>A maior nota é preservada. Para a pasta ficar verde, conclua leitura, avaliação e sugestão e alcance a nota máxima.</p>${attempts<2?button('begin','Iniciar segunda tentativa'):'<p>As duas tentativas deste treinamento foram concluídas.</p>'}</section>`:error?`<section class="ht-panel">${button('begin','Retomar registro da leitura')}</section>`:'<p class="ht-muted" role="status">Preparando o registro da leitura…</p>';
    else if(run.stage==='READING')view='';
    else if(run.stage==='ACK')view=`<section class="ht-panel"><h3>Ciência da leitura</h3><p>Você percorreu todas as seções. Este registro não comprova compreensão do conteúdo.</p><label class="ht-check"><input type="checkbox" name="ack"> Declaro ciência da leitura integral deste treinamento.</label>${button('ack','Confirmar ciência e ir à avaliação')}</section>`;
    else if(run.stage==='QUIZ')view=`<form class="ht-panel" data-quiz><span class="ht-eyebrow">AVALIAÇÃO · CINCO QUESTÕES</span><h3>Responda antes de continuar</h3>${questions.map((q,i)=>`<fieldset class="ht-question"><legend>${i+1}. ${h(q.stem)} <small>(${h(q.points)} ponto(s))</small></legend>${q.options.map(o=>`<label class="ht-option"><input type="radio" name="${h(q.id)}" value="${h(o.id)}" ${answers[q.id]===o.id?'checked':''} required>${h(o.text)}</label>`).join('')}</fieldset>`).join('')}${button('quiz','Continuar para sugestões')}</form>`;
    else if(run.stage==='SUGGESTIONS')view=`<section class="ht-panel"><span class="ht-eyebrow">SUGESTÃO · TERCEIRA ATIVIDADE</span><h3>Como podemos melhorar este material?</h3>${area('suggestion','Sua sugestão',suggestion,'maxlength="6000"')}<p>Envie uma sugestão para concluir as três atividades. A pontuação da sugestão depende da análise do responsável.</p>${confirm?`<div class="ht-confirm" role="group" aria-label="Confirmação do envio"><h4>Confirmar o envio da tentativa ${attempts+1} de 2?</h4><p>As cinco respostas serão registradas. Esta confirmação consome uma tentativa.</p>${!suggestion.trim()?'<p>Sem sugestão, a pasta permanecerá amarela.</p>':''}${button('submit','Confirmar e enviar tentativa')}${button('cancel-confirm','Revisar sugestão','class="ht-secondary"')}</div>`:button('confirm','Revisar envio final')}</section>`;
    return readingView()+view+summary()+manageBar();
  }
  function editorView(){
    const e=editor,t=e.training,admin=isTrainingAdmin(profile);
    return `<form class="ht-editor" data-editor><div class="ht-editor-toolbar"><span class="ht-eyebrow">EDIÇÃO · VERSÃO ${h(t.version)}</span>${button('draft','Salvar rascunho','class="ht-secondary"')}${button('publish','Publicar treinamento')}</div><p class="ht-muted">A publicação usa a versão atual para detectar conflitos. O banco completo é preservado; selecione cinco questões.</p>${t.source?.pendingReviewPublication?'<p class="ht-notice">Publicado por decisão administrativa. A revisão institucional continua pendente e pode ser concluída neste editor.</p>':''}${t.source?.pendingInstitutionalReview?'<label class="ht-check ht-notice"><input name="institutionalReviewConfirmed" type="checkbox"> Conferi as pendências e as referências institucionais deste material para publicação.</label>':''}<div class="ht-form-grid">${field('title','Título',t.title)}<label class="ht-field">Categoria<select name="category">${categories.map(c=>`<option${c===t.category?' selected':''}>${h(c)}</option>`).join('')}</select></label>${field('subcategory','Subcategoria',t.subcategory)}<label class="ht-field">Público<select name="audienceGroup"><option value="GENERAL"${t.audienceGroup==='GENERAL'?' selected':''}>Geral</option><option value="RESTRICTED"${t.audienceGroup==='RESTRICTED'?' selected':''}>Restrito</option></select></label>${admin?field('managerUid','UID do gestor (opcional; vazio mantém com o administrador)',t.managerUid):`<p>Gestor responsável: ${h(t.managerUid || 'Administrador')}</p>`}</div><h3>Conteúdo</h3>${e.sections.map((s,i)=>`<section class="ht-panel">${field(`section-title-${i}`,'Título da seção',s.title)}<div class="ht-format" role="toolbar" aria-label="Formatação da seção ${i+1}">${[['bold','Negrito'],['italic','Itálico'],['insertUnorderedList','Lista'],['formatBlock','Título']].map(([c,l])=>button('format',l,`data-index="${i}" data-command="${c}" class="ht-secondary"`)).join('')}</div><iframe class="ht-edit-frame" title="Editor de conteúdo da seção ${i+1}" data-section="${i}" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe></section>`).join('')}${button('add-section','+ Adicionar seção','class="ht-secondary"')}<h3>Banco completo de questões</h3><p>Selecione exatamente cinco. As questões desmarcadas permanecem no banco.</p>${e.bank.map((q,i)=>`<fieldset class="ht-panel ht-bank"><legend>Questão ${i+1}</legend><label class="ht-check"><input type="checkbox" data-selected="${h(q.id)}"${e.selectedQuestionIds.includes(q.id)?' checked':''}> Incluir na avaliação</label>${area(`stem-${i}`,'Enunciado',q.stem)}${field(`points-${i}`,'Pontos',q.points,'number','min="0" max="100" step="0.01"')}${q.options.map((o,j)=>`<div class="ht-bank-option"><label class="ht-check"><input type="radio" name="correct-${i}" value="${h(o.id)}"${q.correctOptionId===o.id?' checked':''}>Correta</label>${field(`option-${i}-${j}`,`Alternativa ${j+1}`,o.text)}</div>`).join('')}${area(`comment-${i}`,'Comentário do gabarito',q.comment)}</fieldset>`).join('')}${button('add-question','+ Adicionar questão ao banco','class="ht-secondary"')}<h3>Sugestões recebidas</h3><p>Concessão manual única, de 0 a 2. Correções administrativas substituem o registro vigente.</p>${(e.suggestions||[]).map((s,i)=>`<section class="ht-panel"><h4>${h(s.uid)}</h4>${(s.attempts||[]).filter(a=>a.suggestion).map(a=>`<blockquote>${h(a.suggestion)}</blockquote>`).join('')||'<p>Sem sugestão registrada.</p>'}${s.suggestionDecision?`<p>Decisão vigente: ${h(s.suggestionDecision.points)} ponto(s) · ${h(s.suggestionDecision.note)}</p>`:''}${s.uid===uid?'<p>A pontuação da própria sugestão não é permitida.</p>':s.suggestionDecision&&!admin?'<p>Decisão registrada. Correções são exclusivas do administrador.</p>':`${field(`review-points-${i}`,'Pontos',s.suggestionDecision?.points??0,'number','min="0" max="2" step="0.5"')}${area(`review-note-${i}`,'Justificativa da decisão',s.suggestionDecision?.note)}${button('review',s.suggestionDecision?'Corrigir decisão':'Registrar decisão',`data-index="${i}" class="ht-secondary"`)}`}</section>`).join('')||'<p>Nenhuma sugestão recebida.</p>'}<p class="ht-muted">Referências no Drive: ${h(t.sync?.status || t.syncStatus || 'estado de sincronização não informado pelo serviço')}. Publicar no PWA não indica sincronização concluída.</p></form>`;
  }
  function render(){
    if(!alive)return;
    root.classList.add('html-trainings');
    root.classList.toggle('ht-reading',mode==='participant'&&Boolean(content?.sections?.length));
    root.classList.toggle('ht-catalog-view',mode==='catalog');
    if(mode==='participant'&&active&&state)activityStates.set(active.id,{version:active.version,state});
    root.innerHTML=top()+(error?`<p class="ht-error" role="alert">${h(error)}</p>`:'')+(notice?`<p class="ht-notice" role="status">${h(notice)}</p>`:'')+(mode==='catalog'?catalogue():mode==='participant'?participation():mode==='editor'&&editor?editorView():mode==='opening'?'<p class="ht-notice" role="status">Abrindo o texto do documento…</p>':'');
    if(mode==='participant'&&content?.sections?.length){
      const frame=root.querySelector('.ht-content-frame');
      if(frame){frame.addEventListener('load',()=>{
        if(!alive)return;const doc=frame.contentDocument;if(!doc)return;
        for(const name of ['copy','cut','contextmenu','dragstart','selectstart'])doc.addEventListener(name,e=>e.preventDefault());
        doc.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&['c','x','p','s','a'].includes(e.key.toLowerCase()))e.preventDefault();});
      });frame.srcdoc=readerDocument(content?.sections?.[readIndex]?.html,uid,new Date().toLocaleDateString('pt-BR'));}
    }
    if(mode==='editor')root.querySelectorAll('[data-section]').forEach(frame=>{frame.srcdoc=readerDocument(editor.sections[Number(frame.dataset.section)].html,uid,'',true);});
    renderBusy();
  }
  async function loadCatalog(){revision++;progressGeneration++;active=null;content=null;editor=null;questions=[];state=null;mode='catalog';error='';notice='';auditCleanup?.();auditCleanup=null;render();const token=revision;const res=await call('LIST',{},token);catalog=res.trainings||[];render();refreshVisibleActivities();}
  async function open(id){
    revision++;progressGeneration++;const token=revision;error='';notice='';
    const selected=catalog.find(t=>t.id===id);
    active=selected||null;content=null;state=null;mode='opening';render();
    const loaded=await loadHtmlTrainingDocument((action,input)=>call(action,input,token),{trainingId:id,version:selected?.version});
    if(!current(token))return;
    const opened=loaded.opened;
    active=opened.training;state=opened.state;questions=opened.questions||[];content=loaded.content;
    answers={...(state?.run?.answers||{})};suggestion='';confirm=false;submitRequest=null;editorParent='catalog';
    readIndex=state?.run?.stage==='READING'?Math.min(state.run.readCount||0,Math.max(0,content.sections.length-1)):0;
    mode='participant';render();
    // Show the authorized text before registering a new read. No attempt is consumed here.
    if((state?.attempts?.length||0)===0&&(!state?.run||state.run.stage==='COMPLETED')){
      const begun=await call('BEGIN',{trainingId:id,requestId:uuid()},token);
      state=begun.state;readIndex=0;render();
    }
  }
  async function edit(id){revision++;const token=revision;const result=await call('EDIT',{trainingId:id},token);editor={...result,selectedQuestionIds:[...(result.training.selectedQuestionIds||[])]};active=result.training;mode='editor';error='';notice='';render();}
  function collectEditor(){
    const form=root.querySelector('[data-editor]');if(!form)return;
    const f=new FormData(form),e=editor;
    for(const k of ['title','category','subcategory','audienceGroup'])e.training[k]=String(f.get(k)||'');
    if(isTrainingAdmin(profile))e.training.managerUid=String(f.get('managerUid')||'');
    e.sections.forEach((s,i)=>{s.title=String(f.get(`section-title-${i}`)||'');s.html=form.querySelector(`[data-section="${i}"]`)?.contentDocument?.querySelector('.material')?.innerHTML ?? s.html;});
    e.selectedQuestionIds=[...form.querySelectorAll('[data-selected]:checked')].map(el=>el.dataset.selected);
    e.institutionalReviewConfirmed=form.elements.institutionalReviewConfirmed?.checked===true;
    e.bank.forEach((q,i)=>{q.stem=String(f.get(`stem-${i}`)||'');q.points=Number(f.get(`points-${i}`));q.correctOptionId=String(f.get(`correct-${i}`)||'');q.comment=String(f.get(`comment-${i}`)||'');q.options.forEach((o,j)=>o.text=String(f.get(`option-${i}-${j}`)||''));});
  }
  async function publish(status){collectEditor();if(editor.selectedQuestionIds.length!==5)throw new Error('Selecione exatamente cinco questões do banco.');const e=editor;const res=await call('PUBLISH',{trainingId:active.id,expectedVersion:e.training.version,training:{...e.training,status},institutionalReviewConfirmed:e.institutionalReviewConfirmed===true,deferInstitutionalReview:isTrainingAdmin(profile)&&!!e.training.source?.pendingReviewPublication&&e.institutionalReviewConfirmed!==true,reviewDeferralReason:e.training.source?.pendingReviewPublication?.reason,sections:e.sections,bank:e.bank,selectedQuestionIds:e.selectedQuestionIds,auditSchema:e.auditSchema});active=res.training;catalog=catalog.map(t=>t.id===active.id?active:t);activityStates.delete(active.id);await edit(active.id);notice=status==='DRAFT'?'Rascunho salvo no serviço.':'Treinamento publicado no PWA. Consulte o estado da sincronização com o Drive.';render();}
  const click=event=>{
    const b=event.target.closest('[data-ht]');if(!b||!root.contains(b))return;
    const action=b.dataset.ht;
    if(action==='back'){goBack();return;}
    if(busy)return;
    if(action==='format'){event.preventDefault();const frame=root.querySelector(`[data-section="${b.dataset.index}"]`);frame?.contentWindow?.focus();frame?.contentDocument?.execCommand(b.dataset.command,false,b.dataset.command==='formatBlock'?'h2':null);return;}
    perform(async()=>{
      if(action==='catalog')return loadCatalog();
      if(action==='folder'){const path=JSON.parse(b.dataset.folder);if(!Array.isArray(path)||path.length>2)return;folderPath=path;render();refreshVisibleActivities();return;}
      if(action==='open')return open(b.dataset.id);
      if(action==='edit'){editorParent=mode==='participant'?'participant':'catalog';return edit(b.dataset.id);}
      if(action==='audit'){
        const result=await call('EDIT',{trainingId:active.id});
        if(!result.auditSchema)throw new Error('Modelo de auditoria não disponível para esta ROP.');
        auditCleanup?.();auditCleanup=mountTrainingAudit(root,{training:active,schema:result.auditSchema,api:async(...args)=>{try{return await call(...args);}catch(err){if(err.status===401||err.status===403||err.code==='SESSION_CHANGED')fail(err);throw err;}},isActive:()=>current(revision)});return;
      }
      if(action==='begin'){const res=await call('BEGIN',{trainingId:active.id,requestId:uuid()});state=res.state;readIndex=0;answers={};suggestion='';render();return;}
      if(action==='previous'){readIndex=Math.max(0,readIndex-1);render();return;}
      if(action==='browse-next'){readIndex=Math.min(content.sections.length-1,readIndex+1);render();return;}
      if(action==='read'){
        if(readIndex<(state.run.readCount||0)){readIndex++;render();return;}
        const res=await call('READ',{trainingId:active.id,runId:state.run.id,index:readIndex});state=res.state;
        if(state.run.stage==='READING')readIndex=Math.min(state.run.readCount,content.sections.length-1);render();return;
      }
      if(action==='ack'){if(!root.querySelector('[name=ack]')?.checked)throw new Error('Marque a declaração de ciência para continuar.');state=(await call('ACK',{trainingId:active.id,runId:state.run.id,accepted:true})).state;render();return;}
      if(action==='quiz'){const form=root.querySelector('[data-quiz]');if(!form.reportValidity())return;answers=Object.fromEntries(new FormData(form));state=(await call('QUIZ',{trainingId:active.id,runId:state.run.id,answers})).state;render();return;}
      if(['confirm','cancel-confirm','submit'].includes(action)){
        suggestion=root.querySelector('[name=suggestion]')?.value || '';
        if(action==='confirm'){confirm=true;render();return;}
        if(action==='cancel-confirm'){confirm=false;render();return;}
        submitRequest??=uuid();const res=await call('SUBMIT',{trainingId:active.id,runId:state.run.id,requestId:submitRequest,suggestion});state=res.state;confirm=false;notice=`Tentativa registrada. Pontuação total deste treinamento: ${res.score?.total ?? 'consulte Desempenho'}.`;root.dispatchEvent(new CustomEvent('html-training-score-updated',{bubbles:true,detail:{trainingId:active.id,score:res.score}}));render();return;
      }
      if(action==='publish'||action==='draft')return publish(action==='publish'?'PUBLISHED':'DRAFT');
      if(action==='add-section'){collectEditor();editor.sections.push({id:uuid(),title:'Nova seção',html:'<p>Escreva o conteúdo.</p>'});render();return;}
      if(action==='add-question'){collectEditor();const id=uuid();editor.bank.push({id,stem:'',points:1,correctOptionId:'a',options:['a','b','c','d'].map(id=>({id,text:''}))});render();return;}
      if(action==='review'){
        const i=Number(b.dataset.index),s=editor.suggestions[i];const points=Number(root.querySelector(`[name="review-points-${i}"]`).value),note=root.querySelector(`[name="review-note-${i}"]`).value;
        collectEditor();await call('REVIEW',{trainingId:active.id,uid:s.uid,expectedVersion:s.version,points,note});const fresh=await call('EDIT',{trainingId:active.id});editor.suggestions=fresh.suggestions;notice='Decisão manual registrada. O valor vigente substitui a concessão anterior.';render();
      }
    });
  };
  root.addEventListener('click',click);
  const preventSubmit=event=>event.preventDefault();
  root.addEventListener('submit',preventSubmit);
  root.classList.add('html-trainings');root.innerHTML='<p class="ht-notice" role="status">Consultando treinamentos autorizados…</p>';
  (async()=>{try{if(!uid)throw new Error('Entre com sua conta institucional para acessar os treinamentos.');if(!api){const client=await createHtmlTrainingClient(user);if(!alive)return;api=client.api;valid=client.valid;unsubscribe=client.subscribeInvalidated(()=>fail(Object.assign(new Error('Sua sessão mudou. Entre novamente.'),{code:'SESSION_CHANGED'})));}if(!current(revision))return;await loadCatalog();}catch(err){fail(err);}})();
  const cleanup = () => {root.removeEventListener('click',click);root.removeEventListener('submit',preventSubmit);stop();};
  cleanup.goBack=goBack;
  return cleanup;
}

