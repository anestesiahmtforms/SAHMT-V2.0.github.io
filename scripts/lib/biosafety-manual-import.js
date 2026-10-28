import parse5 from 'parse5';
const tags=new Set(['html','head','meta','title','style','body','header','nav','details','summary','ol','ul','li','main','footer','p','div','span','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','b','strong','em','i','u','sup','sub','br','img','a','blockquote','hr','figure']);
const attrs=new Set(['lang','charset','name','content','http-equiv','id','class','aria-label','aria-hidden','role','tabindex','rowspan','colspan','scope','loading','decoding','alt','src','href','style','data-source-figure','width','height']);
export function validateManualHtmlStructure(html){
 const tree=parse5.parse(html);let images=0,tables=0,headings=0;
 function walk(node){
  if(node.tagName){
   if(!tags.has(node.tagName))throw Error('MANUAL_UNSAFE_TAG');
   for(const attr of node.attrs||[]){
    if(attr.namespace||!attrs.has(attr.name))throw Error('MANUAL_UNSAFE_ATTRIBUTE');
    if(['width','height'].includes(attr.name)&&(node.tagName!=='img'||!/^\d{1,4}$/.test(attr.value)||Number(attr.value)<1))throw Error('MANUAL_INVALID_DIMENSIONS');
    if(attr.name==='src'&&(node.tagName!=='img'||!/^data:image\/(?:jpeg|png|gif);base64,[a-z0-9+/=]+$/i.test(attr.value)))throw Error('MANUAL_EXTERNAL_RESOURCE');
    if(attr.name==='href'&&(node.tagName!=='a'||!/^(?:about:srcdoc)?#[a-z0-9_-]+$/i.test(attr.value)))throw Error('MANUAL_EXTERNAL_LINK');
    if(attr.name==='style'&&!/^color:(?:#[a-f0-9]{3,6}|red|blue|maroon)$/i.test(attr.value))throw Error('MANUAL_UNSAFE_STYLE');
   }
   if(node.tagName==='style'&&/(?:url\s*\(|@import|expression\s*\(|javascript:|(?:^|[;{])\s*behavior\s*:|-moz-binding)/i.test((node.childNodes||[]).map(n=>n.value||'').join('')))throw Error('MANUAL_UNSAFE_STYLE');
   if(node.tagName==='img')images++;if(node.tagName==='table')tables++;if(/^h[1-6]$/.test(node.tagName))headings++;
  }
  for(const child of node.childNodes||[])walk(child);
 }
 walk(tree);return {images,tables,headings};
}
