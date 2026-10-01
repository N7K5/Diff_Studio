import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Studio} from '../src/studio';
import {Transport} from '../src/transport';
import {createFixtures} from '../scripts/fixtures';
import {createArchive,parseArchive,saveArchive,readArchive,importArchive,linkRepository} from '../src/archive';

async function fixture(){return createFixtures(await fs.mkdtemp(path.join(os.tmpdir(),'diff-archive-')));}
test('comments can be created on either side, edited, deleted, and follow inserted lines',async()=>{
  const studio=new Studio();const s=await studio.open({left:{kind:'text',text:'left\nsecond\n',label:'left'},right:{kind:'text',text:'first\nsecond\nthird\n',label:'right'}});
  const left=studio.comment(s.id,'left',1,'  Explain the old line  ');const right=studio.comment(s.id,'right',2,'Check this');assert.equal(left.body,'Explain the old line');
  studio.comment(s.id,'right',2,'Updated',right.id);assert.equal(s.comments.length,2);assert.equal(s.comments[1].body,'Updated');
  s.right.writable=true;studio.edit(s.id,'right','inserted\nfirst\nsecond\nthird\n');assert.equal(s.comments[1].line,3);assert.equal(s.comments[1].outdated,false);
  studio.edit(s.id,'right','inserted\nfirst\nreplacement\nthird\n');assert.equal(s.comments[1].outdated,true);assert.equal(s.comments[1].anchor,'second');
  studio.removeComment(s.id,left.id);assert.equal(s.comments.length,1);assert.throws(()=>studio.comment(s.id,'left',99,'bad'));assert.throws(()=>studio.comment(s.id,'right',1,' '));
});
test('archive captures unclicked changed files, statuses, snapshots, unsaved edits and comments without requiring the repository on import',async()=>{
  const f=await fixture();try{
    const studio=new Studio();const s=await studio.open({left:{kind:'git',repo:f.repo,path:'app.ts',ref:'HEAD'},right:{kind:'file',uri:path.join(f.repo,'app.ts')}});
    const before=s.right.text;studio.edit(s.id,'right',before+'// unsaved 😀\n');studio.comment(s.id,'left',1,'Review the original');studio.comment(s.id,'right',2,'New behavior');
    const changed=await studio.git.changes(f.repo,'master');const group=await studio.captureGroup('Against master',changed.entries);assert.ok(group.entries.some(e=>e.status==='R'));assert.ok(group.entries.some(e=>e.status==='D'));
    const file=path.join(f.root,'review.diff_studio');await saveArchive(file,createArchive(studio,s.id));await fs.rename(f.repo,path.join(f.root,'repo-no-longer-present'));
    class Offline extends Transport {override async read():Promise<Buffer|null>{throw new Error('No repository access allowed');}override async run():Promise<Buffer>{throw new Error('No commands allowed');}}
    const reopened=new Studio(new Offline());const imported=importArchive(reopened,await readArchive(file));const current=reopened.get(imported.active!);
    assert.equal(current.right.text,before+'// unsaved 😀\n');assert.equal(current.right.savedText,before);assert.equal(current.right.initialText,before);assert.equal(current.left.resolvedRef,f.head);assert.equal(current.comments.length,2);assert.equal(current.right.writable,false);
    assert.equal(reopened.groups.size,1);for(const entry of [...reopened.groups.values()][0].entries)assert.ok(reopened.sessions.has(entry.sessionId!));
    assert.equal(reopened.sessions.size,studio.sessions.size);assert.equal(reopened.get([...reopened.groups.values()][0].entries.find(e=>e.path==='untracked.md')!.sessionId!).right.text,'# New untracked file\n');
    await reopened.reload(current.id);assert.equal(current.left.origin?.kind,'git');assert.equal(current.right.savedText,before);assert.equal(current.right.archived,true);
    reopened.comment(current.id,'left',1,'Offline reviewer comment');await saveArchive(file,createArchive(reopened,current.id));const third=new Studio(new Offline());const result=importArchive(third,await readArchive(file));assert.equal(third.get(result.active!).comments.length,3);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('archive repository linking enables only matching working files and preserves captured unsaved edits',async()=>{
  const f=await fixture();try{
    const studio=new Studio();const original=path.join(f.repo,'app.ts');const s=await studio.open({left:{kind:'git',repo:f.repo,path:'app.ts',ref:'HEAD'},right:{kind:'file',uri:original}});const old=s.right.text;studio.edit(s.id,'right',old+'// review edit\n');
    const clone=path.join(f.root,'clone');await fs.cp(f.repo,clone,{recursive:true});const reopened=new Studio();const imported=importArchive(reopened,parseArchive(JSON.stringify(createArchive(studio,s.id))));
    assert.deepEqual(await linkRepository(reopened,imported.sessions,clone,f.repo),{linked:1,detached:0});const linked=imported.sessions[0];assert.equal(linked.right.writable,true);assert.equal(linked.right.dirty,true);await reopened.save(linked.id,'right');assert.equal(await fs.readFile(original,'utf8'),old);assert.match(await fs.readFile(path.join(clone,'app.ts'),'utf8'),/review edit/);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('different commits, changed working files and outside-repository paths retain detached snapshots',async()=>{
  const f=await fixture();try{
    const studio=new Studio();const s=await studio.open({left:{kind:'git',repo:f.repo,path:'app.ts',ref:'HEAD'},right:{kind:'file',uri:path.join(f.repo,'app.ts')}});const archive=createArchive(studio,s.id);
    const clone=path.join(f.root,'clone');await fs.cp(f.repo,clone,{recursive:true});await fs.writeFile(path.join(clone,'app.ts'),'different file');
    for(const mismatch of ['file','commit','path','git-metadata','symlink']){
      const input=structuredClone(archive);if(mismatch==='commit')input.sessions[0].left.resolvedRef='f'.repeat(40);
      if(mismatch==='path')input.sessions[0].right.source={kind:'file',uri:path.join(f.root,'outside.txt')};
      if(mismatch==='git-metadata'){input.sessions[0].right.source={kind:'file',uri:path.join(f.repo,'.git','config')};input.sessions[0].right.savedText=await fs.readFile(path.join(clone,'.git','config'),'utf8');}
      if(mismatch==='symlink'){await fs.rm(path.join(clone,'app.ts'));await fs.writeFile(path.join(f.root,'outside.txt'),s.right.savedText);await fs.symlink(path.join(f.root,'outside.txt'),path.join(clone,'app.ts'));}
      const reopened=new Studio();const imported=importArchive(reopened,parseArchive(JSON.stringify(input)));assert.deepEqual(await linkRepository(reopened,imported.sessions,clone,f.repo),{linked:0,detached:1});assert.equal(imported.sessions[0].right.text,s.right.text);assert.equal(imported.sessions[0].right.writable,false);
    }
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('archives validate version, checksums, references and comment coordinates before changing session state',async()=>{
  const studio=new Studio();const s=await studio.open({left:{kind:'text',label:'<script>',text:'你好\r\n'},right:{kind:'text',label:'right',text:''}});studio.comment(s.id,'left',1,'<img src=x onerror=alert(1)>');const original=createArchive(studio,s.id);
  assert.equal(parseArchive(JSON.stringify(original)).sessions[0].comments[0].body,'<img src=x onerror=alert(1)>');
  for(const mutate of [(a:any)=>a.version=42,(a:any)=>a.sessions[0].right.text='tampered',(a:any)=>a.sessions.push(a.sessions[0]),(a:any)=>a.sessions[0].comments[0].line=999,(a:any)=>a.groups.push({id:'g',label:'bad',entries:[{path:'a',status:'M',sessionId:'missing'}]})]){const broken=structuredClone(original);mutate(broken);assert.throws(()=>parseArchive(JSON.stringify(broken)));}
  assert.throws(()=>parseArchive('not json'));assert.throws(()=>parseArchive('null'));
});
