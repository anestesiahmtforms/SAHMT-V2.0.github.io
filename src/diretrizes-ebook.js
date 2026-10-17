import './diretrizes-ebook.css';
import {createReadingClient} from './diretrizes-reading.js';

async function loadPdf(bytes) {
  const pdfjs = await import('pdfjs-dist');
  const {default: workerUrl} = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs.getDocument({data: bytes, isEvalSupported: false, enableXfa: false, stopAtErrors: true, useSystemFonts: true});
}
const messages = {
  READING_ACCESS_DENIED: 'Seu acesso a esta Diretriz não está autorizado.',
  READING_LOGIN_REQUIRED: 'Entre novamente para continuar a leitura.',
  READING_USER_CHANGED: 'A conta mudou. Abra a Diretriz novamente.',
  READING_SESSION_INVALID: 'A sessão de leitura expirou. Feche e abra a Diretriz para retomar.',
  READING_MATERIAL_CHANGED: 'O material mudou. A nova versão precisa ser conferida antes de continuar.',
  READING_GRANT_PENDING: 'Leitura registrada. A liberação do formulário está pendente; tente concluir novamente.',
  READING_CUTOVER_REQUIRED: 'A liberação individual desta Diretriz ainda não foi ativada.',
  READING_CONFIG_MISSING: 'O serviço de leitura ainda não foi configurado.',
  READING_DISABLED: 'O serviço de leitura ainda não foi ativado.',
  READING_INCOMPLETE: 'Apresente todas as páginas antes de concluir.',
  READING_BUSY: 'O serviço está ocupado. Tente novamente em instantes.'
};

