export const MEMBER_CATEGORIES=Object.freeze({
 EFETIVO:'Membros efetivos',RESIDENTE_1:'Membros residentes 1',RESIDENTE_2:'Membros residentes 2',
 RESIDENTE_3:'Membros residentes 3',SUBSTITUTO:'Membros substitutos',ADMINISTRADOR:'Membros administradores',GESTOR:'Membros gestores'
});
export const MEMBER_CATEGORY_IDS=Object.freeze(Object.keys(MEMBER_CATEGORIES));
const affiliations=new Set(['EFETIVO','RESIDENTE_1','RESIDENTE_2','RESIDENTE_3','SUBSTITUTO']);
export function normalizeMemberCategories(value){
 if(!Array.isArray(value)||value.some(id=>!MEMBER_CATEGORY_IDS.includes(id))||new Set(value).size!==value.length)throw Error('MEMBER_CATEGORIES_INVALID');
 if(value.filter(id=>affiliations.has(id)).length>1)throw Error('MEMBER_AFFILIATION_CONFLICT');
 return MEMBER_CATEGORY_IDS.filter(id=>value.includes(id));
}
export function memberCategoryLabels(value=[]){return normalizeMemberCategories(value).map(id=>MEMBER_CATEGORIES[id]);}
export function memberCategoriesForProfile(profile){return normalizeMemberCategories(profile?.memberCategories||[]);}
// Category membership is descriptive. It never grants an operational permission.
export function memberMatchesCategory(profile,category){return MEMBER_CATEGORY_IDS.includes(category)&&memberCategoriesForProfile(profile).includes(category);}
export function mergeMemberCategoryAssignments(profiles,assignments){
 const byUid=new Map();for(const row of assignments){
  if(row.schemaVersion!==1||row.identityStatus!=='LINKED'||!row.uid)continue;
  if(byUid.has(row.uid))throw Error('MEMBER_UID_AMBIGUOUS');
  byUid.set(row.uid,{email:String(row.email||'').toLowerCase(),memberCategories:normalizeMemberCategories(row.memberCategories)});
 }
 return profiles.map(profile=>{const assigned=byUid.get(profile.uid);return {...profile,memberCategories:assigned&&assigned.email===String(profile.email||'').trim().toLowerCase()?assigned.memberCategories:[]};});
}
export function memberCategoryCounts(assignments){
 return Object.fromEntries(MEMBER_CATEGORY_IDS.map(id=>[id,assignments.filter(row=>normalizeMemberCategories(row.memberCategories).includes(id)).length]));
}
export function buildMemberCategoryRoster(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(id=>!MEMBER_CATEGORY_IDS.includes(id)))throw Error('MEMBER_ROSTER_INVALID');
 const members=new Map();
 for(const category of MEMBER_CATEGORY_IDS){
  if(!Array.isArray(input[category]))throw Error('MEMBER_ROSTER_INVALID');
  const seen=new Set();for(const raw of input[category]){
   const email=typeof raw==='string'?raw.trim().toLowerCase():'';
   if(!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email)||seen.has(email))throw Error('MEMBER_EMAIL_INVALID_OR_DUPLICATE');
   seen.add(email);if(!members.has(email))members.set(email,[]);members.get(email).push(category);
  }
 }
 return [...members].map(([email,categories])=>({email,memberCategories:normalizeMemberCategories(categories)})).sort((a,b)=>a.email.localeCompare(b.email));
}
