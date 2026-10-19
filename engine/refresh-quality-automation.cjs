// Refresh prompts without replacing current routing, quota conditions or output nodes.
const { upgrade } = require('./upgrade-automation.cjs');
function refresh(snapshot) {
  const graph=structuredClone(snapshot);
  const branch=graph.nodes.find(n=>n.type==='conditionalGroup')?.branches.find(b=>b.nodes.some(n=>n.key==='wacdXcDkteb3p5YKr'));
  if(!branch) throw new Error('Generation branch missing. Inspect the current automation.');
  const stages=branch.nodes.filter(n=>n.type==='aiGenerate');
  if(stages.length===2) return upgrade(graph);
  if(stages.length!==3 || stages[0].key!=='wacdXcDkteb3p5YKr' || stages[1].key!=='wacWrHdT7uTv8Tn6K')
    throw new Error('Unexpected generation stages. Inspect before editing.');
  const templates=upgrade(require('./current-automation.json')).nodes.find(n=>n.type==='conditionalGroup').branches
    .find(b=>b.nodes.some(n=>n.key==='wacdXcDkteb3p5YKr')).nodes.filter(n=>n.type==='aiGenerate');
  for(let i=0;i<stages.length;i++) stages[i].inputs.prompt=structuredClone(templates[i].inputs.prompt);
  graph.description='Proposal quality v2: reviewed requirement handoff, bounded company evidence, synthetic response-style examples and independent source-aware revision. Human verification remains required.';
  return {name:graph.name,description:graph.description,trigger:graph.trigger,nodes:graph.nodes};
}
module.exports={refresh};
if(require.main===module){const fs=require('node:fs');const [input,output]=process.argv.slice(2);
  if(!input || !output)throw new Error('Usage: node engine/refresh-quality-automation.cjs before.json candidate.json');
  fs.writeFileSync(output,JSON.stringify(refresh(JSON.parse(fs.readFileSync(input,'utf8'))),null,2)+'\n');}
