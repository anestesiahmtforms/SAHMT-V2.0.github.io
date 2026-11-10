import {readFile} from 'node:fs/promises';
import {openPrivateJson} from './lib/windows-protected-json.js';
import {createFiServiceToken} from '../worker-fi-control/identity.js';
import {createFiStore,FI_PROJECTS} from '../worker-fi-control/store.js';
import {catalogCollections,catalogIndexId,refreshFiCatalogue} from '../worker-fi-control/catalog-index.js';

const credentials=await openPrivateJson(JSON.parse(await readFile('.local-preview/fi-control/service-key.dpapi.json','utf8')));
const getAccessToken=createFiServiceToken({credentials});
const source=createFiStore({projectId:FI_PROJECTS.FB,getAccessToken,allowedCollections:catalogCollections,readOnly:true});
const target=createFiStore({projectId:FI_PROJECTS.FI,getAccessToken,allowedCollections:['fiSearchRecords']});
const counts=await refreshFiCatalogue({source,target});
const actual=await target.get('fiSearchRecords',catalogIndexId);
if(!catalogCollections.every(collection=>actual?.sections?.[collection]?.length===counts[collection]))throw Error('FI_CATALOGUE_READBACK_FAILED');
console.log(JSON.stringify({counts,verified:true}));
