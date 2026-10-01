import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Studio} from '../src/studio';
import {Transport} from '../src/transport';
import {createArchive,parseArchive,importArchive} from '../src/archive';

test('mixed Git trees isolate binary additions, deletions, renames and text/binary conversions across comparison modes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-mixed-git-'));const studio=new Studio();
 const git=(...args:string[])=>studio.io.run(root,['git',...args]);
 const write=(name:string,data:string|Buffer)=>fs.writeFile(path.join(root,name),data);
 try{
  await git('init','-b','master');await git('config','user.name','Diff Test');await git('config','user.email','diff@example.invalid');
  for(const name of ['modified.bin','deleted.bin','renamed.bin','to-text.bin'])await write(name,Buffer.from([0,1,2,3]));
  await write('to-binary.txt','before\n');await write('good.ts','const n = 1;\n');await git('add','.');await git('commit','-m','Base');await git('checkout','-b','feature');
  await write('modified.bin',Buffer.from([0,9]));await fs.rm(path.join(root,'deleted.bin'));await git('mv','renamed.bin','new-name.bin');await write('to-text.bin','now text\n');await write('to-binary.txt',Buffer.from([0,7]));await write('added.bin',Buffer.from([0,8]));await write('good.ts','const n = 2;\n');await git('add','.');await git('commit','-m','Mixed changes');
  for(const right of ['HEAD','WORKING']){
   const selected=await studio.git.selection(root,'','master',right);const group=await studio.captureGroup(right,selected.entries!);
   assert.equal(group.entries.length,7);assert.equal(group.entries.filter(e=>e.unavailable).length,6);
   for(const e of group.entries.filter(e=>e.unavailable)){assert.match(e.unavailable!,/Binary/);assert.equal(e.sessionId,undefined);}
   const good=studio.get(group.entries.find(e=>e.path==='good.ts')!.sessionId!);assert.equal(good.left.text,'const n = 1;\n');assert.equal(good.right.text,'const n = 2;\n');assert.equal(good.right.writable,right==='WORKING');
  }
  for(const mode of ['working','committed'] as const){const changed=await studio.git.changes(root,'master',mode);const group=await studio.captureGroup(mode,changed.entries);assert.equal(group.entries.filter(e=>e.unavailable).length,6);assert.ok(group.entries.find(e=>e.path==='good.ts')?.sessionId);}
  await write('modified.bin',Buffer.from([0,6]));await write('good.ts','const n = 3;\n');await git('add','.');
  const staged=await studio.git.changes(root,'HEAD','staged');const group=await studio.captureGroup('Staged',staged.entries);assert.equal(group.entries.filter(e=>e.unavailable).length,1);assert.equal(studio.get(group.entries.find(e=>e.path==='good.ts')!.sessionId!).right.text,'const n = 3;\n');
  await assert.rejects(studio.open(group.entries.find(e=>e.unavailable)!),/Binary/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('folder tree retains supported text beside binary and invalid UTF-8 files; per-file read errors do not discard successful snapshots',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-mixed-folder-'));
 try{
  const left=path.join(root,'left'),right=path.join(root,'right');await fs.mkdir(left);await fs.mkdir(right);
  await fs.writeFile(path.join(left,'good.txt'),'old');await fs.writeFile(path.join(right,'good.txt'),'new');await fs.writeFile(path.join(right,'image.png'),Buffer.from([0,1]));await fs.writeFile(path.join(left,'encoded.txt'),Buffer.from([255]));
  const studio=new Studio();const entries=await studio.directories(left,right);const group=await studio.captureGroup('Folders',entries);
  assert.equal(group.entries.length,3);assert.equal(group.entries.filter(e=>e.unavailable).length,2);assert.match(group.entries.find(e=>e.path==='encoded.txt')!.unavailable!,/UTF-8/);
  const good=studio.get(group.entries.find(e=>e.path==='good.txt')!.sessionId!);studio.edit(good.id,'right','still editable');await studio.save(good.id,'right');assert.equal(await fs.readFile(path.join(right,'good.txt'),'utf8'),'still editable');
  class FailedRead extends Transport {override async read(uri:string){if(uri.endsWith('image.png'))throw new Error('Permission denied');return super.read(uri);}}
  const partial=new Studio(new FailedRead());const result=await partial.captureGroup('Partial',entries);assert.match(result.entries.find(e=>e.path==='image.png')!.unavailable!,/Permission denied/);assert.ok(result.entries.find(e=>e.path==='good.txt')?.sessionId);
  await fs.writeFile(path.join(right,'large.bin'),Buffer.alloc(32));const limited=new Studio();limited.io.maxBytes=16;
  const limitedGroup=await limited.captureGroup('Size limit',await limited.directories(left,right));assert.equal(limitedGroup.entries.length,4);assert.match(limitedGroup.entries.find(e=>e.path==='large.bin')!.unavailable!,/exceeds/);assert.ok(limitedGroup.entries.find(e=>e.path==='good.txt')?.sessionId);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('mixed and all-binary archives preserve unavailable tree entries and reasons without source access or fake text snapshots',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-mixed-archive-'));
 try{
  const binary=path.join(root,'asset.bin');await fs.writeFile(binary,Buffer.from([0,1]));const studio=new Studio();
  const entry={path:'assets/asset.bin',status:'R',oldPath:'old.bin',left:{kind:'file' as const,uri:binary},right:{kind:'file' as const,uri:binary}};
  await studio.captureGroup('All binary',[entry]);assert.equal(studio.sessions.size,0);
  const emptyArchive=parseArchive(JSON.stringify(createArchive(studio)));assert.equal(emptyArchive.sessions.length,0);assert.match(emptyArchive.groups[0].entries[0].unavailable!,/Binary/);
  await studio.captureGroup('Mixed',[entry,{path:'good.ts',status:'M',left:{kind:'text',label:'Before',text:'old'},right:{kind:'text',label:'After',text:'new'}}]);
  const archive=parseArchive(JSON.stringify(createArchive(studio)));await fs.rm(binary);
  class Offline extends Transport {override async read():Promise<Buffer|null>{throw new Error('Must not read sources');}override async run():Promise<Buffer>{throw new Error('Must not run Git');}}
  const restored=new Studio(new Offline());importArchive(restored,archive);assert.equal(restored.sessions.size,1);assert.equal(restored.groups.size,2);
  const unavailable=[...restored.groups.values()][0].entries[0];assert.equal(unavailable.sessionId,undefined);assert.equal(unavailable.oldPath,'old.bin');assert.match(unavailable.unavailable!,/Binary/);
  assert.equal(parseArchive(JSON.stringify(createArchive(restored))).groups[0].entries[0].unavailable,unavailable.unavailable);
  const invalid=structuredClone(archive);invalid.groups[0].entries[0].sessionId=invalid.sessions[0].id;assert.throws(()=>parseArchive(JSON.stringify(invalid)),/Invalid unavailable/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
