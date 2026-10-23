import {GOOGLE_AUTH_START,safeGoogleAuthCode} from './google-project-auth-core.js';
const labels={FA:'SAHMT',FB:'Gestão',FC:'Registros',FD:'Indicadores',FE:'Enquetes/Consultas'};
const messages={AUTH_AUDIENCE_NOT_VERIFIED:'A compatibilidade Google deste projeto precisa ser confirmada.',
  AUTH_CONFIGURATION_REQUIRED:'Configuração deste projeto ainda pendente.',
  AUTH_EXISTING_ACCOUNT_REQUIRED:'Cadastro Google precisa ser conferido pelo administrador.',
  AUTH_UID_MISMATCH:'A identidade deste projeto precisa ser conferida.',
  AUTH_GOOGLE_IDENTITY_MISMATCH:'Escolha a mesma conta Google que já está aberta no app.',
  'auth/user-disabled':'Conta desativada neste projeto.',AUTH_OFFLINE:'Aguardando conexão com a internet.',
  'auth/popup-blocked':'Permita a janela Google e toque novamente.',
  'auth/user-mismatch':'Escolha a mesma conta que já está aberta no app.',
  AUTH_ACCOUNT_CHANGED:'A conta mudou. Confirme a conta atual.',
  AUTH_SOURCE_REQUIRED:'Entre primeiro na sua conta Google do SAHMT.',
  AUTH_LOGOUT_IN_PROGRESS:'Aguarde a conclusão da saída antes de entrar novamente.',
  AUTH_SOURCE_GOOGLE_LINK_REQUIRED:'Seu cadastro precisa ter a conta Google vinculada pelo administrador.'};

/** This small panel never replaces the app, forms, report DOM or offline queues. */
export function mountGoogleProjectAuthPanel({controller,confirm,getUser,createGoogleButton,document:doc=document,now=Date.now}={}){
  const panel=doc.createElement('section');panel.className='google-auth-update';panel.hidden=true;
  panel.setAttribute('aria-label','Atualização de acesso');
  const heading=doc.createElement('h2');heading.textContent='ATUALIZAR O APP';
  const explanation=doc.createElement('p');explanation.textContent='Confirme sua conta Google para ativar o acesso automático.';
  const list=doc.createElement('ul'),message=doc.createElement('p'),host=doc.createElement('div'),retry=doc.createElement('button');
  host.className='google-auth-button';message.setAttribute('role','status');
  retry.className='secondary-button';retry.textContent='TENTAR CARREGAR O GOOGLE NOVAMENTE';retry.hidden=true;
  panel.append(heading,explanation,list,message,host,retry);doc.body.append(panel);
  let localBusy=false,lastState=controller.snapshot(),lastError='',lastUid='',widget=null,disposed=false,loadFailed=false;
  function startButton(){
    if(widget||loadFailed||disposed||panel.hidden)return;
    try{
      // GIS renders its own button and owns the real user gesture. No synthetic click.
      widget=createGoogleButton({
        onCredential:credential=>confirm(credential),
        onLoading:busy=>{localBusy=busy;if(busy)lastError='';paint(lastState,false);},
        onError:error=>{lastError=safeGoogleAuthCode(error);paint(lastState,false);}
      });
      widget.render(host).catch(error=>{
        if(disposed)return;loadFailed=true;lastError=safeGoogleAuthCode(error);paint(lastState,false);
      });
    }catch(error){loadFailed=true;lastError=safeGoogleAuthCode(error);paint(lastState,false);}
  }
  function paint(state=lastState,install=true){
    if(disposed)return;lastState=state;const user=getUser();
    if(lastUid!==user?.uid){lastError='';lastUid=user?.uid;}
    panel.hidden=!user||now()<GOOGLE_AUTH_START||state.complete||state.uid!==user.uid;
    list.replaceChildren();for(const [target,value]of Object.entries(state.targets)){
      const item=doc.createElement('li');item.dataset.status=value.status;
      const status={ready:'conectado',pending:'pendente',restoring:'restaurando',connecting:'conectando'}[value.status]||'pendente';
      item.textContent=`${target} · ${labels[target]}: ${status}`;list.append(item);
    }
    const sourceBlocked=state.targets.FA?.code==='AUTH_SOURCE_GOOGLE_LINK_REQUIRED';
    host.hidden=sourceBlocked;host.inert=localBusy||state.busy;
    retry.hidden=!loadFailed;retry.disabled=localBusy||state.busy;
    const code=lastError||Object.values(state.targets).find(v=>v.code)?.code;
    message.textContent=code?(messages[code]||'Uma conexão ficou pendente. Você pode continuar usando o app e tentar novamente.'):
      localBusy?'Conectando com Google…':'';
    if(install&&!sourceBlocked)startButton();
  }
  retry.addEventListener('click',()=>{
    if(localBusy||lastState.busy)return;
    widget?.dispose();widget=null;loadFailed=false;lastError='';paint();
  });
  const unsubscribe=controller.subscribe(paint),visible=()=>{if(doc.visibilityState!=='hidden')paint();};
  doc.addEventListener('visibilitychange',visible);
  return {refresh:()=>paint(),dispose(){disposed=true;unsubscribe();widget?.dispose();doc.removeEventListener('visibilitychange',visible);panel.remove();}};
}
