// Only server-owned adapters may construct these records. Browser input is never an ACL.
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
export function assertActor(actor, admin=false) {
 if(!actor?.uid || actor.profile?.active!==true || actor.profile?.access!==true) throw Error('FORBIDDEN');
 if(admin && actor.profile.role!=='administrador_app' && actor.profile.permissions?.admin!==true) throw Error('FORBIDDEN');
}
const categories=new Set(['GENERAL','GERAL','PROTOCOLO','PROTOCOLOS','ROP','ROPS','DIRETRIZ','DIRETRIZES','OUTROS DOCUMENTOS','ADMINISTRATIVE','ORGANOGRAM']);
export function canReadRecord(actor,r) {
 if(!r || r.schemaVersion!==1 || !/^F[A-J]$/.test(r.source) || typeof r.active!=='boolean' || r.deleted===true || r.identityAmbiguous===true || r.classificationAmbiguous===true || r.anonymous===true) return false;
 if(typeof r.id!=='string'||!r.id||r.id.length>200||typeof r.title!=='string'||typeof r.text!=='string'||!r.version) return false;
 if(r.sourceAccess!=='ACTIVE' && !(r.sourceAccess==='EXPLICIT'&&Array.isArray(r.sourceAllowedUids)&&r.sourceAllowedUids.includes(actor.uid))) return false;
 if(r.kind==='general') return r.audience==='GENERAL';
 if(r.kind==='operational') return r.audience==='INVOLVED' && (r.authorUid===actor.uid || r.participantUids?.includes(actor.uid)===true);
 if(r.kind==='notification') return r.audience==='INVOLVED' && Array.isArray(r.recipientUids) && r.recipientUids.includes(actor.uid);
 if(r.kind!=='document'||!['GENERAL','RESTRICTED'].includes(r.audience)) return false;
 const category=normalize(r.category);
 const legacy=/DOCUMENTOS? ADMINISTRATIV|ADMINISTRATIVE|ORGANOGRAMA|ORGANOGRAM/.test(category)||/ORGANOGRAMA/.test(normalize(r.title));
 if(!legacy&&!categories.has(category)) return false;
 const restricted=r.audience==='RESTRICTED'||legacy;
 if(restricted) return actor.memberCategories?.includes('EFETIVO')===true && r.sourceAccess==='EXPLICIT' && r.sourceAllowedUids?.includes(actor.uid)===true;
 return true;
}
export function safeLink(value) {
 if(typeof value!=='string'||value.length>2048)return '';
 if(/^\/(?!\/)[^\\\s]*$/.test(value)||/^#[^\s]*$/.test(value))return value;
 try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&['anestesiahmtforms.github.io','drive.google.com','docs.google.com'].includes(u.hostname)?u.href:'';}catch{return '';}
}
export function validateEvidence(ids,allowed) {
 return Array.isArray(ids)&&ids.length>0&&ids.length<=30&&ids.every(id=>typeof id==='string'&&allowed.has(id));
}
