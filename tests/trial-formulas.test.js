const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
const formulas=JSON.parse(fs.readFileSync(require('node:path').join(__dirname,'../docs/airtable-plan-trial-formulas.json'),'utf8'));
// Evaluate the exact proposed, narrowly supported Airtable formula grammar.
// Field values stay data; neither JavaScript eval nor expression substitution is used.
function evaluate(source,fields){
 const pattern=/\s*(\{[^}]+\}|"(?:[^"\\]|\\.)*"|>=|=|\d+|[A-Z]+|[(),])/gy;let tokens=[],m,offset=0;
 while(offset<source.length){pattern.lastIndex=offset;m=pattern.exec(source);assert.ok(m,'Unrecognized formula token');tokens.push(m[1]);offset=pattern.lastIndex;}
 let at=0;
 function expression(){let value=primary();if(tokens[at]==='='||tokens[at]==='>='){const op=tokens[at++],right=primary();value=op==='='?value===right:value>=right;}return value;}
 function primary(){
  const token=tokens[at++];assert.ok(token,'Missing value');
  if(token[0]==='{')return fields[token.slice(1,-1)]??'';
  if(token[0]==='"')return JSON.parse(token);
  if(/^\d+$/.test(token))return Number(token);
  assert.equal(tokens[at++],'(');const args=[];if(tokens[at]!==')'){do{args.push(expression());if(tokens[at]!==',')break;at++;}while(true);}assert.equal(tokens[at++],')');
  switch(token){case 'IF':assert.equal(args.length,3);return args[0]?args[1]:args[2];case 'AND':return args.every(Boolean);case 'OR':return args.some(Boolean);case 'NOT':assert.equal(args.length,1);return !args[0];case 'SWITCH':for(let i=1;i<args.length-1;i+=2)if(args[0]===args[i])return args[i+1];return args.at(-1);default:assert.fail('Unsupported function '+token);}
 }
 const result=expression();assert.equal(at,tokens.length);return result;
}
function quota(fields){fields={...fields,'Calculated Tier':evaluate(formulas['Calculated Tier'],fields)};return {tier:fields['Calculated Tier'],quota:evaluate(formulas['Monthly Quota'],fields)};}
test('exact Airtable formulas preserve legacy 60 and assign Stripe trials their selected 5/20/60 limit',()=>{
 for(const [tier,limit] of [['Pro ($299/mo)',5],['Growth ($699/mo)',20],['Enterprise ($1,299/mo)',60]]){
  assert.deepEqual(quota({Status:'Trialing','Stripe Subscription ID':'sub_trial','Subscription Tier':tier,'Amount Paid':0}),{tier,quota:limit});
  assert.deepEqual(quota({Status:'Trialing','Stripe Subscription ID':'','Subscription Tier':tier,'Amount Paid':0}),{tier:'Enterprise ($1,299/mo)',quota:60});
 }
});
test('paid and complimentary plan calculations remain unchanged, including legacy amount fallback',()=>{
 for(const subscription of ['', 'sub_paid'])for(const [tier,limit] of [['Pro ($299/mo)',5],['Growth ($699/mo)',20],['Enterprise ($1,299/mo)',60]])assert.deepEqual(quota({Status:'Active','Stripe Subscription ID':subscription,'Subscription Tier':tier,'Amount Paid':0}),{tier,quota:limit});
 for(const [amount,tier,limit] of [[29900,'Pro ($299/mo)',5],[69900,'Growth ($699/mo)',20],[129900,'Enterprise ($1,299/mo)',60]])assert.deepEqual(quota({Status:'Active','Amount Paid':amount}),{tier,quota:limit});
});
test('formula changes cannot extend trials or grant access to canceled/expired accounts',()=>{
 for(const formula of Object.values(formulas))assert.ok(!/NOW\(|DATEADD\(|Billing Period|Quota Status/.test(formula));
 assert.equal(quota({Status:'Canceled','Stripe Subscription ID':'sub_canceled','Subscription Tier':'Pro ($299/mo)'}).quota,5); // display limit only; unchanged Quota Status blocks eligibility.
});
