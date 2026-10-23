import './diretrizes-ebook.css';
import {createReadingClient} from './diretrizes-reading.js';
import {pdfPageLayout, PDF_ZOOM_STEPS} from './diretrizes-pdf-layout.js';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

async function loadPdf(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjs.getDocument({data: bytes, isEvalSupported: false, enableXfa: false, stopAtErrors: true, useSystemFonts: true});
}
async function extractPageText(page, signal) {
  // PDF.js getTextContent uses ReadableStream async iteration, unavailable in
  // affected Safari versions. getReader/read works there without global patches.
  if(typeof page.streamTextContent!=='function')return page.getTextContent();
  const reader=page.streamTextContent().getReader(),items=[];
  const abort=()=>{void reader.cancel().catch(()=>{});};
  signal.addEventListener('abort',abort,{once:true});
  try{
    while(!signal.aborted){const {done,value}=await reader.read();if(done)break;for(const item of value.items||[])items.push(item);}
    return {items};
  }finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
}
const messages = {
  READING_ACCESS_DENIED: 'Seu acesso a este documento não está autorizado.',
  READING_LOGIN_REQUIRED: 'Entre novamente para continuar a leitura.',
  READING_USER_CHANGED: 'A conta mudou. Abra o documento novamente.',
  READING_SESSION_INVALID: 'A sessão de leitura expirou. Feche e abra o documento para retomar.',
  READING_MATERIAL_CHANGED: 'O material mudou. A nova versão precisa ser conferida antes de continuar.',
  READING_GRANT_PENDING: 'Leitura registrada. A liberação do formulário está pendente; tente concluir novamente.',
  READING_CUTOVER_REQUIRED: 'A liberação individual deste documento ainda não foi ativada.',
  READING_CONFIG_MISSING: 'O serviço de leitura ainda não foi configurado.',
  READING_DISABLED: 'O serviço de leitura ainda não foi ativado.',
  READING_INCOMPLETE: 'Apresente todas as páginas antes de concluir.',
  READING_BUSY: 'O serviço está ocupado. Tente novamente em instantes.',
  READING_IDENTITY_DENIED: 'Não foi possível validar sua sessão de Gestão para esta leitura.',
  READING_NETWORK_FAILED: 'Não foi possível conectar ao serviço de leitura.',
  READING_TIMEOUT: 'O serviço de leitura demorou para responder. Tente novamente.',
  READING_UNAVAILABLE: 'O serviço de leitura não conseguiu concluir a solicitação.',
  READING_RESPONSE_INVALID: 'O serviço de leitura devolveu uma resposta inválida.',
  READING_PDF_ENGINE_FAILED: 'Não foi possível iniciar o leitor PDF neste navegador.',
  READING_PDF_DECODE_FAILED: 'Não foi possível carregar o conteúdo do PDF.',
  READING_PDF_RENDER_FAILED: 'Não foi possível apresentar a página do PDF.'
};

