import {assertFolderReadable} from '../server/folder-read-policy.js';
import {fail} from './identity.js';

/** Read only local control metadata. An absent document permits staged rollout;
 * an existing malformed document or failed read never permits content access. */
export async function assertProjectionFoldersReadable(reader){
  let document;
  try{document=await reader.get('runtimePolicy','folders');}
  catch{throw fail('DOMAIN_FOLDER_POLICY_UNAVAILABLE',503);}
  if(document===null)return;
  try{
    // This operation consumes events and produces schedule data. People and
    // other FI/FJ consumers remain independent of the projection's controls.
    assertFolderReadable(document?.data,'operacao/eventos');
    assertFolderReadable(document?.data,'operacao/escala');
  }catch(error){
    throw fail(error.code==='FOLDER_DISABLED'?'DOMAIN_FOLDER_DISABLED':'DOMAIN_FOLDER_POLICY_INVALID',error.code==='FOLDER_DISABLED'?403:503);
  }
}
export const projectionPolicyError=error=>/^DOMAIN_FOLDER_/.test(error?.code||'');
