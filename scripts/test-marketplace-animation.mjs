import {promises as fs} from 'node:fs';
import {performance} from 'node:perf_hooks';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function captureWalkthrough(page,frame,ready){
 const output='artifacts/walkthrough-frames';await fs.rm(output,{recursive:true,force:true});await fs.mkdir(output,{recursive:true});
 await page.setViewportSize({width:1480,height:960});
 if(!(await frame.locator('#top-panel').isVisible()))await frame.locator('#top-toggle').click();
 await frame.locator('#mode').selectOption('directories');
 await frame.locator('#left-path').fill(ready.before);await frame.locator('#right-path').fill(ready.after);
 await frame.locator('#bottom-toggle').click();
 // The cursor marker is a recording aid only. All controls and actions are real.
 await frame.evaluate(()=>{
  const pointer=document.createElement('div');pointer.id='recording-pointer';
  pointer.style.cssText='position:fixed;left:0;top:0;width:18px;height:18px;border:2px solid #74c7ff;border-radius:50%;background:#74c7ff35;box-shadow:0 0 0 4px #74c7ff18;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);display:none';
  document.body.append(pointer);document.addEventListener('mousemove',event=>{pointer.style.display='block';pointer.style.left=event.clientX+'px';pointer.style.top=event.clientY+'px';});
 });
 let index=0,mouseX=400,mouseY=200;const frames=[];
 const snapshot=async()=>{const file=`${output}/${String(index++).padStart(4,'0')}.png`;await frame.locator('body').screenshot({path:file});frames.push({file,time:performance.now()});};
 const hold=async ms=>{const end=performance.now()+ms;do{const start=performance.now();await snapshot();await sleep(Math.max(0,125-(performance.now()-start)));}while(performance.now()<end);};
 // Serialize capture and clicks so screenshots cannot scroll during input dispatch.
 const move=async locator=>{const box=await locator.boundingBox();if(!box)throw new Error('Target hidden');const handle=await locator.getAttribute('id')==='sidebar-handle',x=box.x+box.width/2,y=box.y+(handle?14:box.height/2);for(let i=1;i<=4;i++){await page.mouse.move(mouseX+(x-mouseX)*i/4,mouseY+(y-mouseY)*i/4);await snapshot();}mouseX=x;mouseY=y;await hold(200);};
 const click=async locator=>{await move(locator);if(await locator.getAttribute('id')==='sidebar-handle')await locator.click({position:{x:12,y:14}});else await locator.click();};
 try{
  await move(frame.locator('#compare'));await hold(1500);
  await click(frame.locator('#compare'));await frame.locator('#top-panel').waitFor({state:'hidden'});
  await click(frame.locator('[data-path="config/app.json"]'));await hold(1700);
  await click(frame.locator('[data-path="src/api/products.ts"]'));await hold(1900);
  await click(frame.locator('#top-toggle'));await frame.locator('#top-panel').waitFor({state:'visible'});await hold(1400);
  await click(frame.locator('#top-toggle'));await frame.locator('#top-panel').waitFor({state:'hidden'});await hold(1200);
  await click(frame.locator('#sidebar-handle'));await move(frame.locator('#layout'));
  await frame.locator('#sidebar').waitFor({state:'hidden'});await hold(1600);
  await move(frame.locator('#sidebar-handle'));await frame.locator('#sidebar').waitFor({state:'visible'});await hold(1000);
  await click(frame.locator('[data-path="src/ui/catalog.ts"]'));await hold(1100);
  await move(frame.locator('#layout'));await frame.locator('#sidebar').waitFor({state:'hidden'});await hold(1400);
  await move(frame.locator('#sidebar-handle'));await frame.locator('#sidebar').waitFor({state:'visible'});await hold(800);
  await click(frame.locator('#sidebar-handle'));await move(frame.locator('#layout'));await hold(1800);
  if(!(await frame.locator('#sidebar').isVisible()))throw new Error('Sidebar did not pin');
 }finally{await frame.locator('#recording-pointer').evaluate(el=>el.remove());}
 await fs.writeFile(`${output}/frames.json`,JSON.stringify(frames));
 console.log(`Captured ${frames.length} frames of folder comparison, setup collapse, file navigation, sidebar auto-hide, hover reveal and pinning.`);
}
