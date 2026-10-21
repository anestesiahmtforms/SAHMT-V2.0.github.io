import {CHANNEL_COLLECTIONS,validDay} from './provisional-channel-contract.js';
const validChannelEndpoint=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/v1/operational-channel';}catch{return false;}};

export function createChannelRealtimeClient({endpoint,getUid,requestTicket,createSocket=(url,protocols)=>new WebSocket(url,protocols),
 now=Date.now,online=()=>globalThis.navigator?.onLine!==false,documentSource=globalThis.document,eventTarget=globalThis.window,
 onSignal=()=>{},onConnected=()=>{},onRevalidate=async()=>{},onStatus=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let started=false,epoch=0,uid=null,socket=null,flight=null,retryTimer=null,renewTimer=null,pingTimer=null,signalTimer=null,handshakeTimer=null,retryMs=5000,lastPong=0;
 const signals=new Map(),url=validChannelEndpoint(endpoint)?endpoint.replace(/^https:/,'wss:')+'/events':null;
 const visible=()=>documentSource?.visibilityState!=='hidden';
 const current=(who,generation)=>started&&who&&getUid()===who&&epoch===generation&&online()&&visible();
 const clear=()=>{for(const timer of [retryTimer,renewTimer,pingTimer,signalTimer,handshakeTimer])if(timer!==null)clearTimer(timer);retryTimer=renewTimer=pingTimer=signalTimer=handshakeTimer=null;signals.clear();};
 function close(){epoch++;clear();const old=socket;socket=null;try{old?.close(1000,'Session changed');}catch{}}
 function retry(){if(!started||!getUid()||!online()||!visible()||retryTimer!==null)return;retryTimer=setTimer(()=>{retryTimer=null;void connect();},retryMs);retryMs=Math.min(300000,retryMs*3);}
 async function connect(){
  if(!url||!started||!getUid()||!online()||!visible()||socket||flight)return;
  const who=getUid(),generation=epoch;uid=who;
  flight=(async()=>{
   try{
    const ticket=await requestTicket(who);if(!current(who,generation))return;
    if(ticket?.code!=='CHANNEL_REALTIME_TICKET'||typeof ticket.ticket!=='string'||ticket.ticket.length>1600||!Number.isSafeInteger(ticket.authorizedUntil)||ticket.authorizedUntil<=now())throw Error('CHANNEL_REALTIME_TICKET_INVALID');
    const connection=createSocket(url,['sahmt-channel-v1',ticket.ticket]);socket=connection;
    const live=()=>socket===connection&&current(who,generation);
    handshakeTimer=setTimer(()=>{if(!live()||connection.readyState===1)return;socket=null;clear();try{connection.close(4000,'Connection timeout');}catch{}onStatus({code:'CHANNEL_REALTIME_FALLBACK'});retry();},10000);
    connection.addEventListener('open',()=>{
     if(!live())return;clearTimer(handshakeTimer);handshakeTimer=null;retryMs=5000;lastPong=now();try{connection.send('ping');}catch{}onStatus({code:'CHANNEL_REALTIME_CONNECTED'});onConnected();
     const ping=()=>{if(!live())return;if(now()-lastPong>75000){connection.close(4000,'Connection stale');return;}try{connection.send('ping');}catch{}pingTimer=setTimer(ping,30000);};pingTimer=setTimer(ping,30000);
     renewTimer=setTimer(()=>{if(!live())return;socket=null;clear();connection.close(1000,'Renew authorization');void connect();},Math.max(1000,Math.min(15*60000,ticket.authorizedUntil-now()-10000)));
    });
    connection.addEventListener('message',event=>{
     if(!live())return;if(event.data==='pong'){lastPong=now();return;}
     let message;try{if(typeof event.data!=='string'||event.data.length>256)throw Error();message=JSON.parse(event.data);if(message.type!=='changed'||!CHANNEL_COLLECTIONS.includes(message.collection)||message.day!==null&&!validDay(message.day)||Object.keys(message).some(key=>!['type','collection','day'].includes(key)))throw Error();}catch{connection.close(4002,'Invalid signal');return;}
     lastPong=now();signals.set(message.collection+':'+message.day,message);
     if(signalTimer===null)signalTimer=setTimer(()=>{signalTimer=null;const batch=[...signals.values()];signals.clear();if(live())for(const signal of batch)onSignal(signal);},250);
    });
    connection.addEventListener('close',event=>{
     if(socket!==connection)return;socket=null;clear();if(!current(who,generation))return;
     onStatus({code:'CHANNEL_REALTIME_FALLBACK'});
     if(event.code===4001)Promise.resolve(onRevalidate(who)).catch(()=>{}).finally(retry);else retry();
    });
    connection.addEventListener('error',()=>{if(socket!==connection)return;socket=null;clear();try{connection.close();}catch{}onStatus({code:'CHANNEL_REALTIME_FALLBACK'});retry();});
   }catch{if(current(who,generation)){onStatus({code:'CHANNEL_REALTIME_FALLBACK'});retry();}}
   finally{flight=null;}
  })();return flight;
 }
 async function sessionChanged(){
  if(uid!==getUid()||!online()||!visible()){close();uid=getUid();}
  if(started&&getUid()&&online()&&visible()){await flight;return connect();}
 }
 function start(){if(started)return;started=true;eventTarget?.addEventListener('online',sessionChanged);eventTarget?.addEventListener('offline',sessionChanged);documentSource?.addEventListener('visibilitychange',sessionChanged);void sessionChanged();}
 function stop(){started=false;close();eventTarget?.removeEventListener('online',sessionChanged);eventTarget?.removeEventListener('offline',sessionChanged);documentSource?.removeEventListener('visibilitychange',sessionChanged);}
 return {start,stop,sessionChanged,get connected(){return Boolean(socket?.readyState===1);}};
}
