export const MEMBER_CATEGORY_RULES=`
    // MEMBER_CATEGORIES_V1: descriptive membership, never an automatic grant.
    function memberCategoryActive_() {
      let p = /databases/$(database)/documents/users/$(request.auth.uid);
      return request.auth != null && exists(p) && get(p).data.uid == request.auth.uid &&
        get(p).data.active == true && get(p).data.access == true;
    }
    function memberCategoryAdmin_() {
      let p = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
      return memberCategoryActive_() && (p.role == 'administrador_app' ||
        p.get('permissions', {}).get('admin', false) == true || p.get('permissions', {}).get('usersManage', false) == true);
    }
    match /userCategories/{id} {
      allow read: if memberCategoryActive_() && (memberCategoryAdmin_() ||
        (resource.data.uid == request.auth.uid && request.auth.token.get('email_verified', false) == true &&
         resource.data.email == request.auth.token.get('email', '').lower()));
      allow write: if false;
    }
    match /userCategoryDefinitions/{id} {
      allow read: if memberCategoryActive_();
      allow write: if false;
    }
    // END_MEMBER_CATEGORIES_V1
`;
export function addMemberCategoryRules(source){
 if(typeof source!=='string'||!source.includes('match /databases/{database}/documents {'))throw Error('CATEGORY_RULE_SOURCE_INVALID');
 if(source.includes('MEMBER_CATEGORIES_V1'))return source;
 if(/match\s+\/(?:userCategories|userCategoryDefinitions)\//.test(source))throw Error('CATEGORY_RULE_CONFLICT');
 return source.replace('match /databases/{database}/documents {','match /databases/{database}/documents {'+MEMBER_CATEGORY_RULES);
}
export function memberCategoryRuleTestSuite(){
 const cases=[];
 const add=(name,{admin=false,active=true,uid='member',email='member@example.test',verified=true,owner='member',method='get',collection='userCategories',signed=true,categoryAdmin=false,role='anestesiologista'}={},expectation='ALLOW')=>{
  const profile={uid,active,access:true,role,permissions:admin?{usersManage:true}:{},memberCategories:categoryAdmin?['ADMINISTRADOR']:[]};
  cases.push({expectation,request:{path:`/databases/(default)/documents/${collection}/synthetic`,method,auth:signed?{uid,token:{email,email_verified:verified}}:null},resource:{data:{uid:owner,email:'member@example.test'}},
   functionMocks:[{function:'exists',args:[{anyValue:{}}],result:{value:true}},{function:'get',args:[{anyValue:{}}],result:{value:{data:profile}}}]});
 };
 add('own');add('other',{owner:'other'},'DENY');add('unverified',{verified:false},'DENY');add('email mismatch',{email:'another@example.test'},'DENY');
 add('inactive',{active:false},'DENY');add('signed out',{signed:false},'DENY');add('admin',{admin:true,owner:'other'});add('admin list',{admin:true,method:'list'});
 add('category does not grant admin',{categoryAdmin:true,owner:'other'},'DENY');add('own write',{method:'create'},'DENY');add('admin write',{admin:true,method:'update'},'DENY');
 add('definitions',{collection:'userCategoryDefinitions'});add('definitions write',{admin:true,collection:'userCategoryDefinitions',method:'delete'},'DENY');
 return {testCases:cases};
}
