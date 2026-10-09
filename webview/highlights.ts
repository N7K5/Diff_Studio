import * as monaco from 'monaco-editor';
import type {HighlightSet,HighlightRange,Session} from '../src/types';

export class HighlightUI {
 private sets:HighlightSet[]=[];
 private selected?:string;
 private signature='';
 private styles=document.createElement('style');
 private decorations=new Map<monaco.editor.ITextModel,string[]>();
 private collapsed=new Set<string>();
 constructor(private session:()=>Session|undefined,private models:()=>{original:monaco.editor.ITextModel;modified:monaco.editor.ITextModel}|undefined,private send:(message:object)=>void){document.head.append(this.styles);}
 update(sets:HighlightSet[],sessions:{id:string;title:string;detail:string}[]){
  const changed=JSON.stringify(this.sets)!==JSON.stringify(sets);this.sets=sets;const signature=JSON.stringify([sets,sessions]);
  if(signature!==this.signature){
   this.signature=signature;
   const list=document.getElementById('highlights-list')!;list.replaceChildren();document.getElementById('highlights-section')!.hidden=!sets.length;
   document.getElementById('highlight-count')!.textContent=String(sets.reduce((n,s)=>n+s.ranges.length,0));
   for(const set of sets){
    const group=document.createElement('details');group.className='highlight-group';group.open=!this.collapsed.has(set.id);group.style.setProperty('--highlight-color',set.color);
    const summary=document.createElement('summary');summary.title=set.label;summary.textContent=`${set.label} · ${set.ranges.length} ranges · ${new Set(set.ranges.map(r=>r.sessionId)).size} files`;
    group.addEventListener('toggle',()=>{if(group.open)this.collapsed.delete(set.id);else this.collapsed.add(set.id);});group.append(summary);
    for(const sessionId of new Set(set.ranges.map(r=>r.sessionId))){
     const session=sessions.find(s=>s.id===sessionId);const file=document.createElement('div');file.className='highlight-file';file.textContent=session?.title||'Comparison';file.title=session?.detail||file.textContent;group.append(file);
     for(const range of set.ranges.filter(r=>r.sessionId===sessionId)){
      const button=document.createElement('button');button.className='highlight-item';button.dataset.highlightSet=set.id;button.dataset.highlightRange=range.id;button.style.setProperty('--highlight-color',range.color||set.color);
      const location=`${range.side==='left'?'Left':'Right'} ${range.startLine}–${range.endLine}`;
      button.textContent=`${location}${range.label?' · '+range.label:''}${range.commentId?' · 💬':''}${range.outdated?' · Changed since highlight':''}`;
      button.title=`${set.label}\n${session?.title||''}\n${session?.detail||''}\n${location}${range.label?' · '+range.label:''}${range.outdated?'\nRange was edited; verify its current position.':''}`;
      button.onclick=()=>this.send({type:'highlightSelect',id:set.id,rangeId:range.id});group.append(button);
     }
    }
    const remove=document.createElement('button');remove.className='highlight-remove';remove.textContent='Remove highlights';remove.title='Remove this highlight group; comment threads are kept';remove.onclick=()=>this.send({type:'highlightRemove',id:set.id});group.append(remove);list.append(group);
   }
  }
  this.render();return changed;
 }
 select(id:string,rangeId:string){const range=this.sets.find(s=>s.id===id)?.ranges.find(r=>r.id===rangeId);if(range){this.selected=range.id;this.render();}return range;}
 commentStyle(side:'left'|'right',line:number,commentId:string){
  const session=this.session();if(!session)return;
  for(const set of this.sets)for(const range of set.ranges)if(range.sessionId===session.id&&range.side===side&&(range.commentId===commentId||(!range.outdated&&line>=range.startLine&&line<=range.endLine)))return {color:range.color||set.color,label:set.label};
 }
 clear(){for(const [model,ids] of this.decorations)if(!model.isDisposed())model.deltaDecorations(ids,[]);this.decorations.clear();}
 render(){
  this.clear();const session=this.session(),models=this.models();if(!session||!models)return;
  const ranges=this.sets.flatMap(set=>set.ranges.filter(r=>r.sessionId===session.id).map(range=>({set,range}))).sort((a,b)=>Number(a.range.id===this.selected)-Number(b.range.id===this.selected));
  const colors=[...new Set(ranges.map(({set,range})=>range.color||set.color))];
  this.styles.textContent=colors.map(color=>`.agent-highlight-${color.slice(1)}{background-color:${color}30;border-left:3px solid ${color}}.agent-highlight-gutter-${color.slice(1)}{border-left:4px solid ${color};margin-left:3px}`).join('\n');
  for(const side of ['left','right'] as const){
   const model=side==='left'?models.original:models.modified;
   const decorations=ranges.filter(r=>r.range.side===side).map(({set,range}):monaco.editor.IModelDeltaDecoration=>{
    const color=range.color||set.color;const start=Math.min(range.startLine,model.getLineCount()),end=Math.min(range.endLine,model.getLineCount());
    const text=`${set.label}${range.label?' · '+range.label:''}${range.outdated?' · Changed since highlight':''}`.replace(/[\\`*_{}\[\]()<>#+.!|-]/g,'\\$&');
    return {range:new monaco.Range(start,1,end,model.getLineMaxColumn(end)),options:{isWholeLine:true,className:`agent-highlight-${color.slice(1)}`,linesDecorationsClassName:`agent-highlight-gutter-${color.slice(1)}`,hoverMessage:{value:text,isTrusted:false},overviewRuler:{color,position:monaco.editor.OverviewRulerLane.Center},stickiness:monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}};
   });
   this.decorations.set(model,model.deltaDecorations([],decorations));
  }
  for(const button of Array.from(document.querySelectorAll<HTMLElement>('[data-highlight-range]')))button.setAttribute('aria-current',String(button.dataset.highlightRange===this.selected&&ranges.some(r=>r.range.id===this.selected)));
 }
}
