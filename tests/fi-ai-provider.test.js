import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../worker-fi-control/ai-provider.js').catch(()=>({}));
test('Responses adapter pins model, disables storage/tools and uses strict schema',async()=>{
 assert.equal(typeof mod.createOpenAIProvider,'function');let body;
 const provider=mod.createOpenAIProvider({apiKey:'synthetic',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:'A',actions:[],technicalRecommendations:[]})}]}],usage:{input_tokens:10,output_tokens:5}}),{status:200});}});
 const result=await provider.generate({kind:'monthly',period:'2026-10',context:{indicators:[]}});
 assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.deepEqual(body.reasoning,{effort:'none'});assert.deepEqual(body.tools,[]);assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);assert.deepEqual(result.usage,{inputTokens:10,outputTokens:5});assert.equal(result.data.summary,'A');
 await assert.rejects(provider.generate({kind:'search'}),/PROVIDER_INPUT_INVALID/);
});
test('missing key disables provider and refusal/incomplete responses are rejected',async()=>{
 assert.equal(typeof mod.createOpenAIProvider,'function');assert.equal(mod.createOpenAIProvider({}).enabled,false);
 for(const payload of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}]){
 const p=mod.createOpenAIProvider({apiKey:'synthetic',fetchImpl:async()=>new Response(JSON.stringify(payload))});await assert.rejects(p.generate({kind:'monthly',period:'2026-10',context:{indicators:[]}}),/PROVIDER/);
 }
});
test('an upstream redirect is refused without forwarding the API key',async()=>{
 let calls=0;
 const provider=mod.createOpenAIProvider({apiKey:'synthetic',fetchImpl:async(_url,options)=>{
  calls++;
  assert.equal(options.redirect,'manual');
  return new Response(null,{status:307,headers:{Location:'https://example.test/redirect'}});
 }});
 await assert.rejects(provider.generate({kind:'monthly',period:'2026-10',context:{indicators:[]}}),/PROVIDER_UNAVAILABLE/);
 assert.equal(calls,1);
});
