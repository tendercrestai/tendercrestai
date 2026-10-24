const {test,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {unzipSync,strFromU8}=require('fflate');
const sax=require('sax');
const formatter=require('../netlify/functions/lib/proposal-email');
const relay=require('../netlify/functions/airtable-mail-relay');
const message='# Executive summary\n\nFictional Acorn offers **document review** only.\nNo certification is asserted.\n\n## Delivery approach\n- Review evidence\n- Record **missing** facts\n\n1. Draft\n2. Review\n\n| Requirement | Response |\n| --- | --- |\n| Certificate | Not supplied |\n\nPricing and assumptions:\nPrice remains [NEEDS INPUT].\n\n<script>alert("unsafe")</script>\nhttps://example.invalid/?q=<private>';
let savedEnv,savedFetch,sends;
beforeEach(()=>{savedEnv={...process.env};savedFetch=global.fetch;sends=[];process.env.AIRTABLE_MAIL_RELAY_TOKEN='test-relay-token';process.env.RESEND_API_KEY='test-send-key';global.fetch=async(url,options)=>{sends.push({url,options});return new Response(JSON.stringify({id:'test-delivery'}),{status:200});};});
afterEach(()=>{process.env=savedEnv;global.fetch=savedFetch;});
const event=(data={to:'recipient@example.invalid',subject:'Fictional review proposal',message})=>({httpMethod:'POST',headers:{authorization:'Bearer test-relay-token'},body:JSON.stringify(data)});
function documentXML(output){const files=unzipSync(Buffer.from(output.attachment.content,'base64'));for(const [name,bytes] of Object.entries(files)){if(name.endsWith('.xml')){const parser=sax.parser(true);parser.write(strFromU8(bytes)).close();}}return strFromU8(files['word/document.xml']);}
test('one parsed proposal supplies real headings, lists and table to email and Word, without changing claims',async()=>{
 const output=await formatter.presentation('Fictional proposal',message),xml=documentXML(output);
 assert.match(output.html,/<h2[^>]*>Executive summary<\/h2>/);
 assert.match(output.html,/<strong>document review<\/strong>/);assert.match(output.html,/<table role="table"/);
 assert.match(output.html,/1\. Draft/);assert.match(output.html,/2\. Review/);
 assert.match(xml,/w:pStyle w:val="Heading1"/);assert.match(xml,/<w:tbl>/);assert.match(xml,/<w:br\/>/);assert.match(xml,/w:pgNumType|PAGE/);
 for(const text of ['No certification is asserted.','Not supplied','Price remains [NEEDS INPUT].','Draft','Review']){assert.ok(output.html.includes(text));assert.ok(xml.includes(text));}
 assert.match(output.html,/Draft for human review/);assert.match(xml,/DRAFT FOR HUMAN REVIEW/);
});
test('untrusted HTML and URL content remain inert text, never external Word relationships',async()=>{
 const output=await formatter.presentation('<img src=x onerror=alert(1)>',message),xml=documentXML(output);
 assert.ok(!output.html.includes('<script>'));assert.ok(!output.html.includes('<img'));
 assert.match(output.html,/&lt;script&gt;/);assert.match(xml,/&lt;script&gt;/);
 const files=unzipSync(Buffer.from(output.attachment.content,'base64'));
 for(const [name,bytes] of Object.entries(files))if(name.endsWith('.rels'))assert.ok(!strFromU8(bytes).includes('TargetMode="External"'));
 assert.ok(!/[<>/\\]/.test(output.attachment.filename));assert.ok(output.attachment.filename.endsWith('.docx'));
});
test('ordinary line breaks, Unicode, non-table pipe text and explicit numbering survive',async()=>{
 const blocks=formatter.parse('Delivery note\r\nCafé — 東京\r\n\r\n7. Keep this number\n9. Keep this too\n\nA | B\nNot a table');
 assert.equal(blocks[0].text,'Delivery note\nCafé — 東京');assert.deepEqual(blocks.filter(b=>b.type==='item').map(b=>b.marker),['7.','9.']);assert.equal(blocks.at(-1).type,'paragraph');
 assert.match(documentXML(await formatter.presentation('Unicode', 'Café — 東京')),/Café — 東京/);
});
test('legacy payload delivers formatted HTML plus exactly one matching editable attachment and unchanged plain text',async()=>{
 const response=await relay.handler(event());assert.equal(response.statusCode,200);assert.equal(sends.length,1);
 const payload=JSON.parse(sends[0].options.body);assert.deepEqual(payload.to,['recipient@example.invalid']);assert.equal(payload.subject,'Fictional review proposal');assert.equal(payload.text,message);assert.equal(payload.attachments.length,1);assert.equal(payload.attachments[0].content_type,'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
 documentXML({attachment:payload.attachments[0]});assert.equal(sends[0].url,'https://api.resend.com/emails');
});
test('unauthorized, unconfigured and wrong-method requests never contact a provider',async()=>{
 assert.equal((await relay.handler({...event(),httpMethod:'GET'})).statusCode,405);
 assert.equal((await relay.handler({...event(),headers:{authorization:'Bearer wrong'}})).statusCode,401);
 delete process.env.AIRTABLE_MAIL_RELAY_TOKEN;assert.equal((await relay.handler(event())).statusCode,503);assert.equal(sends.length,0);
});
test('invalid payloads and unsafe control characters fail before delivery',async()=>{
 for(const value of [null,[],{}, {to:'recipient@example.invalid',subject:'a\r\nBcc: other@example.invalid',message}, {to:'recipient@example.invalid',subject:'Draft',message:'bad\u0000text'}, {to:'recipient@example.invalid',subject:'Draft',message:'   '}, {to:['recipient@example.invalid'],subject:'Draft',message}])assert.equal((await relay.handler(event(value))).statusCode,400);
 assert.equal((await relay.handler({...event(),body:'invalid json'})).statusCode,400);assert.equal(sends.length,0);
});
test('excessive structures fail closed instead of silently dropping text or sending without Word',async()=>{
 for(const content of ['a\n'.repeat(10001),Array(2002).fill('x').join('\n\n'),'| a | b |\n| --- | --- |\n'+Array(501).fill('| a | b |').join('\n')]){
  assert.equal((await relay.handler(event({to:'recipient@example.invalid',subject:'Draft',message:content}))).statusCode,413);
 }
 assert.equal(sends.length,0);
});
test('maximum existing 150000-character text generates a complete readable Word file',async()=>{
 const text='x'.repeat(149996)+' END';const result=await relay.handler(event({to:'recipient@example.invalid',subject:'Maximum draft',message:text}));assert.equal(result.statusCode,200);
 const payload=JSON.parse(sends[0].options.body);assert.equal(payload.text,text);assert.ok(documentXML({attachment:payload.attachments[0]}).includes(text));
});
test('provider rejection and ambiguous network failure never report success or log content',async()=>{
 const logs=[],old=console.error;console.error=(...x)=>logs.push(x.join(' '));
 try{global.fetch=async()=>new Response('private customer text',{status:422});assert.equal((await relay.handler(event())).statusCode,502);global.fetch=async()=>{throw Error('private secret text');};assert.equal((await relay.handler(event())).statusCode,502);assert.ok(!logs.join(' ').includes('private'));}finally{console.error=old;}
});
