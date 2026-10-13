import test from 'node:test';
import assert from 'node:assert/strict';
import {ManagementBrokerAdmissionState,createManagementAuthWorkerRuntime,createManagementGatewayResponseNonceClaimer} from '../../worker-management-auth/admission-state.js';

export function stateHarness(){
  const rows=new Map(),nonces=new Map();let schema=false;
  const sql={exec(statement,...values){
    if(statement.startsWith('CREATE TABLE')){schema=true;return {toArray:()=>[]};}
    assert.equal(schema,true);
    if(statement.startsWith('DELETE FROM active_requests WHERE expires_at_ms')){
      for(const [id,row] of rows)if(row.expiresAtMs<=values[0])rows.delete(id);return {toArray:()=>[]};
    }
    if(statement.startsWith('SELECT COUNT(*) AS count FROM gateway_response_nonces'))return {one:()=>({count:nonces.size})};
    if(statement.startsWith('SELECT COUNT(*)'))return {one:()=>({count:rows.size})};
    if(statement.startsWith('INSERT INTO active_requests')){
      if(rows.has(values[0]))throw new Error('duplicate slot');rows.set(values[0],{expiresAtMs:values[1]});return {toArray:()=>[]};
    }
    if(statement.startsWith('DELETE FROM active_requests WHERE slot_id')){rows.delete(values[0]);return {toArray:()=>[]};}
    if(statement.startsWith('DELETE FROM gateway_response_nonces WHERE retain_until_ms')){
      for(const [hash,expiresAt] of nonces)if(expiresAt<=values[0])nonces.delete(hash);return {toArray:()=>[]};
    }
    if(statement.startsWith('SELECT nonce_hash FROM gateway_response_nonces'))
      return {toArray:()=>nonces.has(values[0])?[{nonce_hash:values[0]}]:[]};
    if(statement.startsWith('INSERT INTO gateway_response_nonces')){
      const had=nonces.has(values[0]);if(!had)nonces.set(values[0],values[1]);return {rowsWritten:had?0:1,toArray:()=>[]};
    }
    throw new Error('unrecognized query');
  }};
  const state=new ManagementBrokerAdmissionState({storage:{sql}});
  const binding={idFromName:name=>({name}),get:id=>({fetch:request=>state.fetch(request)})};
  return {state,rows,nonces,binding};
}
const request=(path,body)=>new Request('https://broker-state.internal'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
