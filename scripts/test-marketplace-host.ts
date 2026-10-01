import * as vscode from 'vscode';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createArchive,saveArchive} from '../src/archive';

export async function run(){
 const root=path.resolve(__dirname,'..'),control=path.join(root,'.test-marketplace');
 const demo=await fs.mkdtemp('/private/tmp/diff-studio-demo-');
 const repo=path.join(demo,'checkout');await fs.mkdir(repo);
 const write=async(file:string,text:string)=>{await fs.mkdir(path.dirname(path.join(repo,file)),{recursive:true});await fs.writeFile(path.join(repo,file),text);};
 const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,stdio:'pipe'}).toString().trim();
 git('init','-b','main');git('config','user.name','Demo Developer');git('config','user.email','demo@example.com');
 await write('src/api/products.ts',`type Product = { id: string; name: string };\n\nexport async function loadProducts(): Promise<Product[]> {\n  const response = await fetch('/api/products');\n  return response.json();\n}\n`);
 await write('src/ui/catalog.ts',`import { loadProducts } from '../api/products';\n\nexport async function renderCatalog() {\n  const products = await loadProducts();\n  return products.map(product => product.name);\n}\n`);
 await write('src/legacy-client.ts','export const endpoint = "/api/v1/products";\n');
 await write('config/app.json','{\n  "retryCount": 0,\n  "showLoadingState": false\n}\n');
 git('add','.');git('commit','-m','Initial catalog');git('tag','v1.0');git('checkout','-b','feature/resilient-catalog');
 await write('src/api/products.ts',`type Product = { id: string; name: string };\n\nexport async function loadProducts(): Promise<Product[]> {\n  for (let attempt = 0; attempt < 3; attempt++) {\n    const response = await fetch('/api/products');\n    if (response.ok) return response.json();\n\n    const temporary = response.status >= 500;\n    if (!temporary || attempt === 2) {\n      throw new Error('Could not load products');\n    }\n    await new Promise(resolve => setTimeout(resolve, 300));\n  }\n  throw new Error('Retry limit reached');\n}\n`);
 await write('src/ui/catalog.ts',`import { loadProducts } from '../api/products';\n\nexport async function renderCatalog() {\n  try {\n    const products = await loadProducts();\n    return products.map(product => product.name);\n  } catch {\n    return ['Products are temporarily unavailable'];\n  }\n}\n`);
 await write('src/api/errors.ts','export const isTemporary = (status: number) => status >= 500;\n');
 await write('tests/products.test.ts',`import { test, expect } from 'vitest';\n\ntest('retries temporary server errors', async () => {\n  const result = await simulateResponses([503, 200]);\n  expect(result.attempts).toBe(2);\n});\n\ntest('does not retry a missing product', async () => {\n  const result = await simulateResponses([404]);\n  expect(result.attempts).toBe(1);\n});\n`);
 await write('config/app.json','{\n  "retryCount": 3,\n  "showLoadingState": true\n}\n');
 git('rm','src/legacy-client.ts');git('add','.');git('commit','-m','Handle temporary failures and loading states');git('tag','v1.1');
 await write('docs/review-notes.md','# Catalog review\n\nReview retry limits and user-visible error messages.\n');
 const before=path.join(demo,'before'),after=path.join(demo,'after');await fs.mkdir(before);
 for(const file of git('ls-tree','-r','--name-only','main').split('\n')){await fs.mkdir(path.dirname(path.join(before,file)),{recursive:true});await fs.writeFile(path.join(before,file),git('show',`main:${file}`)+'\n');}
 await fs.cp(repo,after,{recursive:true,filter:source=>path.basename(source)!=='.git'});
 const extension=vscode.extensions.getExtension('N7K5.diff-studio');if(!extension)throw new Error('Extension missing');
 const api=await extension.activate();await api.reveal();
 const descriptor=await api.startAgent();
 const auth=JSON.parse(await fs.readFile(descriptor,'utf8'));
 const call=async(route:string,body:any)=>{const response=await fetch(auth.url+route,{method:'POST',headers:{Authorization:`Bearer ${auth.token}`},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(JSON.stringify(value));return value as any;};
 const group=await call('/project',{repo,leftRef:'main',rightRef:'WORKING'});
 const sessionId=group.entries.find((e:any)=>e.path==='src/api/products.ts').sessionId;
 await call('/note',{id:sessionId,message:'Added bounded retries for temporary server errors. Client errors fail immediately.'});
 await call('/reveal',{id:sessionId});
 await vscode.commands.executeCommand('workbench.action.closePanel');
 await vscode.commands.executeCommand('workbench.action.closeSidebar');
 await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
 await fs.writeFile(path.join(control,'ready.json'),JSON.stringify({repo,before,after,descriptor,sessionId}));
 try{
  for(let i=0;i<1200;i++){
   const actionPath=path.join(control,'action.json');
   try{
    const action=JSON.parse(await fs.readFile(actionPath,'utf8'));await fs.rm(actionPath);
    if(action.type==='comment'){
     api.studio.comment(sessionId,'right',8,'Please retry only temporary server errors. A 404 should fail immediately.');
     const comment=api.studio.get(sessionId).comments[0];
     api.studio.reply(sessionId,comment.id,'The status check retries 5xx responses only, with a maximum of three attempts.','agent');
    }
    if(action.type==='archive'){
     const file=path.join(demo,'catalog-review.diff_studio');await saveArchive(file,createArchive(api.studio,sessionId));
     void vscode.commands.executeCommand('diffStudio.openSession',vscode.Uri.file(file));
    }
    if(action.type==='finish')break;
   }catch(e:any){if(e.code!=='ENOENT')throw e;}
   await new Promise(r=>setTimeout(r,250));
  }
 }finally{await api.stopAgent();await fs.rm(demo,{recursive:true,force:true});}
}
