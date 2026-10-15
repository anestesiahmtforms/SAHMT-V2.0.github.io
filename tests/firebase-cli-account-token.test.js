import test from 'node:test';import assert from 'node:assert/strict';
import {firebaseCliAccountToken} from '../scripts/lib/firebase-cli-account-token.js';
test('token acquisition uses a fresh auth module and confirms principal before returning bearer',async()=>{
 let loads=0;const requested=[];
 const loadAuth=()=>{loads++;let cached;return {getAllAccounts:()=>['first','second'].map(x=>({user:{email:x+'@example.invalid'},tokens:{refresh_token:'refresh-'+x}})),
  getAccessToken:async refresh=>cached||=( {access_token:'access-'+refresh,refresh_token:refresh,expires_at:Date.now()+3600000})};};
 const fetchImpl=async(url,options)=>{requested.push({url,options});const identity=options.headers.Authorization.includes('second')?'second':'first';return {ok:true,json:async()=>({email:identity+'@example.invalid',verified_email:true})};};
 assert.equal(await firebaseCliAccountToken('first@example.invalid',{loadAuth,fetchImpl}),'access-refresh-first');
 assert.equal(await firebaseCliAccountToken('second@example.invalid',{loadAuth,fetchImpl}),'access-refresh-second');assert.equal(loads,2);
 assert.ok(requested.every(x=>x.url==='https://www.googleapis.com/oauth2/v2/userinfo'&&x.options.method==='GET'));
});
test('wrong-account cache, refresh token fallback and identity mismatch never reach data calls',async()=>{
 const account={user:{email:'expected@example.invalid'},tokens:{refresh_token:'refresh-secret'}};
 for(const token of [{access_token:'wrong',refresh_token:'other'},{access_token:'refresh-secret'}, {access_token:'access',refresh_token:'refresh-secret',expires_at:Date.now()+3600000}]){
  const loadAuth=()=>({getAllAccounts:()=>[account],getAccessToken:async()=>token});
  await assert.rejects(()=>firebaseCliAccountToken('expected@example.invalid',{loadAuth,fetchImpl:async()=>({ok:true,json:async()=>({email:'other@example.invalid',verified_email:true})})}),/CLI_ACCOUNT_/);
 }
});
