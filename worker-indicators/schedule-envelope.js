import {Buffer} from 'node:buffer';
export const FD_FIXED_CRON='0 5 * * *';
export function scheduleWindow(time){
 const d=new Date(time);if(!Number.isFinite(time)||!Number.isFinite(d.getTime())||d.getUTCHours()!==5||d.getUTCMinutes()!==0||d.getUTCSeconds()!==0||d.getUTCMilliseconds()!==0)return null;
 const local=new Date(time-10800000),day=local.toISOString().slice(0,10),hour=local.getUTCHours(),year=local.getUTCFullYear();return {id:day+'_02',day,hour,year};
}
async function key(secret){if(!/^[A-Za-z0-9_-]{43}$/.test(secret||''))throw Error('FD_SCHEDULE_CONFIG_REQUIRED');return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signSchedule(body,secret){const payload=JSON.stringify(body),signature=Buffer.from(await crypto.subtle.sign('HMAC',await key(secret),new TextEncoder().encode(payload))).toString('base64url');return {payload,signature};}
export async function verifySchedule(envelope,secret,now=Date.now()){
 if(!envelope||Object.keys(envelope).sort().join()!=='payload,signature'||typeof envelope.payload!=='string'||envelope.payload.length>4096||!/^[A-Za-z0-9_-]{43}$/.test(envelope.signature||''))throw Error('FD_SCHEDULE_DENIED');
 const valid=await crypto.subtle.verify('HMAC',await key(secret),Buffer.from(envelope.signature,'base64url'),new TextEncoder().encode(envelope.payload));if(!valid)throw Error('FD_SCHEDULE_DENIED');
 const b=JSON.parse(envelope.payload),window=scheduleWindow(b.scheduledTime);
 if(!window||!Number.isSafeInteger(b.issuedAt)||b.issuedAt>now+5000||b.issuedAt<now-60000||b.scheduledTime>now+5000||b.scheduledTime<now-3600000||b.action!=='PERFORMANCE')throw Error('FD_SCHEDULE_DENIED');return b;
}
