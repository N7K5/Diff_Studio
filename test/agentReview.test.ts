import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Studio} from '../src/studio';
import {AgentReview} from '../src/agentReview';
import {AgentBridge} from '../src/bridge';
import {processOutput} from '../src/transport';
import {createFixtures} from '../scripts/fixtures';
import {createArchive,parseArchive,importArchive} from '../src/archive';
import type {ComparisonGroup} from '../src/types';

test('agent file opens accumulate, concurrent repeats retain IDs and comments, and different baselines remain selectable',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-agent-files-'));try{
  const studio=new Studio();let latest:ComparisonGroup|undefined;const review=new AgentReview(studio,g=>latest=g);
  const file=path.join(root,'src','a.ts');await fs.mkdir(path.dirname(file));await fs.writeFile(file,'new');
  const request={left:{kind:'text' as const,label:'Before',text:'old'},right:{kind:'file' as const,uri:file}};
  const copies=await Promise.all([review.open(request),review.open(request)]);assert.equal(copies[0].id,copies[1].id);const first=copies[0];studio.comment(first.id,'right',1,'Keep this comment');studio.edit(first.id,'right','unsaved');
  const secondFile=path.join(root,'test','b.ts');await fs.mkdir(path.dirname(secondFile));await fs.writeFile(secondFile,'test');await review.open({...request,right:{kind:'file',uri:secondFile}});
  assert.deepEqual(latest!.entries.map(e=>e.path).sort(),['src/a.ts','test/b.ts']);assert.equal((await review.open(request)).id,first.id);assert.equal(first.right.text,'unsaved');assert.equal(first.comments.length,1);
  await review.open({...request,left:{kind:'text',label:'Older baseline',text:'older'}});assert.equal(latest!.entries.length,3);assert.equal(new Set(latest!.entries.map(e=>e.path)).size,3);assert.ok(latest!.entries.some(e=>e.sessionId===first.id));
  const restored=new Studio();importArchive(restored,parseArchive(JSON.stringify(createArchive(studio))));assert.equal([...restored.groups.values()][0].entries.length,3);assert.ok([...restored.sessions.values()].some(s=>s.comments[0]?.body==='Keep this comment'&&s.right.text==='unsaved'));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('project/folder agent commands retain structured groups, tolerate binary files and reuse reviewed buffers',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-agent-project-'));try{
  const f=await createFixtures(root);const studio=new Studio();const review=new AgentReview(studio,()=>{});
  const first=await review.open({left:{kind:'git',repo:f.repo,path:'app.ts',ref:'master'},right:{kind:'file',uri:path.join(f.repo,'app.ts'),allowMissing:true}});studio.comment(first.id,'right',1,'Existing review');studio.edit(first.id,'right',first.right.text+'// unsaved\n');
  await fs.writeFile(path.join(f.repo,'binary.bin'),Buffer.from([0,1]));const group=await review.project(f.repo,'master');assert.equal(group.entries.find(e=>e.path==='app.ts')?.sessionId,first.id);assert.ok(first.right.dirty);assert.equal(first.comments.length,1);assert.ok(group.entries.find(e=>e.path==='binary.bin')?.unavailable);
  const folders=await review.folders(f.left,f.right);assert.equal(folders.entries.length,3);const combined=[...studio.groups.values()].find(g=>g.label==='Agent files')!;assert.ok(combined.entries.length>group.entries.length);assert.ok(combined.entries.some(e=>e.sessionId===first.id));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('fresh agent CLI reads user comments, replies, fixes and resolves without deleting threads; archives retain discussion state',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-agent-comments-'));const studio=new Studio();const bridge=new AgentBridge(studio);
 try{
  const file=path.join(root,'a.ts');await fs.writeFile(file,'const n=1;\n');const descriptor=await bridge.start(root);const cli=async(...args:string[])=>JSON.parse((await processOutput(process.execPath,[path.resolve('scripts/agent.mjs'),'--bridge',descriptor,...args])).toString());
  const session=await cli('open',file,file);const comment=studio.comment(session.id,'right',1,'Please use 2');let comments=await cli('comments');assert.equal(comments[0].sessionId,session.id);assert.equal(comments[0].author,'user');
  await cli('reply',session.id,comment.id,'I will update the value.');const content=path.join(root,'proposal.ts');await fs.writeFile(content,'const n=2;\n');await cli('edit',session.id,'right',content);await cli('save',session.id,'right');await cli('reply',session.id,comment.id,'Updated and verified.');await cli('resolve',session.id,comment.id);
  comments=await cli('comments',session.id);assert.equal(comments[0].body,'Please use 2');assert.equal(comments[0].replies.length,2);assert.equal(comments[0].replies[0].author,'agent');assert.equal(comments[0].resolved,true);assert.equal(await fs.readFile(file,'utf8'),'const n=2;\n');
  const restored=new Studio();importArchive(restored,parseArchive(JSON.stringify(createArchive(studio))));const archived=[...restored.sessions.values()][0].comments[0];assert.equal(archived.resolved,true);assert.equal(archived.replies?.length,2);
  await cli('reopen',session.id,comment.id);assert.equal((await cli('comments',session.id))[0].resolved,false);assert.ok((await cli('groups')).some((g:ComparisonGroup)=>g.label==='Agent files'));await assert.rejects(cli('reply',session.id,'missing','bad'));assert.throws(()=>studio.resolveComment(session.id,comment.id,'yes' as any));
  const bad=createArchive(studio);bad.sessions[0].comments[0].replies![0].author='intruder' as any;assert.throws(()=>parseArchive(JSON.stringify(bad)),/Invalid comment reply/);
 }finally{await bridge.stop();await fs.rm(root,{recursive:true,force:true});}
});
