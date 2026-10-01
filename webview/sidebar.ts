import type {Settings} from '../src/types';

/** Pointer hover must not be held open by the focus left behind after a click. */
export class Sidebar {
 private keyboard=false;
 private drag?:{pointer:number;startX:number;startWidth:number;width:number};
 constructor(private rail:HTMLElement,private handle:HTMLElement,private resizer:HTMLElement,
  private settings:()=>Settings,private save:(key:'sidebarAutoHide'|'sidebarWidth',value:boolean|number)=>void){
  handle.addEventListener('click',()=>save('sidebarAutoHide',!settings().sidebarAutoHide));
  document.addEventListener('keydown',event=>{
   if(['Shift','Control','Meta','Alt'].includes(event.key))return;
   this.keyboard=true;this.focusChanged();
  });
  document.addEventListener('pointerdown',()=>{this.keyboard=false;this.focusChanged();},true);
  rail.addEventListener('focusin',()=>this.focusChanged());
  rail.addEventListener('focusout',()=>queueMicrotask(()=>this.focusChanged()));
  rail.addEventListener('pointerleave',()=>{this.keyboard=false;this.focusChanged();});
  resizer.addEventListener('pointerdown',event=>{
   if(event.button!==0)return;
   event.preventDefault();
   const width=this.width(settings().sidebarWidth);
   this.drag={pointer:event.pointerId,startX:event.clientX,startWidth:width,width};
   resizer.setPointerCapture(event.pointerId);
   rail.classList.add('resizing');document.body.classList.add('sidebar-resizing');
  });
  resizer.addEventListener('pointermove',event=>{
   if(this.drag?.pointer!==event.pointerId)return;
   this.drag.width=this.width(this.drag.startWidth+event.clientX-this.drag.startX);
   this.renderWidth(this.drag.width);
  });
  resizer.addEventListener('pointerup',event=>{if(this.drag?.pointer===event.pointerId)this.endDrag(true);});
  resizer.addEventListener('pointercancel',()=>this.endDrag(false));
  resizer.addEventListener('lostpointercapture',()=>this.endDrag(false));
  window.addEventListener('blur',()=>{this.endDrag(false);this.keyboard=false;this.focusChanged();});
  resizer.addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();
   const width=event.key==='Home'?160:event.key==='End'?800:this.width(settings().sidebarWidth)+(event.key==='ArrowLeft'?-1:1)*(event.shiftKey?50:10);
   save('sidebarWidth',this.width(width));
  });
  new ResizeObserver(()=>this.update()).observe(rail.parentElement!);
 }
 private focusChanged(){this.rail.classList.toggle('keyboard-focus',this.keyboard&&this.rail.contains(document.activeElement));}
 private maximum(){return Math.max(160,Math.min(800,this.rail.parentElement!.clientWidth-160));}
 private width(value:number){return Math.round(Math.max(160,Math.min(this.maximum(),value)));}
 private renderWidth(value:number){
  this.rail.style.setProperty('--sidebar-width',`${value}px`);
  this.resizer.setAttribute('aria-valuenow',String(value));
  this.resizer.setAttribute('aria-valuemax',String(this.maximum()));
 }
 private endDrag(commit:boolean){
  const drag=this.drag;if(!drag)return;this.drag=undefined;
  if(this.resizer.hasPointerCapture(drag.pointer))this.resizer.releasePointerCapture(drag.pointer);
  this.rail.classList.remove('resizing');document.body.classList.remove('sidebar-resizing');
  if(commit)this.save('sidebarWidth',drag.width);else this.update();
 }
 update(){
  const config=this.settings();
  document.body.classList.toggle('sidebar-auto-hide',config.sidebarAutoHide);
  this.handle.setAttribute('aria-pressed',String(config.sidebarAutoHide));
  this.handle.title=config.sidebarAutoHide?'Disable auto-hide and keep file list open':'Enable sidebar auto-hide';
  this.renderWidth(this.drag?.width??this.width(config.sidebarWidth));
 }
}
