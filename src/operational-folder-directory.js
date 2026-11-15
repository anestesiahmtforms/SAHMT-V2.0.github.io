import {operationalFolders} from './operational-folders.js';

const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

/** Navigation metadata only. Call after the route's normal profile ACL checks. */
export function renderOperationalFolderDirectory(id,{allowed=()=>true,folders=operationalFolders}={}) {
 const children=parent=>Object.keys(folders).filter(key=>key.startsWith(parent+'/')&&!key.slice(parent.length+1).includes('/')&&allowed(key));
 const branch=parent=>children(parent).map(key=>'<details class="catalog-folder operational-folder-inactive"><summary><span>'+escapeHtml(folders[key])+'</span><small>INATIVA · NAVEGAÇÃO DISPONÍVEL</small></summary>'+branch(key)+'<p role="status">As atividades nesta pasta aguardam a liberação do administrador. Você pode continuar navegando pelas subpastas.</p></details>').join('');
 return '<section class="operational-folder-directory"><h2>'+escapeHtml(folders[id]||'Pasta')+'</h2><p role="status">A navegação pelas pastas continua disponível. As atividades aguardam a reativação ou a confirmação do servidor.</p>'+branch(id)+'</section>';
}
