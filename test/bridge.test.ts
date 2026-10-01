import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Studio} from '../src/studio';
import {AgentBridge} from '../src/bridge';
import {processOutput} from '../src/transport';
test('bridge authenticates, rejects browser requests, exposes edits, protects stale content, saves and cleans credentials',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'diff-bridge-'));const studio=new Studio();let revealed='';const bridge=new AgentBridge(studio,id=>revealed=id);
 try {const descriptor=await bridge.start(root);const {url,token}=JSON.parse(await fs.readFile(descriptor,'utf8'));assert.equal((await fs.stat(descriptor)).mode&0o777,0o600);
 const request=(route:string,body?:any,extra:Record<string,string>={})=>fetch(url+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...extra},body:body?JSON.stringify(body):undefined});
 assert.equal((await fetch(url+'/sessions')).status,401);assert.equal((await request('/sessions',undefined,{Origin:'http://localhost'})).status,401);
 const file=path.join(root,'app.ts');await fs.writeFile(file,'const n=1;\n');const opened=await request('/open',{left:{kind:'text',text:'const n=1;\n',label:'Before'},right:{kind:'file',uri:file}});assert.equal(opened.status,200);const s:any=await opened.json();assert.equal(revealed,s.id);
 assert.equal((await request('/edit',{id:s.id,side:'right',text:'unsafe'})).status,400);
 assert.equal((await request('/edit',{id:s.id,side:'right',text:'const n=2;\n',expectedHash:s.right.hash,message:'Increase n'})).status,200);
 assert.equal(studio.get(s.id).right.dirty,true);assert.equal(await fs.readFile(file,'utf8'),'const n=1;\n');
 assert.equal((await request('/edit',{id:s.id,side:'right',text:'stale',expectedHash:s.right.hash})).status,400);
 assert.equal((await request('/save',{id:s.id,side:'right'})).status,200);assert.equal(await fs.readFile(file,'utf8'),'const n=2;\n');
 assert.equal((await request('/note',{id:s.id,message:'Done'})).status,200);assert.equal((await request('/reveal',{id:s.id})).status,200);assert.equal((await request('/reload',{id:s.id})).status,200);assert.equal((await request('/sessions')).status,200);assert.equal((await request('/unknown',{})).status,404);
 const proposed=path.join(root,'proposed.ts');await fs.writeFile(proposed,'const n=3;\n');
 const cli=(...args:string[])=>processOutput(process.execPath,[path.resolve('scripts/agent.mjs'),'--bridge',descriptor,...args]);
 const list=JSON.parse((await cli('list')).toString());assert.equal(list[0].id,s.id);await cli('note',s.id,'CLI explains the next change');await cli('edit',s.id,'right',proposed,'CLI updates the buffer');assert.equal(studio.get(s.id).right.text,'const n=3;\n');await cli('save',s.id,'right');assert.equal(await fs.readFile(file,'utf8'),'const n=3;\n');
 await cli('comment',s.id,'right','1','Agent review comment');const comment=studio.get(s.id).comments[0];assert.equal(comment.body,'Agent review comment');assert.equal((await request('/comment',{id:s.id,side:'right',line:999,body:'Invalid'})).status,400);await cli('comment-remove',s.id,comment.id);assert.equal(studio.get(s.id).comments.length,0);
 await bridge.stop();await assert.rejects(fs.stat(descriptor));
 }finally{await bridge.stop();await fs.rm(root,{recursive:true,force:true});}
});
