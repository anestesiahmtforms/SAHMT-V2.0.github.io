import {createServer} from 'vite';
import {createHtmlTrainingService} from '../worker-training/service.js';
import {memoryStore} from '../tests/helpers/html-training-memory-store.js';
const store=memoryStore(),who=uid=>({uid,email:uid+'@example.invalid',emailVerified:true,provider:'google.com'});
for(const uid of ['admin','reader']){store.seed('users',uid,{uid,active:true,access:true,role:uid==='admin'?'administrador_app':'colaborador'});store.seed('documentAccessEmails',uid+'@example.invalid',{id:uid+'@example.invalid',email:uid+'@example.invalid',active:true,groups:['GENERAL']});}
const service=createHtmlTrainingService({store,readingRequired:true}),bank=Array.from({length:5},(_,n)=>({id:'q'+n,stem:'Pergunta de conferência '+(n+1),points:1,options:[{id:'a',text:'Alternativa A'},{id:'b',text:'Alternativa B'}],correctOptionId:'a'}));
await service.execute('PUBLISH',{trainingId:'reading-preview',expectedVersion:0,training:{title:'Conferência de leitura completa',category:'ROPs',subcategory:'Conferência',status:'PUBLISHED',audienceGroup:'GENERAL',managerUid:'',source:{}},sections:[{id:'first',title:'Leitura de conferência',html:'<h2>Leitura completa</h2><p>Leia este trecho com a página aberta. O avanço depende do tempo e do percurso.</p><details><summary>Referências</summary><p>Esta referência também deve ser percorrida.</p></details>'}],bank,selectedQuestionIds:bank.map(q=>q.id)},who('admin'));
const server=await createServer({configFile:false,root:process.cwd(),define:{__SAHMT_DEPLOYMENT__:JSON.stringify({target:'FB'})},server:{host:'127.0.0.1',port:5188,strictPort:true},optimizeDeps:{noDiscovery:true,entries:[]}});
server.middlewares.use('/reading-api',async(req,res)=>{
 try{if(req.method!=='POST'||req.headers.origin!=='http://127.0.0.1:5188')throw Object.assign(Error('LOCAL_PREVIEW_ONLY'),{status:403});let text='';for await(const chunk of req){text+=chunk;if(text.length>32000)throw Error('TOO_LARGE');}const {action,input}=JSON.parse(text);const result=await service.execute(action,input,who('reader'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));}
 catch(e){res.statusCode=e.status||400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:e.code||e.message}));}
});
await server.listen();console.log('http://127.0.0.1:5188/tests/fixtures/reading-control.html');
