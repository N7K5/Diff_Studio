import * as vscode from 'vscode';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createFixtures} from '../scripts/fixtures';
import {sshFixture} from './ssh-fixture';
export async function run(){
 const previousClipboard=await vscode.env.clipboard.readText();
 const root=path.resolve(__dirname,'..');const dir=path.join(root,'.test-vscode');await fs.mkdir(dir,{recursive:true});
 const fixtures=await createFixtures(path.join(root,'.test-data',`vscode-${Date.now()}`));
 process.env.PATH=(await sshFixture(fixtures.root))+path.delimiter+process.env.PATH;
 const extension=vscode.extensions.getExtension('KUNU.diff-studio-pro');assert.ok(extension,'Extension is registered');const api=await extension.activate();assert.ok(api.studio);
 const commands=await vscode.commands.getCommands();for(const c of ['open','compareSelected','gitWorking','gitBase','startAgent','stopAgent','copyAgentInstructions'])assert.ok(commands.includes('diffStudio.'+c));
 const session=await vscode.commands.executeCommand<any>('diffStudio.open',{left:{kind:'file',uri:path.join(fixtures.left,'sample.ts')},right:{kind:'file',uri:path.join(fixtures.right,'sample.ts')},title:'Editable local files'});
 assert.ok(session.left.writable&&session.right.writable);const descriptor=await vscode.commands.executeCommand<string>('diffStudio.startAgent');
 await vscode.commands.executeCommand('workbench.action.closePanel');await vscode.commands.executeCommand('workbench.action.closeSidebar');await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
 await fs.writeFile(path.join(dir,'ready.json'),JSON.stringify({fixtures,descriptor,sessionId:session.id}));
 // The UI driver uses real clicks and checks saved files, then releases this host.
 const deadline=Date.now()+15*60*1000;
 while(Date.now()<deadline){
 try{await fs.stat(path.join(dir,'read-clipboard'));await fs.writeFile(path.join(dir,'clipboard.txt'),await vscode.env.clipboard.readText());await fs.rm(path.join(dir,'read-clipboard'));}catch{}
 try{await fs.stat(path.join(dir,'finish'));await vscode.commands.executeCommand('diffStudio.stopAgent');await vscode.env.clipboard.writeText(previousClipboard);return;}catch{}await new Promise(r=>setTimeout(r,500));}
 throw new Error('UI test driver did not finish');
}
