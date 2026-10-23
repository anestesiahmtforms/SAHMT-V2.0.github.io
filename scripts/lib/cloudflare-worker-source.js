const demand=(ok,code)=>{if(!ok)throw Error(code);};
// The transport boundary changes on every Cloudflare GET. Validate the exact
// reviewed single-module layout and return only the module's source bytes.
export async function cloudflareWorkerSource(response){
 demand(/^multipart\/form-data;/i.test(response?.contentType||''),'FC_WORKER_SOURCE_FORMAT_INVALID');
 const form=await new Response(response.content,{headers:{'Content-Type':response.contentType}}).formData();
 const entries=[...form];
 demand(entries.length===1&&entries[0][0]==='worker.js','FC_WORKER_UNREVIEWED_MODULES');
 const value=entries[0][1];return typeof value==='string'?value:await value.text();
}
