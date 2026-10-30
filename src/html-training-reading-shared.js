// Alignment checks only; this fingerprint is not an authentication primitive.
export function readingFingerprint(value){let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return (n>>>0).toString(16);}
export function readingImage(attrs){
 const width=Number(attrs.width),height=Number(attrs.height);
 return !(/logo/i.test(attrs.alt||'')||(width>0&&width<=100&&height>0&&height<=100));
}
export const readingSignature=(kind,value)=>readingFingerprint(kind+'\n'+value);
export function readingTextParts(text){
 const words=[...text.matchAll(/\S+/gu)],parts=[];let start=null,end=0,count=0;
 const flush=()=>{if(start!==null)parts.push({from:start,to:end,words:count});start=null;count=0;};
 for(const word of words){
  if(start!==null&&(count>=30||word.index+word[0].length-start>240))flush();
  if(word[0].length>240){flush();for(let at=word.index;at<word.index+word[0].length;at+=240)parts.push({from:at,to:Math.min(at+240,word.index+word[0].length),words:1});continue;}
  start??=word.index;end=word.index+word[0].length;count++;
 }
 flush();return parts;
}