/** Modal owns its tasks and discards every response after close or identity change. */
export function installDiretrizesReader({root = document, getUser, endpoint, client = createReadingClient({endpoint, getUser}), pdfLoader = loadPdf} = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'diretrizes-ebook';
  dialog.setAttribute('aria-label', 'Leitura do documento');
  dialog.innerHTML = '<header><h2></h2><p data-reading-status role="status" aria-live="polite"></p></header>' +
    '<section class="diretrizes-ebook__pages" tabindex="0" aria-label="Página do documento"><canvas aria-label="Página PDF"></canvas><pre hidden></pre></section>' +
    '<footer><nav aria-label="Páginas"><button type="button" data-reader-prev>ANTERIOR</button><span data-reader-page></span><button type="button" data-reader-next>PRÓXIMA</button><button type="button" data-reader-text>TEXTO</button></nav>' +
    '<nav aria-label="Ampliação do documento"><button type="button" data-reader-zoom-out aria-label="Diminuir zoom">−</button><span data-reader-zoom aria-live="polite">100%</span><button type="button" data-reader-zoom-in aria-label="Aumentar zoom">+</button><button type="button" data-reader-fit>AJUSTAR</button></nav>' +
    '<button type="button" data-reader-complete disabled>CONCLUIR LEITURA E ABRIR FORMULÁRIO</button><a data-reader-form hidden target="_blank" rel="noopener noreferrer">ABRIR FORMULÁRIO LIBERADO</a>' +
    '<button type="button" data-reader-close>FECHAR</button></footer>';
  document.body.append(dialog);
  const $ = selector => dialog.querySelector(selector);
  const panel = $('.diretrizes-ebook__pages'), canvas = $('canvas'), text = $('pre');
  const status = $('[data-reading-status]'), previous = $('[data-reader-prev]'), next = $('[data-reader-next]'), complete = $('[data-reader-complete]'), formLink = $('[data-reader-form]');
  let current = null, generation = 0, resizeFrame = 0;
  const active = state => current === state && state.generation === generation && dialog.open && getUser()?.uid === state.uid;
  const controls = state => {
    previous.disabled = state.busy || state.page <= 1;
    next.disabled = state.busy || !state.pdf || state.page >= state.total;
    complete.disabled = state.busy || state.visited.size !== state.total || !state.pdf;
    $('[data-reader-text]').disabled = state.busy || !state.pdf || !state.textAvailable;
    const zoomIndex=state.zoomIndex||0;
    $('[data-reader-zoom-out]').disabled=state.busy||!state.pdf||zoomIndex===0;
    $('[data-reader-zoom-in]').disabled=state.busy||!state.pdf||zoomIndex===PDF_ZOOM_STEPS.length-1;
    $('[data-reader-fit]').disabled=state.busy||!state.pdf;
    $('[data-reader-zoom]').textContent=Math.round(PDF_ZOOM_STEPS[zoomIndex]*100)+'%';
    $('[data-reader-page]').textContent = state.pdf ? `Página ${state.page} de ${state.total} · ${state.visited.size} apresentadas` : '';
  };
  const dispose = () => {
    generation++; const old = current; current = null;
    cancelAnimationFrame(resizeFrame);
    old?.controller.abort();old?.renderTask?.cancel();
    if(old?.loadingTask)void old.loadingTask.destroy().catch(()=>{});
    canvas.width = canvas.height = 0;canvas.style.width=canvas.style.height='';text.textContent = '';formLink.hidden = true;formLink.removeAttribute('href');
  };
  const close = () => { if (dialog.open) dialog.close();dispose(); };
  const failure = (error, state) => {if(active(state)){const code=/^READING_[A-Z_]{1,80}$/.test(error?.message||'')?error.message:({engine:'READING_PDF_ENGINE_FAILED',decode:'READING_PDF_DECODE_FAILED',render:'READING_PDF_RENDER_FAILED'}[state.phase]||'READING_UNAVAILABLE');status.textContent=(messages[code]||'Não foi possível concluir esta etapa. Tente novamente sem sair da conta.')+' Código: '+code;}};
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
    // The stable scrollbar gutter is reserved space, not unread page content.
    const gutter=Math.max(0,panel.offsetWidth-panel.clientWidth);
    if(panel.scrollLeft + panel.clientWidth < panel.scrollWidth - gutter - 8)return;
    state.visited.add(state.page);controls(state);void checkpoint(state);
  };
  const resize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame=requestAnimationFrame(()=>{const state=current;if(state&&active(state)&&state.pdf&&!state.busy&&Math.abs(panel.clientWidth-state.layoutWidth)>1)void render(state,true);});
  };
  const render = async (state,preservePosition=false) => {
    const center=preservePosition?{x:(panel.scrollLeft+panel.clientWidth/2)/Math.max(panel.scrollWidth,1),y:(panel.scrollTop+panel.clientHeight/2)/Math.max(panel.scrollHeight,1)}:null;
    state.phase='render';
    state.busy=true;state.renderedPage=null;state.textAvailable=false;controls(state);
    canvas.width=canvas.height=0;canvas.hidden=false;text.hidden=true;text.textContent='';
    try{
      const page=await state.pdf.getPage(state.page);if(!active(state))return;
      const base=page.getViewport({scale:1});
      state.layoutWidth=panel.clientWidth;
      const layout=pdfPageLayout({width:base.width,height:base.height,availableWidth:Math.max(1,panel.clientWidth-24),zoom:PDF_ZOOM_STEPS[state.zoomIndex||0],devicePixelRatio:window.devicePixelRatio});
      const viewport=page.getViewport({scale:layout.scale});
      canvas.width=layout.pixelWidth;canvas.height=layout.pixelHeight;
      canvas.style.width=Math.floor(layout.cssWidth)+'px';canvas.style.height=Math.floor(layout.cssHeight)+'px';
      state.renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:layout.outputScale===1?null:[layout.outputScale,0,0,layout.outputScale,0,0]});
      await state.renderTask.promise;if(!active(state))return;
      state.renderedPage=state.page;
      panel.scrollTop=center?center.y*panel.scrollHeight-panel.clientHeight/2:0;
      panel.scrollLeft=center?center.x*panel.scrollWidth-panel.clientWidth/2:0;
      status.textContent='Percorra cada página. Ao terminar, confirme a conclusão da leitura.';
      // Text extraction is an optional alternate view. A failure or delay here
      // must not invalidate a successfully rendered PDF page or its reading gate.
      const renderedPage=state.page,renderTask=state.renderTask;
      void Promise.resolve().then(()=>extractPageText(page,state.controller.signal)).then(content=>{
        if(!active(state)||state.renderedPage!==renderedPage||state.renderTask!==renderTask)return;
        text.textContent=content.items.map(item=>String(item.str||'')+(item.hasEOL?'\n':' ')).join('');
        state.textAvailable=Boolean(text.textContent.trim());controls(state);
      }).catch(()=>{});
    }catch(error){failure(error,state);}finally{if(active(state)){state.busy=false;controls(state);presented();if(state.pdf&&state.renderedPage!==null&&Math.abs(panel.clientWidth-state.layoutWidth)>1)resize();}}
  };
  const open = async trigger => {
    trigger.parentElement.querySelector('[data-reader-unavailable]')?.remove();
    dispose();
    const user=getUser();if(!user?.uid)return;
    const state={generation,uid:user.uid,documentId:trigger.dataset.openDiretrizReader,controller:new AbortController(),busy:true,page:1,total:0,zoomIndex:0,visited:new Set(),saved:0};current=state;
    $('h2').textContent=trigger.dataset.readingTitle||'Documento';canvas.hidden=false;text.hidden=true;
    status.textContent='Carregando o PDF para leitura…';controls(state);
    if(!dialog.open)dialog.showModal();
    try{
      const answer=await client.request({action:'start',documentId:state.documentId},{signal:state.controller.signal});if(!active(state))return;
      if(!Number.isSafeInteger(answer.pages)||answer.pages<1||answer.pages>300||!/^[a-f0-9]{32}$/.test(answer.sessionId||'')||typeof answer.pdfBase64!=='string'||answer.pdfBase64.length>8388608)throw Error('READING_PDF_INVALID');
      state.total=answer.pages;state.sessionId=answer.sessionId;state.hasForm=answer.hasForm!==false;complete.textContent=state.hasForm?'CONCLUIR LEITURA E ABRIR FORMULÁRIO':'CONCLUIR LEITURA';
      state.visited=new Set(Array.isArray(answer.visited)?answer.visited.filter(p=>Number.isInteger(p)&&p>=1&&p<=state.total):[]);state.saved=state.visited.size;
      const bytes=Uint8Array.from(atob(answer.pdfBase64),char=>char.charCodeAt(0));
      state.phase='engine';state.loadingTask=await pdfLoader(bytes);if(!active(state)){void state.loadingTask.destroy().catch(()=>{});return;}
      state.phase='decode';
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
    if(event.target.closest?.('[data-reader-zoom-in]')&&state.zoomIndex<PDF_ZOOM_STEPS.length-1){state.zoomIndex++;void render(state,true);return;}
    if(event.target.closest?.('[data-reader-zoom-out]')&&state.zoomIndex>0){state.zoomIndex--;void render(state,true);return;}
    if(event.target.closest?.('[data-reader-fit]')){state.zoomIndex=0;void render(state);return;}
    if(event.target.closest?.('[data-reader-prev]')&&state.page>1){state.page--;void render(state);}
    if(event.target.closest?.('[data-reader-next]')&&state.page<state.total){state.page++;void render(state);}
    if(event.target.closest?.('[data-reader-text]')){text.hidden=!text.hidden;canvas.hidden=!text.hidden;panel.scrollTop=0;presented();}
    if(event.target.closest?.('[data-reader-complete]')&&state.visited.size===state.total){
      state.busy=true;controls(state);status.textContent='Registrando leitura e verificando a liberação individual…';
      void client.request({action:'complete',documentId:state.documentId,sessionId:state.sessionId,pages:[...state.visited]},{signal:state.controller.signal}).then(answer=>{
        if(!active(state))return;
        if(answer.code==='READING_COMPLETED' && state.hasForm===false){status.textContent='Leitura registrada. Este documento não possui formulário associado.';return;}
        if(!/^https:\/\/docs\.google\.com\/forms\/d\/e\/[A-Za-z0-9_-]+\/viewform$/.test(answer.formUrl||''))throw Error('READING_FORM_INVALID');
        formLink.href=answer.formUrl;formLink.hidden=false;status.textContent='Leitura registrada e formulário liberado para sua conta Google.';
        // An explicit link avoids popup blocking after the asynchronous server check.
        formLink.focus();
      }).catch(error=>failure(error,state)).finally(()=>{if(active(state)){state.busy=false;controls(state);}});
    }
  };
  root.addEventListener('click',onClick);dialog.addEventListener('close',dispose);panel.addEventListener('scroll',presented);
  document.addEventListener('visibilitychange',presented);
  window.addEventListener('resize',resize);
  return {close,dispose:()=>{close();root.removeEventListener('click',onClick);document.removeEventListener('visibilitychange',presented);window.removeEventListener('resize',resize);dialog.remove();}};
}

export async function installAuthenticatedDiretrizesReader(config){
  const [{auth},{onAuthStateChanged}]=await Promise.all([import('./firebase-auth.js'),import('firebase/auth')]);
  const reader=installDiretrizesReader({endpoint:config.endpoint,getUser:()=>auth?.currentUser});
  let uid=auth?.currentUser?.uid;
  const unsubscribe=auth?onAuthStateChanged(auth,user=>{if(uid!==user?.uid)reader.close();uid=user?.uid;}):()=>{};
  return ()=>{unsubscribe();reader.dispose();};
}
