const SYSTEM_OWNER_EMAILS=new Set([
 'anestesiahmtforms@gmail.com',
 'anestesiahmtforms2@gmail.com',
 'anestesiahmtforms3@gmail.com',
 'anestesiahmtforms4@gmail.com',
 'anestesiahmtforms5@gmail.com',
 'anestesiahmtforms6@gmail.com'
]);

export function isSystemOwnerEmail(value){
 return typeof value==='string'&&SYSTEM_OWNER_EMAILS.has(value.trim().toLowerCase());
}
