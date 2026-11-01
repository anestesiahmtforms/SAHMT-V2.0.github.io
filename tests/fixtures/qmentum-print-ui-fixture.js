import '../../src/qmentum-ui.css';
import {mountQmentumPrintInput} from '../../src/qmentum-print-ui.js';

const previewId='a'.repeat(64);
const defaultPreview={status:'PREVIEW',preview:{id:previewId,period:'2026-08',counts:{anestheticProcedures:83,surgical:71,general:60,sedation:40,regional:29,toxicity:0},missingFields:['headache','effectiveToxicity','effectiveGlucose'],changes:[{field:'general',current:58,source:60}],conflicts:[],baseVersion:3,sourceLabel:'Fontes sintéticas'}};

export function mountPrintInputFixture(root,options={}) {
 const state={calls:[],saved:[],current:true,hold:{...options.hold},failures:{...options.failures},pending:{},responses:{scan:{candidates:[{period:'2026-07',status:'NEW'},{period:'2026-08',status:'CHANGED'},{period:'2026-09',status:'UNCHANGED'},{period:'2026-10',status:'MISSING_PAIR'},{period:'2026-11',status:'DUPLICATE'}]},preview:structuredClone(defaultPreview),apply:{status:'CONFIRMED',version:4},...options.responses},urls:{created:[],revoked:[]}};
 const createURL=URL.createObjectURL.bind(URL),revokeURL=URL.revokeObjectURL.bind(URL);
 URL.createObjectURL=file=>{const url=createURL(file);state.urls.created.push(url);return url;};
 URL.revokeObjectURL=url=>{state.urls.revoked.push(url);revokeURL(url);};
 const call=async(operation,payload)=>{
  state.calls.push({operation,payload:structuredClone(payload)});
  if(state.hold[operation])await new Promise((resolve,reject)=>{state.pending[operation]={resolve,reject};});
  if(state.failures[operation]){state.failures[operation]--;throw Error('SYNTHETIC_FAILURE');}
  return structuredClone(state.responses[operation]);
 };
 state.release=operation=>{state.hold[operation]=false;state.pending[operation]?.resolve();delete state.pending[operation];};
 root.innerHTML='<dialog class="qm-dialog"><header class="qm-dialog__header"><h3>Entrada por prints</h3></header><div class="qm-dialog__body"></div><footer class="qm-dialog__footer"><button type="button" data-fixture-close>Voltar</button></footer></dialog>';
 const modal=root.querySelector('dialog');modal.showModal();
 const dispose=mountQmentumPrintInput(root.querySelector('.qm-dialog__body'),{unitId:'synthetic-unit',period:options.period||'2026-08',mode:options.mode||'UPLOAD',client:{scan:payload=>call('scan',payload),preview:payload=>call('preview',payload),apply:payload=>call('apply',payload)},isCurrent:()=>state.current,onSaved:receipt=>state.saved.push(receipt)});
 state.dispose=()=>{dispose();URL.createObjectURL=createURL;URL.revokeObjectURL=revokeURL;};
 root.querySelector('[data-fixture-close]').onclick=()=>{state.dispose();modal.close();};
 return state;
}
