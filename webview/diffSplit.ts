import type * as monaco from 'monaco-editor';

/** Own the split through Monaco's public ratio option, including after dragging. */
export class DiffSplit {
 private ratio=.5;
 private previous=.5;
 private collapsed?:'left'|'right';
 private drag?:{pointer:number;startX:number;ratio:number;width:number};
 private frame=0;
 private visible=false;
 constructor(private editor:monaco.editor.IStandaloneDiffEditor,private wrap:HTMLElement,private divider:HTMLElement,private left:HTMLButtonElement,private right:HTMLButtonElement,private heads:HTMLElement){
  for(const [button,side] of [[left,'left'],[right,'right']] as const){
   button.addEventListener('pointerdown',event=>event.stopPropagation());
   button.addEventListener('keydown',event=>event.stopPropagation());
   button.addEventListener('dblclick',event=>event.stopPropagation());
   button.addEventListener('click',()=>{if(this.collapsed===side){this.collapsed=undefined;this.set(this.previous);}else{if(!this.collapsed&&this.ratio>.1&&this.ratio<.9)this.previous=this.ratio;this.collapsed=side;this.set(side==='left'?.1:.9);}});
  }
  divider.addEventListener('pointerdown',event=>{
   if(event.button!==0)return;event.preventDefault();this.collapsed=undefined;
   this.drag={pointer:event.pointerId,startX:event.clientX,ratio:this.ratio,width:wrap.clientWidth};divider.setPointerCapture(event.pointerId);divider.focus();document.body.classList.add('diff-resizing');
  });
  divider.addEventListener('pointermove',event=>{if(this.drag?.pointer===event.pointerId)this.set(this.drag.ratio+(event.clientX-this.drag.startX)/Math.max(1,this.drag.width));});
  divider.addEventListener('pointerup',()=>this.endDrag());divider.addEventListener('pointercancel',()=>this.endDrag());divider.addEventListener('lostpointercapture',()=>this.endDrag());window.addEventListener('blur',()=>this.endDrag());
  divider.addEventListener('dblclick',()=>this.reset());
  divider.addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(event.key))return;event.preventDefault();this.collapsed=undefined;
   this.set(event.key==='Home'?.1:event.key==='End'?.9:event.key==='Enter'?.5:this.ratio+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?.1:.02));
  });
  editor.getOriginalEditor().onDidLayoutChange(()=>this.schedule());editor.getModifiedEditor().onDidLayoutChange(()=>this.schedule());new ResizeObserver(()=>this.schedule()).observe(wrap);
 }
 private endDrag(){const drag=this.drag;this.drag=undefined;document.body.classList.remove('diff-resizing');if(drag&&this.divider.hasPointerCapture(drag.pointer))this.divider.releasePointerCapture(drag.pointer);}
 private set(ratio:number){this.ratio=Math.max(.1,Math.min(.9,ratio));this.editor.updateOptions({splitViewDefaultRatio:this.ratio});this.schedule();}
 reset(){this.endDrag();this.previous=.5;this.collapsed=undefined;this.set(.5);}
 update(layout:string){this.visible=layout==='sideBySide';this.divider.hidden=!this.visible;this.heads.classList.toggle('split-sized',this.visible);if(!this.visible)this.endDrag();this.schedule();}
 private schedule(){cancelAnimationFrame(this.frame);this.frame=requestAnimationFrame(()=>this.render());}
 private render(){
  const modified=this.editor.getModifiedEditor().getDomNode();if(!this.visible||!modified||!this.wrap.clientWidth)return;
  const boundary=modified.getBoundingClientRect().left-this.wrap.getBoundingClientRect().left;
  this.divider.style.left=`${boundary}px`;this.heads.style.setProperty('--diff-left-width',`${boundary}px`);
  this.heads.querySelector('#left-head')?.classList.toggle('pane-peek',boundary<180);this.heads.querySelector('#right-head')?.classList.toggle('pane-peek',this.wrap.clientWidth-boundary<180);
  this.divider.setAttribute('aria-valuenow',String(Math.round(this.ratio*100)));this.divider.setAttribute('aria-valuetext',`${Math.round(this.ratio*100)}% left, ${Math.round((1-this.ratio)*100)}% right`);
  for(const [button,side] of [[this.left,'left'],[this.right,'right']] as const){const restore=this.collapsed===side;button.setAttribute('aria-pressed',String(restore));button.setAttribute('aria-label',restore?'Restore previous split':`Shrink ${side} pane`);button.title=restore?'Restore previous split':`Shrink ${side} pane to focus on ${side==='left'?'right':'left'}`;button.textContent=restore?'↔':side==='left'?'‹':'›';}
 }
}
