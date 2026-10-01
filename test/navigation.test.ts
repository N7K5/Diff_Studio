import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {RecentList, comparisonKey, persistable, ComparisonTarget} from '../src/recent';
import {changeTree} from '../src/tree';
import {ChangeEntry} from '../src/types';
import {Transport,sshRoot,joinLocation} from '../src/transport';
import {sshFixture} from './ssh-fixture';

test('recent comparisons are bounded, deduplicated, reordered, removable and restorable',()=>{
  const recent=new RecentList<number>(2);recent.add('a','A',1);const b=recent.add('b','B',2);recent.add('a','A again',3);
  assert.deepEqual(recent.items.map(i=>i.key),['a','b']);assert.equal(recent.items[0].value,3);
  recent.add('c','C',4);assert.deepEqual(recent.items.map(i=>i.key),['c','a']);recent.remove(b.id);recent.remove(recent.items[0].id);assert.equal(recent.items.length,1);
  const restored=new RecentList<number>(2,JSON.parse(JSON.stringify(recent.items)));assert.deepEqual(restored.items,recent.items);
  restored.resize(0);restored.add('x','X',5);assert.equal(restored.items.length,0);assert.throws(()=>restored.resize(1.5));
});
test('comparison identity ignores display titles and file creation hints, but preserves revisions and side order',()=>{
  const a:ComparisonTarget={type:'open',request:{left:{kind:'file',uri:'/a'},right:{kind:'file',uri:'/b'},title:'First'}};
  const b:ComparisonTarget={type:'open',request:{left:{kind:'file',uri:'/a',allowMissing:true},right:{kind:'file',uri:'/b'},title:'Second'}};
  assert.equal(comparisonKey(a),comparisonKey(b));assert.notEqual(comparisonKey(a),comparisonKey({type:'open',request:{left:a.request.right,right:a.request.left}}));
  assert.equal(persistable(a),true);assert.equal(persistable({type:'open',request:{left:{kind:'text',label:'secret',text:'private snapshot'},right:a.request.right}}),false);
});
test('changed-file tree groups folders first and preserves statuses, renames and same-name siblings',()=>{
  const entries=['z.txt','src/nested/a.ts','src/b.ts','test/a.ts','src'].map((p,i)=>({path:p,status:i===1?'R':'M',oldPath:i===1?'old/a.ts':undefined,left:{kind:'text',text:'',label:'base'},right:{kind:'file',uri:'/tmp/'+p}} as ChangeEntry));
  const tree=changeTree(entries);assert.deepEqual(tree.map(n=>n.name),['src','test','src','z.txt']);assert.equal(tree[0].children[0].name,'nested');assert.equal(tree[0].children[0].children[0].entry?.oldPath,'old/a.ts');assert.equal(tree[1].children[0].path,'test/a.ts');assert.equal(changeTree([]).length,0);
});
test('SSH connection input supports aliases, users and ports and rejects passwords and injected options',()=>{
  assert.equal(sshRoot('user@server:2222'),'ssh://user@server:2222/');assert.equal(sshRoot('my-vm'),'ssh://my-vm/');
  for(const input of ['', '-oProxyCommand=x','ssh://user:password@server/','ssh://server/path','host;touch /tmp/no','ssh://host/?x=1'])assert.throws(()=>sshRoot(input));
});
test('production remote browse payload lists folders/files safely, navigates file parents and reports missing folders',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-browser-'));const oldPath=process.env.PATH;
  try{
    process.env.PATH=(await sshFixture(root))+path.delimiter+oldPath;
    await fs.mkdir(path.join(root,"folder ' space"));await fs.mkdir(path.join(root,'.hidden'));await fs.writeFile(path.join(root,'file # ü.txt'),'hello');await fs.symlink(path.join(root,"folder ' space"),path.join(root,'linked-folder'));
    const io=new Transport();const base=joinLocation('ssh://test.diff-studio.invalid/',root);
    const listing=await io.browse(base);assert.equal(listing.path,root);assert.ok(listing.entries.some(e=>e.name==="folder ' space"&&e.directory));assert.ok(listing.entries.some(e=>e.name==='linked-folder'&&e.directory));assert.ok(listing.entries.some(e=>e.name==='file # ü.txt'&&!e.directory));
    assert.equal((await io.browse('ssh://test.diff-studio.invalid/',true)).home,root);
    assert.equal((await io.browse(joinLocation(base,'file # ü.txt'))).path,root);
    assert.equal((await io.browse(joinLocation(base,"folder ' space"))).entries.length,0);
    await assert.rejects(io.browse(joinLocation(base,'missing')),/No such file/);await assert.rejects(io.browse('ssh://offline.diff-studio.invalid/',true),/offline/);
  }finally{process.env.PATH=oldPath;await fs.rm(root,{recursive:true,force:true});}
});
