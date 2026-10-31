import {mountYearEndSchedule} from './year-end-schedule-ui.js';

export function mountYearEndScheduleDialog(root,{onExit=()=>{},...options}={}){
 let disposed=false;
 root.innerHTML='<dialog class="year-end-dialog" aria-labelledby="year-end-dialog-title"><header class="year-end-dialog__header"><h2 id="year-end-dialog-title" tabindex="-1">ESCALA FINAL DE ANO</h2><button type="button" class="year-end-dialog__close" aria-label="Voltar ao início">×</button></header><div class="year-end-dialog__body" data-year-end-dialog-body></div></dialog>';
 const dialog=root.querySelector('dialog'),close=dialog.querySelector('button');
 const cleanup=mountYearEndSchedule(dialog.querySelector('[data-year-end-dialog-body]'),options);
 const exit=()=>{if(!disposed)onExit();},cancel=event=>{event.preventDefault();exit();};
 close.addEventListener('click',exit);dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',exit);
 dialog.showModal();dialog.querySelector('h2').focus({preventScroll:true});
 return ()=>{disposed=true;cleanup();close.removeEventListener('click',exit);dialog.removeEventListener('cancel',cancel);dialog.removeEventListener('close',exit);if(dialog.open)dialog.close();root.replaceChildren();};
}
