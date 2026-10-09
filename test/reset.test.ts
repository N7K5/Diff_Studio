import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Studio} from '../src/studio';
import {AgentBridge} from '../src/bridge';
import {Transport,processOutput} from '../src/transport';
import {createFixtures} from '../scripts/fixtures';

test('reset protects drafts/comments, clears both trees and sessions, keeps connection and accepts a second review',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-reset-'));const studio=new Studio();let resets=0;const bridge=new AgentBridge(studio,()=>{},()=>{},()=>resets++);
 try{
  const file=path.join(root,'a.ts');await fs.writeFile(file,'before');const descriptor=await bridge.start(root);const originalDescriptor=await fs.readFile(descriptor,'utf8');
  const cli=async(...args:string[])=>JSON.parse((await processOutput(process.execPath,[path.resolve('scripts/agent.mjs'),'--bridge',descriptor,...args])).toString());
  const first=await cli('open',file,file);studio.edit(first.id,'right','draft');studio.comment(first.id,'right',1,'Review this');
  await assert.rejects(cli('reset'),/unsaved edits.*comments/);assert.equal(studio.sessions.size,1);assert.equal(resets,0);
  await cli('reset','--discard');assert.equal(studio.sessions.size,0);assert.equal(studio.groups.size,0);assert.equal(resets,1);assert.equal(await fs.readFile(file,'utf8'),'before');assert.equal(await fs.readFile(descriptor,'utf8'),originalDescriptor);
  await fs.writeFile(file,'second');const second=await cli('open',file,file);assert.notEqual(second.id,first.id);assert.equal(second.right.text,'second');assert.equal(second.comments.length,0);assert.equal((await cli('groups'))[0].entries.length,1);
  studio.comment(second.id,'left',1,'Comment only');await assert.rejects(cli('reset'),/comments/);await cli('reset','--discard');await cli('reset');
  assert.deepEqual(await cli('list'),[]);assert.deepEqual(await cli('comments'),[]);
 }finally{await bridge.stop();await fs.rm(root,{recursive:true,force:true});}
});

test('replacement and custom lists explicitly reveal a second review, retain prior drafts/comments and refresh clean files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-replace-'));const studio=new Studio();let forced=false;const shows:string[]=[];const bridge=new AgentBridge(studio,(_id,force)=>forced=!!force,(group,show)=>{if(show)shows.push(group.id);});
 try{
  const f=await createFixtures(root);const descriptor=await bridge.start(root);const cli=async(...args:string[])=>JSON.parse((await processOutput(process.execPath,[path.resolve('scripts/agent.mjs'),'--bridge',descriptor,...args])).toString());
  const file=path.join(f.left,'sample.ts');const first=await cli('open',file,file);studio.comment(first.id,'right',1,'Preserve me');studio.edit(first.id,'right','unsaved');
  const project=await cli('project',f.repo,'master','WORKING','--replace');assert.ok(forced);assert.ok(shows.includes(project.id));assert.equal(studio.get(first.id).right.text,'unsaved');assert.equal(studio.get(first.id).comments.length,1);
  const request=path.join(root,'changes.json');const custom={label:'Next task',comparisons:[{path:'src/new.ts',left:{kind:'text',label:'before.ts',text:'before'},right:{kind:'file',uri:path.join(f.right,'sample.ts')}}]};await fs.writeFile(request,JSON.stringify(custom));
  const next=await cli('changes',request,'--replace');assert.equal(next.entries.length,1);assert.equal((await cli('groups')).find((g:any)=>g.label==='Agent files').entries.length,1);
  const newId=next.entries[0].sessionId;await fs.writeFile(path.join(f.right,'sample.ts'),'changed again');const refresh=await cli('changes',request,'--replace');assert.equal(refresh.entries[0].sessionId,newId);assert.equal(studio.get(newId).right.text,'changed again');
  await fs.writeFile(request,JSON.stringify({label:'Nothing changed',comparisons:[]}));const empty=await cli('changes',request,'--replace');assert.deepEqual(empty.entries,[]);assert.ok(shows.includes(empty.id));assert.equal((await cli('groups')).find((g:any)=>g.label==='Agent files').entries.length,0);assert.ok(studio.sessions.has(first.id));
  await fs.writeFile(request,JSON.stringify({label:'Bad',comparisons:[{}]}));await assert.rejects(cli('changes',request,'--replace'));assert.ok(studio.sessions.has(first.id));
  const folders=await cli('folders',f.left,f.right,'--replace');assert.equal(folders.entries.length,3);assert.ok(forced);
 }finally{await bridge.stop();await fs.rm(root,{recursive:true,force:true});}
});

test('reset invalidates an in-flight capture instead of resurrecting comparisons',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 class SlowTransport extends Transport{override async read(_uri:string){await gate;return Buffer.from('text');}}
 const studio=new Studio(new SlowTransport());const request={left:{kind:'file' as const,uri:'/left'},right:{kind:'file' as const,uri:'/right'}};
 const opening=studio.open(request);const captured=studio.captureGroup('Old',[{...request,path:'file.ts',status:'M'}]);studio.reset();release();
 await assert.rejects(opening,/session was reset/);await assert.rejects(captured,/session was reset/);assert.equal(studio.sessions.size,0);assert.equal(studio.groups.size,0);
 const next=await studio.open(request);assert.ok(studio.sessions.has(next.id));
});

test('queued reset waits for an earlier operation and permits a later open',async()=>{
 const studio=new Studio();const bridge=new AgentBridge(studio);let release!:()=>void;const gate=new Promise<void>(r=>release=r);
 const request={left:{kind:'text' as const,label:'left',text:'old'},right:{kind:'text' as const,label:'right',text:'new'}};
 const first=studio.runExclusive(async()=>{await gate;return studio.open(request);});const reset=studio.runExclusive(()=>bridge.reset());const second=studio.runExclusive(()=>studio.open(request));release();
 const old=await first;await reset;const fresh=await second;assert.ok(!studio.sessions.has(old.id));assert.ok(studio.sessions.has(fresh.id));assert.equal(studio.sessions.size,1);
});
