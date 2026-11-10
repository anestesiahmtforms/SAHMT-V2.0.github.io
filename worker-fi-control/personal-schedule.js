import {isValidDateKey,localDateKey,shiftDateKey} from '../src/schedule-date.js';
import {buildScheduleView} from '../src/schedule-view.js';
import {normalize} from './fi-ai-policy.js';

const dateTerm=/\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|HOJE|AMANHA|ONTEM)\b/g;
const relativeDays={HOJE:0,AMANHA:1,ONTEM:-1};
const scheduleToken=/^(?:[A-Z]{2}|L2)(?:[/-](?:[A-Z]{2}|L2))*$/;
export const validScheduleSigla=value=>/^(?:[A-Z]{2}|L2)$/.test(value);

export function parseScheduleQuestion(query,now=Date.now()){
 if(typeof query!=='string'||query.length>1000)return null;
 const text=normalize(query);
 if(!/\bESCALA\b/.test(text))return null;
 const dates=text.match(dateTerm)||[];
 const subject=text.replace(dateTerm,' ').replace(/\b(?:DE|DO|NO|EM|DIA)\b|[?!.]/g,' ').trim();
 const ownQuestion=/\b(?:MEU|MEUS|MINHA|MINHAS|ESTOU|TRABALHO)\b/.test(text);
 if(!ownQuestion&&subject!=='ESCALA')return null;
 if(!dates.length)return ownQuestion?{status:'date_required'}:null;
 if(dates.length!==1)return {status:'invalid_date'};
 const date=dates[0],brazilian=date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 const day=Object.hasOwn(relativeDays,date)?shiftDateKey(localDateKey(new Date(now)),relativeDays[date]):
  brazilian?[brazilian[3],brazilian[2].padStart(2,'0'),brazilian[1].padStart(2,'0')].join('-'):date;
 return isValidDateKey(day)?{status:'lookup',day}:{status:'invalid_date'};
}

export function ownSchedulePositions(schedule,day,sigla){
 if(!schedule||schedule.deleted===true||schedule.id&&schedule.id!==day||schedule.date&&schedule.date!==day)return null;
 const view=buildScheduleView(schedule,day);
 if(!view.positions.length||view.positions.length>30)return null;
 const positions=view.positions.filter(position=>scheduleToken.test(position.sigla.split('(')[0].trim()));
 if(!positions.length)return null;
 return positions
  .filter(position=>position.siglas.includes(sigla))
  .map(position=>Number.isSafeInteger(position.position)&&position.position>0?position.position:position.index+1);
}
