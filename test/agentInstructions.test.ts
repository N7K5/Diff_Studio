import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {agentInstructions} from '../src/agentInstructions';
import {AgentBridge} from '../src/bridge';
import {Studio} from '../src/studio';
import {processOutput} from '../src/transport';

test('copied handoff starts a fresh CLI process safely with quoted paths and no embedded credential',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-handoff-'));
 const bridge=new AgentBridge(new Studio());
 try{
  const special=path.join(root,"space ' $(touch INJECTED) `touch INJECTED` $dir");await fs.mkdir(special);
  const cli=path.join(special,'agent.mjs');await fs.copyFile('scripts/agent.mjs',cli);
  const descriptor=await bridge.start(special);const skillPath=path.resolve('skills/diff-studio/SKILL.md');
  const skill=await fs.readFile(skillPath,'utf8');const handoff=agentInstructions({descriptor,cli,skillPath,skill,host:'test-host',platform:'darwin',workspaces:[special]});
  const command=handoff.split('\n').find(line=>line.startsWith('node '))!;
  const output=await processOutput('/bin/sh',['-c',command],{cwd:root});assert.deepEqual(JSON.parse(output.toString()),[]);
  await assert.rejects(fs.stat(path.join(root,'INJECTED')));
  assert.ok(handoff.includes(skill.trim()));assert.ok(!handoff.includes(JSON.parse(await fs.readFile(descriptor,'utf8')).token));
  await bridge.stop();await assert.rejects(processOutput('/bin/sh',['-c',command],{cwd:root}));
 }finally{await bridge.stop();await fs.rm(root,{recursive:true,force:true});}
});
