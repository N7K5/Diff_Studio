/** Consistent full-label hints for the Studio chrome; Monaco owns editor hovers. */
export function installTooltips(){
 const tip=document.createElement('div');tip.id='studio-tooltip';tip.role='tooltip';tip.hidden=true;document.body.append(tip);
 let target:HTMLElement|undefined,timer:ReturnType<typeof setTimeout>|undefined,title:string|null=null,description:string|null=null;
 function hide(){
  clearTimeout(timer);tip.hidden=true;
  if(target){if(title!==null&&!target.hasAttribute('title'))target.title=title;if(description===null)target.removeAttribute('aria-describedby');else target.setAttribute('aria-describedby',description);}
  target=undefined;title=null;description=null;
 }
 function showFor(element:HTMLElement){
  if(target===element)return;hide();target=element;title=element.getAttribute('title');description=element.getAttribute('aria-describedby');
  const text=title||(element instanceof HTMLSelectElement?element.selectedOptions[0]?.textContent:element instanceof HTMLInputElement?element.value||element.getAttribute('aria-label'):element.textContent)?.trim();
  // Suppress the browser's variable-delay native tooltip while this hint owns hover.
  element.removeAttribute('title');
  if(!text)return;
  timer=setTimeout(()=>{
   if(!element.isConnected||!element.getClientRects().length){hide();return;}
   tip.textContent=text;tip.hidden=false;tip.style.left='8px';tip.style.top='8px';
   const anchor=element.getBoundingClientRect(),bounds=tip.getBoundingClientRect();
   tip.style.left=`${Math.max(8,Math.min(anchor.left,innerWidth-bounds.width-8))}px`;
   tip.style.top=`${Math.max(8,anchor.bottom+bounds.height+8<innerHeight?anchor.bottom+6:anchor.top-bounds.height-6)}px`;
   element.setAttribute('aria-describedby',[description,tip.id].filter(Boolean).join(' '));
  },500);
 }
 const candidate=(event:Event)=>{
  const element=event.target as Element;
  if(!(element instanceof Element)||element.closest('.monaco-editor,#studio-tooltip'))return;
  return element.closest<HTMLElement>('[title],button,summary,select,input,.session-item,#title,#left-name,#right-name');
 };
 document.addEventListener('pointerover',event=>{const element=candidate(event);if(element)showFor(element);});
 document.addEventListener('pointerout',event=>{if(target&&target.contains(event.target as Node)&&!target.contains(event.relatedTarget as Node|null))hide();});
 document.addEventListener('focusin',event=>{const element=candidate(event);if(element)showFor(element);else hide();});
 document.addEventListener('focusout',event=>{if(target&&target.contains(event.target as Node))hide();});
 document.addEventListener('pointerdown',hide);
 document.addEventListener('keydown',hide);
 document.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);window.addEventListener('blur',hide);
}
