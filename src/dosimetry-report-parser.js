import {dosimetryValue} from './dosimetry-domain.js';

const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const clean=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
const failure=message=>new Error(`Não foi possível conferir o relatório: ${message}`);
const center=item=>item.x+item.w/2;

/** Items use PDF points, a bottom-left origin, and vertical text centres. */
export function parseDosimetryReport(pages){
 const rows=[],warnings=[];let year=null,issuedOn=null;
 for(const [pageIndex,source] of pages.entries()){
  const items=source.filter(i=>i.str?.trim()&&Number.isFinite(i.x)&&Number.isFinite(i.y)).map(i=>({...i,str:i.str.trim()}));
  const lines=[];
  for(const item of [...items].sort((a,b)=>b.y-a.y||a.x-b.x)){
   let line=lines.find(l=>Math.abs(l.y-item.y)<3);if(!line){line={y:item.y,items:[]};lines.push(line);}line.items.push(item);
  }
  for(const line of lines){
   const text=clean(line.items.sort((a,b)=>a.x-b.x).map(i=>i.str).join(' '));
   const match=text.match(/DOSES\s+NO\s+ANO\s+DE\s+(20\d{2})/);if(match){const next=Number(match[1]);if(year&&year!==next)throw failure('anos conflitantes.');year=next;}
   if(/IMPRESSO\s+EM|EMISSAO/.test(text)){
    const date=text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/);if(date){const next=`${date[3]}-${date[2]}-${date[1]}`;if(Number.isFinite(Date.parse(next))&&new Date(next).toISOString().slice(0,10)===next){if(issuedOn&&issuedOn!==next)throw failure('datas de emissão conflitantes.');issuedOn=next;}}
   }
  }
  const jan=items.find(i=>clean(i.str)==='JAN');
  if(!jan){if(items.some(i=>clean(i.str)==='NOME'))throw failure('cabeçalho de meses incompleto.');continue;}
  const headers=months.map(month=>items.filter(i=>clean(i.str)===month&&Math.abs(i.y-jan.y)<5));
  if(headers.some(list=>list.length!==1))throw failure('cabeçalho de meses incompleto ou ambíguo.');
  const xs=headers.map(list=>center(list[0]));
  if(xs.some((x,i)=>i&&x<=xs[i-1]))throw failure('ordem dos meses inválida.');
  const step=(xs[11]-xs[0])/11;
  if(step<10||xs.some((x,i)=>Math.abs(x-xs[0]-step*i)>step*.25))throw failure('colunas dos meses desalinhadas.');
  const nameHeader=items.find(i=>clean(i.str)==='NOME'&&Math.abs(i.y-jan.y)<5);
  const codeHeader=items.find(i=>/^COD\.?$/.test(clean(i.str))&&Math.abs(i.y-jan.y)<5);
  const monitorHeader=items.find(i=>clean(i.str)==='MONITOR'&&Math.abs(i.y-jan.y)<18);
  const countHeader=items.find(i=>/^NRO\.?$/.test(clean(i.str))&&Math.abs(i.y-jan.y)<12&&i.x>xs[11]);
  if(!nameHeader||!codeHeader||!monitorHeader)throw failure('formato de tabela não reconhecido.');
  const anchors=items.filter(i=>/^\d{3,6}$/.test(i.str)&&Math.abs(i.x-codeHeader.x)<step*.4&&i.y<jan.y-8).sort((a,b)=>b.y-a.y);
  if(!anchors.length)throw failure('nenhuma linha de profissional encontrada.');
  if(items.some(i=>i.confidence!==undefined)&&!countHeader)throw failure('coluna de conferência de meses não reconhecida no OCR.');
  const monitorRows=items.filter(i=>i.str==='28'&&Math.abs(i.x-monitorHeader.x)<step*.3&&i.y<jan.y-8);
  if(monitorRows.length!==anchors.length)throw failure('quantidade de códigos e monitores divergente.');
  for(let r=0;r<anchors.length;r++){
   const anchor=anchors[r];const gap=Math.min(r?anchors[r-1].y-anchor.y:Infinity,r+1<anchors.length?anchor.y-anchors[r+1].y:Infinity);
   if(anchor.confidence!==undefined&&anchor.confidence<70)throw failure(`código ilegível na página ${pageIndex+1}, linha ${r+1}.`);
   const tolerance=Math.min(9,Number.isFinite(gap)?gap*.44:9);
   const rowItems=items.filter(i=>Math.abs(i.y-anchor.y)<=tolerance);
   const nameItems=rowItems.filter(i=>i.x>=nameHeader.x-3&&i.x<monitorHeader.x-4).sort((a,b)=>Math.abs(a.y-b.y)>3?b.y-a.y:a.x-b.x);
   const name=nameItems.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim();
   if(!name||!/[A-Za-zÀ-ÿ]/.test(name)||nameItems.some(i=>i.confidence!==undefined&&i.confidence<60))throw failure(`nome ilegível na página ${pageIndex+1}, linha ${r+1}.`);
   const monitor=rowItems.filter(i=>i.x>=monitorHeader.x-4&&center(i)<xs[0]-step*.55);
   if(monitor.length!==1||monitor[0].str!=='28')throw failure(`tipo de monitor não reconhecido na página ${pageIndex+1}, linha ${r+1}.`);
   const values=xs.map((x,m)=>{
    const cell=rowItems.filter(i=>Math.abs(center(i)-x)<step*.48);
    if(!cell.length)return null;
    if(cell.length!==1)throw failure(`mais de um valor no mês ${m+1}, página ${pageIndex+1}, linha ${r+1}.`);
    const item=cell[0],value=clean(item.str);
    if(item.confidence!==undefined&&item.confidence<70)throw failure(`leitura incerta no mês ${m+1}, página ${pageIndex+1}, linha ${r+1}.`);
    try{dosimetryValue(value);}catch{throw failure(`valor não reconhecido no mês ${m+1}, página ${pageIndex+1}, linha ${r+1}.`);}return value;
   });
   if(values.every(value=>value===null))throw failure(`linha sem leituras na página ${pageIndex+1}.`);
   if(countHeader){
    const counts=rowItems.filter(i=>Math.abs(i.x-countHeader.x)<step*.3);
    if(counts.length!==1||!/^\d{1,2}$/.test(counts[0].str)||Number(counts[0].str)!==values.filter(v=>v!==null).length)throw failure(`quantidade de meses diverge das leituras na página ${pageIndex+1}, linha ${r+1}.`);
   }
   if(rows.some(row=>row.code===anchor.str))throw failure('código de profissional repetido.');
   rows.push({code:anchor.str,name,monitorType:'28',values});
  }
 }
 if(!rows.length)throw failure('tabela SAPRA de dosimetria não encontrada.');
 return {year,issuedOn,rows,warnings};
}
