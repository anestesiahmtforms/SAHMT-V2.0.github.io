import test from'node:test';import assert from'node:assert/strict';import {issueRealtimeTicket,verifyRealtimeTicket,broadcastRealtime}from'../worker-operational-channel/realtime.js';
const now=Date.now(),env={OPERATIONAL_CHANNEL_REALTIME_ENABLED:'true',CONTINUITY_IMPORT_SECRET:'synthetic-secret-12345678901234567890'};
const actor={uid:'synthetic',active:true,access:true,expiresAt:now+3600000,permissions:{checklistRead:true}};
test('ticket curto tem assinatura própria e não amplia os módulos autorizados',async()=>{
 const value=await issueRealtimeTicket(env,actor,now),claims=await verifyRealtimeTicket(env,value.ticket,now);
 assert.deepEqual(claims.collections,['checklists']);assert.equal(claims.uid,actor.uid);
 await assert.rejects(()=>verifyRealtimeTicket(env,value.ticket,now+61000),/TICKET_INVALID/);
 await assert.rejects(()=>verifyRealtimeTicket(env,value.ticket.slice(0,-1)+(value.ticket.endsWith('a')?'b':'a'),now),/TICKET_INVALID/);
});
test('aviso contém apenas módulo/dia, respeita escopo e encerra acesso revogado',()=>{
 const output=[],closed=[];const socket=(uid,collections,authorizedUntil)=>({deserializeAttachment:()=>({uid,collections,authorizedUntil}),send:value=>output.push(JSON.parse(value)),close:code=>closed.push(code)});
 const ctx={getWebSockets:()=>[socket('a',['checklists'],now+1),socket('b',['labels'],now+1),socket('c',['checklists'],now-1)]};
 broadcastRealtime(ctx,{collection:'checklists',day:'2026-10-20'},now);assert.deepEqual(output,[{type:'changed',collection:'checklists',day:'2026-10-20'}]);assert.equal(closed.length,1);
 broadcastRealtime(ctx,{uid:'a'},now);assert.equal(closed.length,3);
});
