import test from 'node:test';
import assert from 'node:assert/strict';
import {openAppUpdatePanel} from '../src/app-updates-targeted-admin.js';

function emptyPanel(){
  const nodes=new Map([['[data-panel-list]',{innerHTML:'',querySelectorAll:()=>[]}],['[data-update-search]',{value:''}]]),events=new Map();
  const dialog={setAttribute(){},addEventListener:(type,listener)=>events.set(type,listener),showModal(){},close(){},remove(){},
    querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);}};
  return {root:{createElement:()=>dialog,body:{append(){}}},nodes,events};
}

for(const action of ['button','escape'])test(`the panel ${action} closes and calls onExit exactly once`,async()=>{
  const h=emptyPanel();let exits=0;
  const cleanup=await openAppUpdatePanel({actorUid:'admin',target:'FA',root:h.root,services:{listAppUpdateUsers:async()=>[]},readRelease:async()=>200,isCurrent:()=>true,onExit:()=>exits++});
  if(action==='button')h.nodes.get('[data-panel-close]').onclick();else h.events.get('cancel')({preventDefault(){}});
  cleanup();assert.equal(exits,1);
});

test('programmatic panel cleanup does not call onExit',async()=>{
  const h=emptyPanel();let exits=0;
  const cleanup=await openAppUpdatePanel({actorUid:'admin',target:'FA',root:h.root,services:{listAppUpdateUsers:async()=>[]},readRelease:async()=>200,isCurrent:()=>true,onExit:()=>exits++});
  cleanup();assert.equal(exits,0);
});

test('invalidating the panel during its initial reads closes the dialog and every opened subscription',async()=>{
  let current=true,activeSubscriptions=0,removed=false,releaseLastRead;
  const users=Array.from({length:5},(_,i)=>({uid:'user-'+i,displayName:'User '+i,email:'user-'+i+'@example.invalid'}));
  const hosts=users.map(user=>({dataset:{userDevices:user.uid},innerHTML:'',textContent:''}));
  const list={innerHTML:'',querySelectorAll:selector=>selector==='[data-user-devices]'?hosts:[]};
  const nodes=new Map([['[data-panel-list]',list],['[data-update-search]',{value:''}]]);
  const dialog={
    setAttribute(){},addEventListener(){},showModal(){},close(){},
    querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);},
    remove(){removed=true;}
  };
  const root={createElement:()=>dialog,body:{append(){}}};
  const services={
    listAppUpdateUsers:async()=>users,
    readUserAppUpdates:async(_,uid)=>{
      if(uid==='user-4')await new Promise(resolve=>{releaseLastRead=resolve;});
      return {request:null,devices:[]};
    },
    watchAppInstallations:()=>{
      activeSubscriptions++;let stopped=false;
      return ()=>{if(!stopped){stopped=true;activeSubscriptions--;}};
    }
  };
  // The caller cannot store the returned cleanup until the initial reads finish.
  const opening=openAppUpdatePanel({actorUid:'admin',target:'FA',root,services,
    readRelease:async()=>200,isCurrent:()=>current});
  let close;
  try{
    await new Promise(setImmediate);
    assert.equal(activeSubscriptions,4);
    assert.equal(typeof releaseLastRead,'function');
    current=false;
    releaseLastRead();
    close=await opening;
    assert.equal(activeSubscriptions,0,'stale initial load must stop subscriptions without relying on caller cleanup');
    assert.equal(removed,true,'stale initial load must remove its modal dialog');
  }finally{close?.();}
});
