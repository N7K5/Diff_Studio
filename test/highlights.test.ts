import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Studio} from '../src/studio';
import {AgentBridge} from '../src/bridge';
import {AgentReview} from '../src/agentReview';
import {processOutput,Transport} from '../src/transport';
import {createArchive,parseArchive,importArchive} from '../src/archive';

const source=(label:string,text=Array.from({length:50},(_,i)=>`line ${i+1}`).join('\n'))=>({kind:'text' as const,label,text});
async function comparison(studio:Studio){return studio.open({left:source('before.ts'),right:source('after.ts')});}

test('agents highlight 10 lines across five files and 20 across two files in a ten-file Git review',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-highlights-git-'));const studio=new Studio();
 try{
  const git=(...args:string[])=>processOutput('git',['-C',root,...args]);await git('init','-b','main');await git('config','user.name','Test');await git('config','user.email','test@example.invalid');
  for(let i=0;i<10;i++)await fs.writeFile(path.join(root,`file-${i}.ts`),source('').text);
  await git('add','.');await git('commit','-m','before');
  for(let i=0;i<10;i++)await fs.appendFile(path.join(root,`file-${i}.ts`),'\nnew line');
  await git('add','.');await git('commit','-m','after');
  const group=await new AgentReview(studio,()=>{}).project(root,'HEAD~1','HEAD');assert.equal(group.entries.length,10);
  const ids=group.entries.map(e=>e.sessionId!);
  const first=studio.setHighlights({label:'Validation',color:'#e5a84b',ranges:ids.slice(0,5).map(sessionId=>({sessionId,side:'left',startLine:3,endLine:4,comment:'Check validation'}))});
  const second=studio.setHighlights({label:'Error handling',color:'#67b7ef',ranges:ids.slice(5,7).map(sessionId=>({sessionId,side:'right',startLine:10,endLine:19,color:'#aa88dd',comment:'Review error handling'}))});
  assert.equal(first.ranges.reduce((n,r)=>n+r.endLine-r.startLine+1,0),10);assert.equal(second.ranges.reduce((n,r)=>n+r.endLine-r.startLine+1,0),20);
  assert.equal(studio.sessions.size,10);assert.equal(group.entries.length,10);assert.equal(studio.highlights.size,2);for(const range of [...first.ranges,...second.ranges])assert.equal(studio.get(range.sessionId).comments.find(c=>c.id===range.commentId)?.author,'agent');
  assert.ok([...studio.sessions.values()].every(s=>!s.left.writable&&!s.right.writable));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('highlight batches validate atomically and updates/removal preserve discussion threads',async()=>{
 const studio=new Studio(),s=await comparison(studio);const range={sessionId:s.id,side:'right',startLine:2,endLine:5,comment:'Explain this'};
 const set=studio.setHighlights({label:'Review',color:'#12ABef',ranges:[range]});assert.equal(set.color,'#12abef');const thread=s.comments[0];studio.reply(s.id,thread.id,'Please check one more thing');
 const before=JSON.stringify(createArchive(studio));
 for(const invalid of [{...range,endLine:500},{...range,startLine:0},{...range,endLine:1},{...range,side:'both'},{...range,color:'red;display:none'},{...range,sessionId:'missing'},{...range,comment:' '},{...range,commentId:thread.id}]){
  assert.throws(()=>studio.setHighlights({label:'Invalid batch',ranges:[range,invalid]}));assert.equal(JSON.stringify(createArchive(studio)).replace(/"createdAt":"[^"]+"/,''),before.replace(/"createdAt":"[^"]+"/,''));
 }
 const updated=studio.setHighlights({id:set.id,label:'Updated',color:'#112233',ranges:[{...range,comment:undefined,commentId:thread.id,startLine:1}]});assert.equal(studio.highlights.size,1);assert.equal(updated.ranges[0].commentId,thread.id);assert.equal(s.comments.length,1);assert.equal(thread.replies?.length,1);
 studio.removeHighlights(set.id);assert.equal(studio.highlights.size,0);assert.equal(s.comments.length,1);assert.equal(thread.replies?.length,1);assert.throws(()=>studio.highlightRange(set.id));
});

test('ranges shift with inserted lines, flag edits within the range, and clamp after deletion/reload',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-highlight-edits-'));try{
  const file=path.join(root,'a.ts');await fs.writeFile(file,'one\ntwo\nthree\nfour\nfive');const studio=new Studio(),s=await studio.open({left:source('old'),right:{kind:'file',uri:file}});
  const set=studio.setHighlights({label:'Watch',ranges:[{sessionId:s.id,side:'right',startLine:2,endLine:3,comment:'Watch these lines'}]});const r=set.ranges[0];
  studio.edit(s.id,'right','zero\none\ntwo\nthree\nfour\nfive');assert.deepEqual([r.startLine,r.endLine,r.outdated],[3,4,false]);assert.equal(s.comments[0].line,3);
  studio.edit(s.id,'right','zero\none\nchanged\nthree\nfour\nfive');assert.equal(r.outdated,true);assert.ok(r.startLine<=r.endLine);
  studio.edit(s.id,'right','');assert.deepEqual([r.startLine,r.endLine,r.outdated],[1,1,true]);await studio.reload(s.id,true);assert.equal(r.outdated,true);assert.ok(r.endLine<=5);
  studio.removeComment(s.id,s.comments[0].id);assert.equal(r.commentId,undefined);assert.doesNotThrow(()=>parseArchive(JSON.stringify(createArchive(studio))));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('portable sessions retain colors/ranges/comments offline, remap IDs, reject malformed highlights, and read legacy archives',async()=>{
 const studio=new Studio(),s=await comparison(studio);const set=studio.setHighlights({label:'Offline focus',color:'#123456',ranges:[{sessionId:s.id,side:'left',startLine:4,endLine:8,label:'Important branch',comment:'Why this branch?',color:'#654321'}]});studio.reply(s.id,s.comments[0].id,'Because of retries','agent');
 const archive=createArchive(studio,s.id);class Offline extends Transport{override async read():Promise<Buffer|null>{throw new Error('Offline');}}
 const restored=new Studio(new Offline());const imported=importArchive(restored,parseArchive(JSON.stringify(archive)));const copy=[...restored.highlights.values()][0];assert.notEqual(copy.id,set.id);assert.notEqual(copy.ranges[0].id,set.ranges[0].id);assert.equal(copy.ranges[0].sessionId,imported.active);assert.equal(copy.ranges[0].color,'#654321');assert.equal(restored.get(imported.active!).comments[0].replies?.[0].body,'Because of retries');assert.equal(restored.get(imported.active!).left.writable,false);
 importArchive(restored,parseArchive(JSON.stringify(archive)));assert.equal(restored.highlights.size,2);assert.equal(new Set([...restored.highlights.values()].map(g=>g.ranges[0].sessionId)).size,2);
 for(const patch of [{sessionId:'missing'},{startLine:0},{endLine:999},{color:'url(x)'},{commentId:'missing'},{outdated:'yes'}]){const bad=structuredClone(archive);Object.assign(bad.highlights![0].ranges[0],patch);assert.throws(()=>parseArchive(JSON.stringify(bad)));}
 const legacy=structuredClone(archive);delete legacy.highlights;assert.deepEqual(parseArchive(JSON.stringify(legacy)).highlights,[]);
});

test('highlight-only reviews are protected on reset and explicit reset removes stale groups',async()=>{
 const studio=new Studio(),s=await comparison(studio);studio.setHighlights({label:'Keep',ranges:[{sessionId:s.id,side:'left',startLine:1}]});assert.equal(s.comments.length,0);assert.throws(()=>studio.reset(),/highlights/);studio.reset(true);assert.equal(studio.highlights.size,0);assert.equal(studio.sessions.size,0);
});

test('fresh CLI processes publish/list/reveal/remove highlights and reply to their comments',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-highlight-cli-'));const studio=new Studio();let focus:string[]=[];const bridge=new AgentBridge(studio,()=>{},()=>{},()=>{},(id,rangeId)=>focus=[id,rangeId]);
 try{
  const s=await comparison(studio);const descriptor=await bridge.start(root);const cli=async(...args:string[])=>JSON.parse((await processOutput(process.execPath,[path.resolve('scripts/agent.mjs'),'--bridge',descriptor,...args])).toString());
  const file=path.join(root,'highlights.json');await fs.writeFile(file,JSON.stringify({label:'CLI review',color:'#20a0ff',ranges:[{sessionId:s.id,side:'right',startLine:3,endLine:10,comment:'Review this range'}]}));
  const set=await cli('highlight',file);assert.deepEqual(focus,[]);assert.equal((await cli('highlights'))[0].id,set.id);await cli('highlight-reveal',set.id,set.ranges[0].id);assert.deepEqual(focus,[set.id,set.ranges[0].id]);
  await cli('reply',s.id,set.ranges[0].commentId,'Reviewed');assert.equal((await cli('comments',s.id))[0].replies[0].body,'Reviewed');
  const updated={...JSON.parse(await fs.readFile(file,'utf8')),id:set.id};await fs.writeFile(file,JSON.stringify(updated));const next=await cli('highlight',file,'--reveal');assert.deepEqual(focus,[next.id,next.ranges[0].id]);await cli('highlight-remove',set.id);assert.deepEqual(await cli('highlights'),[]);assert.equal((await cli('comments',s.id)).length,2);await assert.rejects(cli('highlight-reveal',set.id));
 }finally{await bridge.stop();await fs.rm(root,{recursive:true,force:true});}
});
