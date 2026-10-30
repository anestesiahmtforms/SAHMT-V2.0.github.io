import parse5 from 'parse5';
import {createHash} from 'node:crypto';
import {readingImage,readingSignature,readingTextParts} from '../src/html-training-reading-shared.js';
export function buildReadingPlan(sections){
 const nodes=[],blocks=[];
 for(const [section,item]of sections.entries()){
  function visit(node){
   if(node.nodeName==='#text'&&node.value.trim()){
    const index=nodes.length;nodes.push({section,kind:'text',signature:readingSignature('text',node.value)});
    for(const part of readingTextParts(node.value))blocks.push({node:index,section,...part,requiredMs:part.words*300});
   }else if(node.tagName==='img'){
    const attrs=Object.fromEntries(node.attrs.map(a=>[a.name,a.value]));
    if(readingImage(attrs)){const index=nodes.length;nodes.push({section,kind:'image',signature:readingSignature('image',attrs.src||'')});blocks.push({node:index,section,requiredMs:5000});}
   }
   for(const child of node.childNodes||[])visit(child);
  }
  visit(parse5.parseFragment(item.html));
 }
 const initial=blocks.reduce((n,b)=>n+b.requiredMs,0);
 if(initial>0&&initial<15000)for(const block of blocks)block.requiredMs=Math.ceil(block.requiredMs*15000/initial);
 const plan={schemaVersion:1,wordsPerMinute:200,nodes,blocks,totalRequiredMs:blocks.reduce((n,b)=>n+b.requiredMs,0)};
 return {...plan,hash:createHash('sha256').update(JSON.stringify(plan)).digest('hex')};
}
