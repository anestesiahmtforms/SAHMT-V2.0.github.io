import {mountHtmlTrainings} from '../src/html-training.js';
mountHtmlTrainings(document.querySelector('#root'),{user:{uid:'reader'},profile:{},api:async(action,input)=>{
 const response=await fetch('/reading-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,input})}),data=await response.json();
 if(!response.ok)throw Object.assign(new Error(data.code),{code:data.code,status:response.status});return data;
}});
