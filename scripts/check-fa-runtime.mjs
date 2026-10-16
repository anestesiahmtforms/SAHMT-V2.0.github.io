import {readFile,readdir} from 'node:fs/promises';
import {posix,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const retired=new Set(['firebase-project-auth-browser','management-project-auth-auto-connect','management-firebase-app','indicators-firebase-app','management-session-browser','management-lease-access','management-pilot-auth-diagnostics']);
const visited=new Set(),pending=['src/main.js'];
while(pending.length){
 const path=pending.pop();if(visited.has(path))continue;
 if(!path.startsWith('src/')||path.includes('..'))throw Error('FA_RUNTIME_PATH_INVALID');
 visited.add(path);if(!path.endsWith('.js'))continue;
 const text=await readFile(resolve(root,path),'utf8');
 const imports=[...text.matchAll(/\bfrom\s*['"](\.[^'"]+)['"]|\bimport\s*(?:\(\s*)?['"](\.[^'"]+)['"]/g)];
 for(const match of imports)pending.push(posix.normalize(posix.join(posix.dirname(path),match[1]||match[2])));
}
const legacy=[...visited].filter(path=>retired.has(posix.basename(path,'.js')));
if(legacy.length)throw Error('FA_RETIRED_RUNTIME_REACHABLE:'+legacy.join(','));
const html=await readFile(resolve(root,'index.html'),'utf8');
for(const name of ['firebase-project-auth-optin','management-firebase-enabled','indicators-firebase-enabled'])
 if(!html.includes('<meta name="'+name+'" content="false"'))throw Error('FA_SECONDARY_FLAG_NOT_FIXED_OFF');
if(/name="firebase-project-auth-(endpoint|allowed-origin)"/.test(html))throw Error('FA_RETIRED_ENDPOINT_EXPOSED');
const manifest=JSON.parse(await readFile(resolve(root,'dist/assets-manifest.json'),'utf8'));
if(Object.keys(manifest).some(path=>retired.has(posix.basename(path,'.js'))))throw Error('FA_RETIRED_BUILD_CHUNK_PRESENT');
const files=await readdir(resolve(root,'dist/assets'));
if(files.some(name=>[...retired].some(base=>name.startsWith(base+'-'))))throw Error('FA_RETIRED_BUILD_FILE_PRESENT');
console.log(JSON.stringify({code:'FA_RUNTIME_CLEANUP_VERIFIED',reachableSourceFiles:visited.size,retiredRuntimeModules:0,retiredBuildChunks:0,secondaryFlagsFixedOff:true}));