/** Modal owns its tasks and discards every response after close or identity change. */
export function installDiretrizesReader({root = document, getUser, endpoint, client = createReadingClient({endpoint, getUser}), pdfLoader = loadPdf} = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'diretrizes-ebook';
  dialog.setAttribute('aria-label', 'Leitura da Diretriz');
  dialog.innerHTML = '<header><h2></h2><p data-reading-status role="status" aria-live="polite"></p></header>' +
    '<section class="diretrizes-ebook__pages" tabindex="0" aria-label="Página do documento"><canvas aria-label="Página PDF"></canvas><pre hidden></pre></section>' +
    '<footer><nav aria-label="Páginas"><button type="button" data-reader-prev>ANTERIOR</button><span data-reader-page></span><button type="button" data-reader-next>PRÓXIMA</button><button type="button" data-reader-text>TEXTO</button></nav>' +
    '<button type="button" data-reader-complete disabled>CONCLUIR LEITURA E ABRIR FORMULÁRIO</button><a data-reader-form hidden target="_blank" rel="noopener noreferrer">ABRIR FORMULÁRIO LIBERADO</a>' +
    '<button type="button" data-reader-close>FECHAR</button></footer>';
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const panel = $('.diretrizes-ebook__pages'), canvas = $('canvas'), text = $('pre');
  const status = $('[data-reading-status]'), previous = $('[data-reader-prev]'), next = $('[data-reader-next]'), complete = $('[data-reader-complete]'), formLink = $('[data-reader-form]');
  let current = null, generation = 0;
  const active = state => current === state && state.generation === generation && dialog.open && getUser()?.uid === state.uid;
  const controls = state => {
    previous.disabled = state.busy || state.page <= 1;
    next.disabled = state.busy || !state.pdf || state.page >= state.total;
    complete.disabled = state.busy || state.visited.size !== state.total || !state.pdf;
    $('[data-reader-text]').disabled = state.busy || !state.pdf;
    $('[data-reader-page]').textContent = state.pdf ? `Página ${state.page} de ${state.total} · ${state.visited.size} apresentadas` : '';
  };
  const dispose = () => {
    generation++; const old = current; current = null;
    old?.controller.abort();old?.renderTask?.cancel();
    if(old?.loadingTask)void old.loadingTask.destroy().catch(()=>{});
    canvas.width = canvas.height = 0;text.textContent = '';formLink.hidden = true;formLink.removeAttribute('href');
  };
  const close = () => { if (dialog.open) dialog.close();dispose(); };
  const failure = (error, state) => {if(active(state))status.textContent = messages[error?.message] || 'Não foi possível concluir esta etapa. Tente novamente sem sair da conta.';};
  const checkpoint = async state => {
    if(!active(state) || state.saving || !state.sessionId || state.visited.size - state.saved < 5)return;
    state.saving=true;
    try{const pages=[...state.visited];await client.request({action:'progress',documentId:state.documentId,sessionId:state.sessionId,pages},{signal:state.controller.signal});if(active(state))state.saved=pages.length;}
    catch(error){failure(error,state);}finally{state.saving=false;}
  };
  const presented = () => {
    const state=current;
    if(!state||!active(state)||state.busy||!state.pdf||state.renderedPage!==state.page||document.visibilityState==='hidden')return;
    if(panel.scrollTop + panel.clientHeight < panel.scrollHeight - 8)return;
    state.visited.add(state.page);controls(state);void checkpoint(state);
  };
  const render = async state => {
    state.busy=true;state.renderedPage=null;controls(state);
    canvas.width=canvas.height=0;text.textContent='';
    try{
      const page=await state.pdf.getPage(state.page);if(!active(state))return;
      const base=page.getViewport({scale:1});
      const scale=Math.min((panel.clientWidth-24)/base.width,2,Math.sqrt(4000000/(base.width*base.height)));
      const viewport=page.getViewport({scale:Math.max(0.1,scale)});
      canvas.width=Math.floor(viewport.width);canvas.height=Math.floor(viewport.height);
      state.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport});
      await state.renderTask.promise;if(!active(state))return;
      const content=await page.getTextContent();if(!active(state))return;
      text.textContent=content.items.map(item=>item.str+(item.hasEOL?'\n':' ')).join('');
      state.renderedPage=state.page;
      panel.scrollTop=0;status.textContent='Percorra cada página. Ao terminar, confirme a conclusão da leitura.';
    }catch(error){failure(error,state);}finally{if(active(state)){state.busy=false;controls(state);presented();}}
  };
  const open = async trigger => {
    trigger.parentElement.querySelector('[data-reader-unavailable]')?.remove();
    dispose();
    const user=getUser();if(!user?.uid)return;
    const state={generation,uid:user.uid,documentId:trigger.dataset.openDiretrizReader,controller:new AbortController(),busy:true,page:1,total:0,visited:new Set(),saved:0};current=state;
    $('h2').textContent=trigger.dataset.readingTitle||'Diretriz';canvas.hidden=false;text.hidden=true;
    status.textContent='Carregando o PDF para leitura…';controls(state);
    if(!dialog.open)dialog.showModal();
    try{
      const answer=await client.request({action:'start',documentId:state.documentId},{signal:state.controller.signal});if(!active(state))return;
      if(!Number.isSafeInteger(answer.pages)||answer.pages<1||answer.pages>300||!/^[a-f0-9]{32}$/.test(answer.sessionId||'')||typeof answer.pdfBase64!=='string'||answer.pdfBase64.length>8388608)throw Error('READING_PDF_INVALID');
      state.total=answer.pages;state.sessionId=answer.sessionId;
      state.visited=new Set(Array.isArray(answer.visited)?answer.visited.filter(p=>Number.isInteger(p)&&p>=1&&p<=state.total):[]);state.saved=state.visited.size;
      const bytes=Uint8Array.from(atob(answer.pdfBase64),char=>char.charCodeAt(0));
      state.loadingTask=await pdfLoader(bytes);if(!active(state)){void state.loadingTask.destroy().catch(()=>{});return;}
      state.pdf=await state.loadingTask.promise;if(!active(state))return;
      if(state.pdf.numPages!==state.total)throw Error('READING_PDF_INVALID');
      state.page=Math.min(state.total,[...Array(state.total)].findIndex((_,i)=>!state.visited.has(i+1))+1||1);
      await render(state);
    }catch(error){if(active(state)){state.busy=false;controls(state);failure(error,state);}}
  };
  const onClick = event => {
    const trigger=event.target.closest?.('[data-open-diretriz-reader]');
    if(trigger&&(root===document||root.contains(trigger))){event.preventDefault();void open(trigger);return;}
    if(event.target.closest?.('[data-reader-close]')){close();return;}
    const state=current;if(!state||!active(state)||state.busy)return;
    if(event.target.closest?.('[data-reader-prev]')&&state.page>1){state.page--;void render(state);}
    if(event.target.closest?.('[data-reader-next]')&&state.page<state.total){state.page++;void render(state);}
    if(event.target.closest?.('[data-reader-text]')){text.hidden=!text.hidden;canvas.hidden=!text.hidden;panel.scrollTop=0;presented();}
    if(event.target.closest?.('[data-reader-complete]')&&state.visited.size===state.total){
      state.busy=true;controls(state);status.textContent='Registrando leitura e verificando a liberação individual…';
      void client.request({action:'complete',documentId:state.documentId,sessionId:state.sessionId,pages:[...state.visited]},{signal:state.controller.signal}).then(answer=>{
        if(!active(state))return;
        if(!/^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(answer.formUrl||''))throw Error('READING_FORM_INVALID');
        formLink.href=answer.formUrl;formLink.hidden=false;status.textContent='Leitura registrada e formulário liberado para sua conta Google.';
        // An explicit link avoids popup blocking after the asynchronous server check.
        formLink.focus();
      }).catch(error=>failure(error,state)).finally(()=>{if(active(state)){state.busy=false;controls(state);}});
    }
  };
  root.addEventListener('click',onClick);dialog.addEventListener('close',dispose);panel.addEventListener('scroll',presented);
  document.addEventListener('visibilitychange',presented);
  return {close,dispose:()=>{close();root.removeEventListener('click',onClick);document.removeEventListener('visibilitychange',presented);dialog.remove();}};
}

export async function installAuthenticatedDiretrizesReader(config){
  const [{auth},{onAuthStateChanged}]=await Promise.all([import('./firebase-auth.js'),import('firebase/auth')]);
  const reader=installDiretrizesReader({endpoint:config.endpoint,getUser:()=>auth?.currentUser});
  let uid=auth?.currentUser?.uid;
  const unsubscribe=auth?onAuthStateChanged(auth,user=>{if(uid!==user?.uid)reader.close();uid=user?.uid;}):()=>{};
  return ()=>{unsubscribe();reader.dispose();};
}
