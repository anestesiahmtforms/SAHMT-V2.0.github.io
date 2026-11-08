import {createHash} from 'node:crypto';
import {SAHMT_START_DAY,SAHMT_START_ISO,SAHMT_START_TIME} from '../../worker-indicators/sahmt-performance-period.js';
const uid=value=>typeof value==='string'&&/^[A-Za-z0-9_.@+:%-]{1,128}$/.test(value)&&!['.','..'].includes(value);
const projects=['FG','FI','FB','FC','FE'];
export function prepareSahmtConfiguration(input){
 if(!input||!Array.isArray(input.members)||input.members.length<1||input.members.length>400)throw Error('SAHMT_CONFIG_MEMBER_LIMIT');
 const p=input.fiPolicy;
 if(p?.rule!=='ATRASO_V1'||Date.parse(p.effectiveFrom)!==SAHMT_START_TIME||p.cutoffDay!==SAHMT_START_DAY)throw Error('SAHMT_CONFIG_FI_POLICY');
 if(input.effectiveFrom!==undefined&&Date.parse(input.effectiveFrom)!==SAHMT_START_TIME)throw Error('SAHMT_CONFIG_START_DATE');
 const seen=new Set(),sourceSeen=new Map(projects.map(source=>[source,new Set()]));
 const members=input.members.map(member=>{
  if(!uid(member.uid)||seen.has(member.uid)||typeof member.active!=='boolean'||typeof member.access!=='boolean'||typeof member.displayName!=='string'||member.displayName.length<1||member.displayName.length>120)throw Error('SAHMT_CONFIG_MEMBER_INVALID');seen.add(member.uid);
  const sourceUids={};
  for(const source of projects){
   const value=member.sourceUids?.[source];if(!uid(value))throw Error('SAHMT_CONFIG_MAPPING_REQUIRED');
   if(sourceSeen.get(source).has(value))throw Error('SAHMT_CONFIG_MAPPING_AMBIGUOUS');sourceSeen.get(source).add(value);sourceUids[source]=value;
  }
  return {uid:member.uid,displayName:member.displayName,active:member.active,access:member.access,sourceUids};
 }).sort((a,b)=>a.uid.localeCompare(b.uid));
 const fiPolicy={rule:p.rule,effectiveFrom:SAHMT_START_ISO,cutoffDay:SAHMT_START_DAY};
 const generation=createHash('sha256').update(JSON.stringify({members,fiPolicy,effectiveFrom:SAHMT_START_ISO})).digest('hex');
 return {generation,members:members.map(member=>({...member,directoryGeneration:generation})),runtime:{schemaVersion:1,projectId:'rotinas-8a617',enabled:false,generation,effectiveFrom:SAHMT_START_ISO,fiPolicy}};
}
