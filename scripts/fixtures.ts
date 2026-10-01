import {promises as fs} from 'node:fs';
import path from 'node:path';
import {Transport} from '../src/transport';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export async function createFixtures(root:string){
 await fs.mkdir(root,{recursive:true});const repo=path.join(root,'repo');await fs.mkdir(repo,{recursive:true});const io=new Transport();
 const git=(...args:string[])=>io.run(repo,['git',...args]);
 const commit=(message:string,date:string)=>promisify(execFile)('git',['commit','-m',message],{cwd:repo,env:{...process.env,GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}});
 await git('init','-b','master');await git('config','user.name','Diff Studio Test');await git('config','user.email','diff-studio@example.invalid');
 await fs.writeFile(path.join(repo,'app.ts'),'export function greet(name: string) {\n  return `Hello ${name}`;\n}\n');
 await fs.writeFile(path.join(repo,'removed.txt'),'This file will be removed.\n');await fs.writeFile(path.join(repo,'old name.txt'),'Rename me without changing my content.\n');
 await fs.writeFile(path.join(repo,'staged.txt'),'base\n');await git('add','.');await commit('Initial master version','2024-01-01T10:00:00Z');const base=(await git('rev-parse','HEAD')).toString().trim();await git('tag','v1.0',base);
 await git('checkout','-b','feature');await fs.writeFile(path.join(repo,'app.ts'),'export function greet(name: string) {\n  return `Welcome ${name}!`;\n}\n\nexport const version = 2;\n');
 await git('mv','old name.txt','new name.txt');await git('rm','removed.txt');await fs.writeFile(path.join(repo,'added.json'),'{"enabled":true}\n');await git('add','.');await commit('Add feature, remove and rename files','2024-02-01T10:00:00Z');const head=(await git('rev-parse','HEAD')).toString().trim();
 await fs.appendFile(path.join(repo,'app.ts'),'// Uncommitted working change\n');await fs.writeFile(path.join(repo,'staged.txt'),'staged change\n');await git('add','staged.txt');await fs.appendFile(path.join(repo,'staged.txt'),'unstaged change\n');await fs.writeFile(path.join(repo,'untracked.md'),'# New untracked file\n');
 const left=path.join(root,'left'),right=path.join(root,'right');await fs.mkdir(left,{recursive:true});await fs.mkdir(right,{recursive:true});
 for(const dir of [left,right])await fs.writeFile(path.join(dir,'same.txt'),'unchanged\n');
 await fs.writeFile(path.join(left,'sample.ts'),'const value: number = 1;\n');await fs.writeFile(path.join(right,'sample.ts'),'const value: number = 2;\nconst enabled = true;\n');
 await fs.writeFile(path.join(left,"space ' quote.txt"),'left only\n');await fs.writeFile(path.join(right,'right-only.txt'),'right only\n');
 return {root,repo,left,right,base,head};
}
if(process.argv[1]?.endsWith('fixtures.ts')){const root=path.resolve(process.argv[2]||`.test-data/fixtures-${Date.now()}`);void createFixtures(root).then(result=>console.log(JSON.stringify(result,null,2)));}
