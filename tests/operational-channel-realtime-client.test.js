import test from'node:test';import assert from'node:assert/strict';import{createChannelRealtimeClient}from'../src/operational-channel-realtime-client.js';
function harness(){
 let uid='synthetic',now=100000,visible=true;const sockets=[],signals=[],timers=new Map();let serial=0,tickets=0;
 const doc=new EventTarget();Object.defineProperty(doc,'visibilityState',{get:()=>visible?'visible':'hidden'});
 const events=new EventTarget();
 class Socket extends EventTarget{constructor(url,protocols){super();this.url=url;this.protocols=protocols;this.readyState=0;this.sent=[];sockets.push(this);}send(value){this.sent.push(value);}close(){this.readyState=3;}open(){this.readyState=1;this.dispatchEvent(new Event('open'));}message(data){const e=new Event('message');e.data=data;this.dispatchEvent(e);}}
 const client=createChannelRealtimeClient({endpoint:'https://channel.example/v1/operational-channel',getUid:()=>uid,online:()=>true,documentSource:doc,eventTarget:events,now:()=>now,
  requestTicket:async()=>{tickets++;return {code:'CHANNEL_REALTIME_TICKET',ticket:'synthetic.one-use-ticket',authorizedUntil:now+900000};},createSocket:(url,protocols)=>new Socket(url,protocols),onSignal:signal=>signals.push(signal),setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimer:id=>timers.delete(id)});
 return {client,sockets,signals,timers,get tickets(){return tickets;},setUid:value=>{uid=value;},hide(){visible=false;doc.dispatchEvent(new Event('visibilitychange'));},show(){visible=true;doc.dispatchEvent(new Event('visibilitychange'));},tick(ms){const entry=[...timers].find(([,item])=>item.ms===ms);if(entry){timers.delete(entry[0]);entry[1].fn();}}};
}
const settle=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test('conecta sem credenciais na URL e agrupa avisos por módulo/dia',async()=>{
 const h=harness();h.client.start();await settle();assert.equal(h.sockets.length,1);
 const socket=h.sockets[0];assert.equal(socket.url,'wss://channel.example/v1/operational-channel/events');assert.equal(socket.protocols[0],'sahmt-channel-v1');socket.open();
 socket.message(JSON.stringify({type:'changed',collection:'checklists',day:'2026-10-20'}));socket.message(JSON.stringify({type:'changed',collection:'checklists',day:'2026-10-20'}));h.tick(250);assert.equal(h.signals.length,1);assert.equal(h.client.connected,true);h.client.stop();
});
test('troca de conta e tela em segundo plano fecham a conexão anterior',async()=>{
 const h=harness();h.client.start();await settle();const old=h.sockets[0];old.open();h.setUid('other');await h.client.sessionChanged();await settle();assert.equal(old.readyState,3);assert.equal(h.sockets.length,2);
 h.hide();assert.equal(h.sockets[1].readyState,3);h.show();await settle();assert.equal(h.sockets.length,3);h.client.stop();
});
test('resposta tardia não abre socket depois de logout e mensagem inválida não vira aviso',async()=>{
 const h=harness();h.client.start();h.setUid(null);await h.client.sessionChanged();await settle();assert.equal(h.sockets.length,0);h.client.stop();
});
test('mensagem inválida fecha conexão e não publica dados recebidos',async()=>{
 const h=harness();h.client.start();await settle();const socket=h.sockets[0];socket.open();socket.message(JSON.stringify({type:'changed',collection:'checklists',day:'2026-10-20',data:{secret:'synthetic'}}));h.tick(250);assert.equal(socket.readyState,3);assert.equal(h.signals.length,0);h.client.stop();
});
test('conexão sem resposta expira e tenta novamente com espera progressiva',async()=>{
 const h=harness();h.client.start();await settle();h.tick(10000);assert.equal(h.sockets[0].readyState,3);h.tick(5000);await settle();assert.equal(h.sockets.length,2);h.client.stop();
});
