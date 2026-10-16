import {canClose} from './qmentum-engine.js';
export function transitionMonth(current,action,role,reason,results) {
 if(!['collector','reviewer','manager'].includes(role))throw Error('QMENTUM_PERMISSION_DENIED');
 if(!['SAVE','REVIEW','CLOSE','REOPEN','IMPORT','REBASE'].includes(action))throw Error('QMENTUM_ACTION_INVALID');
 if(current?.status==='CLOSED'&&action!=='REOPEN')throw Error('QMENTUM_MONTH_CLOSED');
 if(action==='REOPEN'){
  if(role!=='manager'||current?.status!=='CLOSED'||String(reason||'').trim().length<8)throw Error('QMENTUM_REOPEN_DENIED');
  return 'DRAFT';
 }
 if(action==='REVIEW'){
  if(!['reviewer','manager'].includes(role)||current?.status!=='DRAFT'||Object.values(results).some(r=>r.status==='INCONSISTENT'))throw Error('QMENTUM_REVIEW_DENIED');
  return 'REVIEWED';
 }
 if(action==='CLOSE'){
  if(!['reviewer','manager'].includes(role)||current?.status!=='REVIEWED'||!canClose(results))throw Error('QMENTUM_CLOSE_PENDING');
  return 'CLOSED';
 }
 if(action==='IMPORT'&&(role!=='manager'||current))throw Error('QMENTUM_IMPORT_CONFLICT');
 if(action==='REBASE'&&(role!=='manager'||current?.status!=='DRAFT'||String(reason||'').trim().length<8))throw Error('QMENTUM_REBASE_DENIED');
 return 'DRAFT';
}
