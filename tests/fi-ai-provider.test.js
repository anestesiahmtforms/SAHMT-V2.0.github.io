import test from 'node:test';
import assert from 'node:assert/strict';
const mod=await import('../worker-fi-control/ai-provider.js').catch(()=>({}));
test('Responses adapter pins model, disables storage/tools and uses strict schema',async()=>{
 assert.equal(typeof mod.createOpenAIProvider,'function');let body;
 const provider=mod.createOpenAIProvider({apiKey:'synthetic',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({answer:'A',citations:['a']})}]}],usage:{input_tokens:10,output_tokens:5}}),{status:200});}});
 const result=await provider.generate({kind:'search',query:'protocolo',context:[{id:'a',text:'protocolo'}]});
 assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.deepEqual(body.reasoning,{effort:'none'});assert.deepEqual(body.tools,[]);assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);assert.deepEqual(result.usage,{inputTokens:10,outputTokens:5});assert.equal(result.data.answer,'A');
});
test('missing key disables provider and refusal/incomplete responses are rejected',async()=>{
 assert.equal(typeof mod.createOpenAIProvider,'function');assert.equal(mod.createOpenAIProvider({}).enabled,false);
 for(const payload of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'No'}]}]}]){
 const p=mod.createOpenAIProvider({apiKey:'synthetic',fetchImpl:async()=>new Response(JSON.stringify(payload))});await assert.rejects(p.generate({kind:'search',query:'x',context:[]}),/PROVIDER/);
 }
});
