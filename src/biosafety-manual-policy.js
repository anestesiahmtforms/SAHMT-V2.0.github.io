export const MANUAL_HTML_LIMIT=900000;
export const MANUAL_CSP="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
export async function manualSha256(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function validateManualRecord(record){
 if(!record||record.schemaVersion!==1||record.status!=='VERIFIED'||typeof record.title!=='string'||!record.title.trim()||record.title.length>150||!/^[-A-Za-z0-9 ]{1,40}$/.test(record.documentCode||'')||!/^[-A-Za-z0-9.]{1,20}$/.test(record.revision||'')||!/^20\d{2}-\d{2}-\d{2}$/.test(record.issuedOn||'')||!Number.isFinite(Date.parse(record.issuedOn+'T00:00:00Z'))||new Date(record.issuedOn+'T00:00:00Z').toISOString().slice(0,10)!==record.issuedOn||!['sourceSha256','contentSha256'].every(k=>/^[a-f0-9]{64}$/.test(record[k]||''))||typeof record.html!=='string')throw Error('MANUAL_INVALID_RECORD');
 const bytes=new TextEncoder().encode(record.html);
 if(bytes.length>MANUAL_HTML_LIMIT||!record.html.startsWith('<!doctype html>')||!record.html.includes('<meta http-equiv="Content-Security-Policy" content="'+MANUAL_CSP+'">')||/<\s*(?:script|iframe|object|embed|form|input|button|link)\b/i.test(record.html)||/\bon[a-z]+\s*=/i.test(record.html)||await manualSha256(bytes)!==record.contentSha256)throw Error('MANUAL_INVALID_CONTENT');
 return record;
}
