import {CHANNEL_COLLECTIONS,CHANNEL_GRANT_MS,canReadChannelCollection,validId,validDay,channelError} from '../src/provisional-channel-contract.js';
const PROTOCOL='sahmt-channel-v1',PURPOSE='SAHMT_CHANNEL_NOTIFY_V1\n';
const fail=(code,status=403)=>{throw channelError(code,status);};
const encode=text=>btoa(text).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const decode=text=>atob(text.replace(/-/g,'+').replace(/_/g,'/'));
async function mac(secret,text){if(typeof secret!=='string'||secret.length<32)fail('CHANNEL_REALTIME_NOT_CONFIGURED',503);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(PURPOSE+text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function issueRealtimeTicket(env,actor,now){
 if(env.OPERATIONAL_CHANNEL_REALTIME_ENABLED!=='true')fail('CHANNEL_REALTIME_DISABLED',503);
 if(!validId(actor?.uid)||!actor.active||!actor.access||actor.expiresAt<=now)fail('CHANNEL_USER_DENIED');
 const claims={v:1,uid:actor.uid,jti:crypto.randomUUID().replace(/-/g,''),issuedAt:now,expiresAt:now+60000,authorizedUntil:Math.min(actor.expiresAt,now+15*60000),collections:CHANNEL_COLLECTIONS.filter(collection=>canReadChannelCollection(collection,actor))};
 const payload=encode(JSON.stringify(claims));return {code:'CHANNEL_REALTIME_TICKET',ticket:payload+'.'+await mac(env.CONTINUITY_IMPORT_SECRET,payload),authorizedUntil:claims.authorizedUntil};
}
export async function verifyRealtimeTicket(env,ticket,now){
 if(typeof ticket!=='string'||ticket.length>1600)fail('CHANNEL_REALTIME_TICKET_INVALID');
 const [payload,signature,...extra]=ticket.split('.');if(extra.length||!/^[A-Za-z0-9_-]+$/.test(payload||'')||!/^[a-f0-9]{64}$/.test(signature||''))fail('CHANNEL_REALTIME_TICKET_INVALID');
 const expected=await mac(env.CONTINUITY_IMPORT_SECRET,payload);let difference=0;for(let i=0;i<64;i++)difference|=signature.charCodeAt(i)^expected.charCodeAt(i);if(difference)fail('CHANNEL_REALTIME_TICKET_INVALID');
 let claims;try{claims=JSON.parse(decode(payload));}catch{fail('CHANNEL_REALTIME_TICKET_INVALID');}
 if(claims.v!==1||!validId(claims.uid)||!/^[a-f0-9]{32}$/.test(claims.jti)||!Number.isSafeInteger(claims.issuedAt)||claims.issuedAt>now||!Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<=now||claims.expiresAt-claims.issuedAt>60000||!Number.isSafeInteger(claims.authorizedUntil)||claims.authorizedUntil<=now||claims.authorizedUntil-claims.issuedAt>15*60000||!Array.isArray(claims.collections)||claims.collections.some(value=>!CHANNEL_COLLECTIONS.includes(value)))fail('CHANNEL_REALTIME_TICKET_INVALID');
 return claims;
}
export function setupRealtime(sql){sql.exec('CREATE TABLE IF NOT EXISTS channel_ws_tickets (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)');}
export function acceptRealtimeSocket(ctx,sql,claims,now){
 if(claims.expiresAt<=now||claims.authorizedUntil<=now)fail('CHANNEL_REALTIME_TICKET_INVALID');
 sql.exec('DELETE FROM channel_ws_tickets WHERE expires_at<?',now);
 if(sql.exec('SELECT id FROM channel_ws_tickets WHERE id=?',claims.jti).toArray().length)fail('CHANNEL_REALTIME_TICKET_REPLAY');
 if(sql.exec('SELECT COUNT(*) AS count FROM channel_ws_tickets').one().count>=1000)fail('CHANNEL_REALTIME_CAPACITY',503);
 const pair=new WebSocketPair(),[client,server]=Object.values(pair);
 sql.exec('INSERT INTO channel_ws_tickets VALUES(?,?)',claims.jti,claims.expiresAt);
 ctx.acceptWebSocket(server);server.serializeAttachment(claims);
 if(typeof ctx.setWebSocketAutoResponse==='function'&&typeof WebSocketRequestResponsePair==='function')ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
 return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':PROTOCOL}});
}
export function realtimeSocketMessage(socket,message,now){
 const claims=socket.deserializeAttachment();
 if(!claims||claims.authorizedUntil<=now){socket.close(4001,'Revalidate authorization');return;}
 if(message==='ping'){socket.send('pong');return;}
 socket.close(1008,'Notifications only');
}
export function broadcastRealtime(ctx,{collection,day,uid},now){
 if(uid&&!validId(uid)||!uid&&(!CHANNEL_COLLECTIONS.includes(collection)||day!==null&&!validDay(day)))fail('CHANNEL_REALTIME_SIGNAL_INVALID',400);
 let notified=0;
 for(const socket of ctx.getWebSockets()){
  const claims=socket.deserializeAttachment();
  if(!claims||claims.authorizedUntil<=now||uid&&claims.uid===uid){try{socket.close(4001,'Revalidate authorization');}catch{}continue;}
  if(!uid&&claims.collections.includes(collection)){try{socket.send(JSON.stringify({type:'changed',collection,day}));notified++;}catch{}}
 }
 return Response.json({code:'CHANNEL_REALTIME_NOTIFIED',notified});
}
export async function notifyRealtime(env,collection,day,uid){
 if(env.OPERATIONAL_CHANNEL_REALTIME_ENABLED!=='true')return;
 // Notifications are best effort after durable writes; polling repairs a lost signal.
 try{
  const hub=env.OPERATIONAL_CHANNEL_STATE.get(env.OPERATIONAL_CHANNEL_STATE.idFromName('continuity:signals'));
  const r=await hub.fetch(new Request('https://channel.internal/realtime-notify',{method:'POST',body:JSON.stringify({collection,day,uid})}));await r.body?.cancel();
 }catch{}
}
export async function notifyRealtimeSourceChange(env,path,data,now){
 const [kind,id]=path.split('/');
 if(kind==='users')return notifyRealtime(env,undefined,undefined,id);
 const collections={scheduleDays:['scheduleReleases'],events:['events'],labels:['labels'],checklists:['checklists'],stations:['checklists'],contacts:['events','labels'],eventMembers:['events'],eventCatalogs:['events'],vacations:['scheduleReleases'],appConfig:id==='labelStaff'?['labels']:CHANNEL_COLLECTIONS}[kind]||[];
 const day=kind==='scheduleDays'&&validDay(id)?id:validDay(data?.date)?data.date:null;
 for(const collection of collections)await notifyRealtime(env,collection,day);
}
export async function upgradeRealtime(request,env,now){
 if(env.OPERATIONAL_CHANNEL_REALTIME_ENABLED!=='true')fail('CHANNEL_REALTIME_DISABLED',503);
 const protocols=(request.headers.get('Sec-WebSocket-Protocol')||'').split(',').map(value=>value.trim());
 if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket'||protocols.length!==2||protocols[0]!==PROTOCOL)fail('CHANNEL_REALTIME_UPGRADE_INVALID',400);
 const claims=await verifyRealtimeTicket(env,protocols[1],now);
 const auth=env.OPERATIONAL_CHANNEL_AUTHORIZATION.get(env.OPERATIONAL_CHANNEL_AUTHORIZATION.idFromName(claims.uid));
 const result=await (await auth.fetch(new Request('https://channel.internal/get',{method:'POST',body:JSON.stringify({now})}))).json(),actor=result.actor;
 if(result.revoked||actor?.uid!==claims.uid||!actor.active||!actor.access||actor.expiresAt<=now||actor.verifiedAt>now||actor.expiresAt-actor.verifiedAt>CHANNEL_GRANT_MS||claims.collections.some(collection=>!canReadChannelCollection(collection,actor)))fail('CHANNEL_USER_DENIED');
 claims.authorizedUntil=Math.min(claims.authorizedUntil,actor.expiresAt);
 const hub=env.OPERATIONAL_CHANNEL_STATE.get(env.OPERATIONAL_CHANNEL_STATE.idFromName('continuity:signals'));
 return hub.fetch(new Request('https://channel.internal/realtime-connect',{headers:{Upgrade:'websocket','X-Realtime-Grant':JSON.stringify(claims)}}));
}
