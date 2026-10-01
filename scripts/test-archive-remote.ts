import {promises as fs} from 'node:fs';
import assert from 'node:assert/strict';
import {Studio} from '../src/studio';
import {Transport} from '../src/transport';
import {createArchive,saveArchive,readArchive,importArchive} from '../src/archive';
const host='phoenix773679.private1.oaceng02phx.oraclevcn.com';const remotePath=`/tmp/diff-studio-archive-${Date.now()}.ts`;const uri=`ssh://${host}${remotePath}`;const io=new Transport(10*1048576,45000);const studio=new Studio(io);const checks:string[]=[];
try{
 await io.write(uri,Buffer.from('export const remote = 1;\n'),'missing');const s=await studio.open({left:{kind:'text',label:'before.ts',text:'export const remote = 0;\n'},right:{kind:'file',uri}});assert.equal(s.right.text,'export const remote = 1;\n');checks.push('Read a real Oracle VM file into a comparison');
 studio.comment(s.id,'right',1,'Review this remote change offline');studio.edit(s.id,'right','export const remote = 2;\n');const archive='artifacts/v040-remote-review.diff_studio';await saveArchive(archive,createArchive(studio,s.id));checks.push('Archive includes remote contents, unsaved edits and line comment');
 await io.run(`ssh://${host}/tmp`,['rm','-f','--',remotePath]);checks.push('Original remote fixture removed before reopening');
 class Offline extends Transport {override async read():Promise<Buffer|null>{throw new Error('Offline review must not read sources');}override async run():Promise<Buffer>{throw new Error('Offline review must not run SSH or Git');}}
 const restored=new Studio(new Offline());const loaded=importArchive(restored,await readArchive(archive));const session=restored.get(loaded.active!);assert.equal(session.right.text,'export const remote = 2;\n');assert.equal(session.comments[0].body,'Review this remote change offline');assert.equal(session.right.writable,false);checks.push('Fresh offline studio restores remote comparison and comment without SSH or source files');
 const report={passed:true,host,checks,date:new Date().toISOString()};await fs.writeFile('artifacts/v040-remote-archive.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await io.run(`ssh://${host}/tmp`,['rm','-f','--',remotePath]);}
