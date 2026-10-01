// Capture the real VS Code webview with disposable sample data; no UI mockups.
import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright';
const root=process.cwd(),dir=path.join(root,'.test-marketplace');
await fs.mkdir(path.join(dir,'user','User'),{recursive:true});
await fs.mkdir('assets/screenshots',{recursive:true});
await fs.rm(path.join(dir,'ready.json'),{force:true});await fs.rm(path.join(dir,'action.json'),{force:true});
await fs.writeFile(path.join(dir,'user','User','settings.json'),JSON.stringify({'workbench.startupEditor':'none','window.restoreWindows':'none','telemetry.telemetryLevel':'off','workbench.colorTheme':'Default Dark Modern','window.zoomLevel':0,'files.simpleDialog.enable':true,'diffStudio.showTopBar':false,'diffStudio.sidebarWidth':285,'diffStudio.fontSize':15,'diffStudio.wordWrap':true}));
await build({entryPoints:['scripts/test-marketplace-host.ts'],bundle:true,platform:'node',format:'cjs',external:['vscode'],outfile:'dist/vscode-tests.cjs'});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.NODE_OPTIONS;
const log=await fs.open('artifacts/marketplace-screenshots.log','w');
const child=spawn('/Applications/Visual Studio Code.app/Contents/MacOS/Code',[`--extensionDevelopmentPath=${root}`,`--extensionTestsPath=${root}/dist/vscode-tests.cjs`,`--user-data-dir=${dir}/user`,`--extensions-dir=${dir}/extensions`,'--remote-debugging-port=9334','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-updates','--new-window',root],{env,stdio:['ignore',log.fd,log.fd]});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){let error;for(let i=0;i<180;i++){try{const result=await fn();if(result)return result;}catch(e){error=e;}await sleep(250);}throw error||new Error('Timed out');}
let browser;const errors=[];
try{
 browser=await until(()=>chromium.connectOverCDP('http://127.0.0.1:9334'));
 const ready=await until(async()=>JSON.parse(await fs.readFile(path.join(dir,'ready.json'),'utf8')));
 const page=await until(()=>browser.contexts()[0].pages().find(p=>p.url().includes('workbench')));
 page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1680,height:1100});
 const frame=await until(async()=>{for(const f of page.frames())if(await f.locator('#comparison').count())return f;});
 await frame.locator('#comparison').waitFor({state:'visible'});
 await until(async()=>(await frame.locator('#stats').textContent()).includes('change'));
 const action=type=>fs.writeFile(path.join(dir,'action.json'),JSON.stringify({type}));
 const capture=async(name)=>{await page.setViewportSize({width:1680,height:name==='git-revisions'?1100:900});await frame.locator('#title').click();await sleep(900);await frame.locator('body').screenshot({path:`assets/screenshots/${name}.png`});console.log('Captured '+name);};
 await frame.locator('#file-set').selectOption({label:'Agent files (7)'});
 await frame.locator(`[data-session-id="${ready.sessionId}"]`).click();
 await capture('agent-project');
 await action('comment');await frame.locator('.comment-reply').first().waitFor();
 await frame.locator('#layout').selectOption('right');await frame.locator('#focus-editor').waitFor({state:'visible'});
 await capture('review-comments');
 await frame.locator('#layout').selectOption('sideBySide');
 await frame.locator('#top-toggle').click();await frame.locator('#mode').selectOption('gitRevisions');
 await frame.locator('#repo').fill(ready.repo);await frame.locator('#git-file').fill('src/api/products.ts');
 await frame.locator('#left-ref').fill('v1.0');await frame.locator('#right-ref').fill('v1.1');
 await frame.locator('#refresh-versions').click();await until(async()=>(await frame.locator('#left-version optgroup').count())>1);
 await frame.locator('#compare').click();await frame.locator('#top-panel').waitFor({state:'hidden'});
 await until(async()=>(await frame.locator('#right-info').textContent()).includes('Read only'));
 await frame.locator('#top-toggle').click();await capture('git-revisions');
 await frame.locator('#top-toggle').click();await action('archive');
 const picker=page.locator('.quick-input-widget');await picker.waitFor({state:'visible'});await picker.locator('input').first().fill('Review bundled snapshots');await page.keyboard.press('Enter');
 await until(async()=>(await frame.locator('#right-info').textContent()).includes('Archived snapshot'));
 await frame.locator('#files-tab').click();await frame.locator('#layout').selectOption('right');
 await frame.locator('#focus-editor .comment-reply').waitFor();await capture('portable-session');
 if(errors.length)throw new Error(errors.join('\n'));
 await fs.writeFile('artifacts/marketplace-screenshots.json',JSON.stringify({passed:true,screenshots:['agent-project','review-comments','git-revisions','portable-session'],pageErrors:errors},null,2));
}finally{
 await fs.writeFile(path.join(dir,'action.json'),JSON.stringify({type:'finish'}));await sleep(800);
 if(browser)await browser.close();child.kill();await log.close();
}
