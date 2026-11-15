import test from 'node:test';
import assert from 'node:assert/strict';
let api={};
try {api=await import('../communication/history.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const message={id:'notice-1',publishAt:1794740400000,createdBy:{email:'admin@example.test'},title:'=HYPERLINK("https://example.test")',message:'Texto completo\nSegunda linha',audienceType:'GROUP',audienceValue:'institutional-team'};
test('archive preserves formula-like content as literal RAW strings with full body',()=>{
 assert.equal(typeof api.historyMessageRow,'function');
 const row=api.historyMessageRow(message,{recipientStart:2,recipientCount:3});
 const parsed=api.parseHistoryMessage(row);
 assert.equal(parsed.title,message.title);assert.equal(parsed.message,message.message);
 assert.equal(parsed.recipientStart,2);assert.equal(parsed.recipientCount,3);
 assert.ok(row.every(v=>['string','number','boolean'].includes(typeof v)));
});
test('legacy history explicitly reports unknown original recipients',()=>{
 assert.equal(typeof api.historyMessageRow,'function');
 const parsed=api.parseHistoryMessage(api.historyMessageRow(message));
 assert.equal(parsed.recipientsRecorded,false);assert.equal(parsed.recipientCount,null);
});
test('recipient archive keeps stable identity, original group and first-read timestamp',()=>{
 assert.equal(typeof api.historyRecipientRow,'function');
 const recipient={uid:'one',displayName:'Pessoa',email:'one@example.test',institutionalGroup:'team',readAt:1794740400001,completedAt:null,status:'PENDING'};
 const parsed=api.parseHistoryRecipient(api.historyRecipientRow(message,recipient));
 assert.equal(parsed.uid,'one');assert.equal(parsed.institutionalGroup,'team');assert.equal(parsed.readAt,recipient.readAt);assert.equal(parsed.completedAt,null);
});
