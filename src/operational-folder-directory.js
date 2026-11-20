import {operationalFolders} from './operational-folders.js';

const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Navigation metadata only. Call after the route's normal profile ACL checks. */
export function renderOperationalFolderDirectory(id,{allowed=()=>true,folderState=()=>null,folders=operationalFolders,heading=true}={}) {
 const children=parent=>Object.keys(folders).filter(key=>key.startsWith(parent+'/')&&!key.slice(parent.length+1).includes('/')&&allowed(key));
 const color=key=>' data-folder-state="'+(folderState(key)||'')+'"';
 const branch=parent=>children(parent).map(key=>'<details class="catalog-folder"><summary'+color(key)+'><span>'+escapeHtml(folders[key])+'</span></summary>'+branch(key)+'</details>').join('');
 return '<section class="operational-folder-directory">'+(heading?'<h2'+color(id)+'>'+escapeHtml(folders[id]||'Pasta')+'</h2>':'')+branch(id)+'</section>';
}
