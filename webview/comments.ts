import * as monaco from 'monaco-editor';
import type {Session,LineComment} from '../src/types';
type Side='left'|'right';
type Editor=monaco.editor.IStandaloneCodeEditor;
export class CommentUI {
  private draft?:{side:Side;line:number;body:string;commentId?:string;replyTo?:string};
  private zones=new Map<Editor,string[]>();
  private signature='';
  constructor(private editors:{editor:Editor;side:()=>Side;visible:()=>boolean;includeLeft?:()=>boolean;mapLine?:(side:Side,line:number)=>number}[],private session:()=>Session|undefined,private send:(message:object)=>void,private highlight:(side:Side,line:number,id:string)=>{color:string;label:string}|undefined=()=>undefined){
    for(const {editor,side} of editors){
      editor.updateOptions({glyphMargin:true});
      const hover=editor.createDecorationsCollection();
      editor.onMouseMove(event=>{const line=event.target.position?.lineNumber;if(line)hover.set([{range:new monaco.Range(line,1,line,1),options:{glyphMarginClassName:'comment-add-glyph',glyphMarginHoverMessage:{value:'Add a line comment'},stickiness:monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges}}]);else hover.clear();});
      editor.onMouseLeave(()=>hover.clear());
      editor.onMouseDown(event=>{if([monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN,monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS].includes(event.target.type)&&event.target.position){this.start(side(),event.target.position.lineNumber);}});
      editor.addAction({id:`diffStudio.comment.${editors.indexOf(editors.find(e=>e.editor===editor)!)}`,label:'Add comment to line',contextMenuGroupId:'navigation',contextMenuOrder:1.5,keybindings:[monaco.KeyMod.CtrlCmd|monaco.KeyMod.Alt|monaco.KeyCode.KeyM],run:()=>this.start(side(),editor.getPosition()?.lineNumber||1)});
    }
  }
  start(side:Side,line:number,comment?:LineComment){
    if(!this.session())return;this.draft={side,line,body:comment?.body||'',commentId:comment?.id};this.render(true);for(const e of this.editors)if(e.visible()&&e.side()===side)e.editor.revealLineInCenter(line);
    requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.comment-composer textarea')?.focus());
  }
  clear(){this.draft=undefined;this.signature='';for(const {editor} of this.editors)editor.changeViewZones(accessor=>{for(const id of this.zones.get(editor)||[])accessor.removeZone(id);});this.zones.clear();}
  render(force=false){
    const session=this.session();if(!session)return;
    if(this.signature&&!this.signature.startsWith(session.id+'|'))this.draft=undefined;
    const signature=session.id+'|'+JSON.stringify([session.comments,this.editors.map(e=>[e.visible(),e.side(),e.editor.getModel()?.id,e.includeLeft?.(),session.comments.map(c=>e.mapLine?.(c.side,c.line))]),this.draft&&[this.draft.side,this.draft.line,this.draft.commentId,this.draft.replyTo]]);
    if(!force&&signature===this.signature)return;this.signature=signature;
    for(const {editor,side,visible,includeLeft,mapLine} of this.editors){
      // Monaco hides ordinary view zones from accessibility; our zones contain review controls.
      editor.getDomNode()?.querySelector('.view-zones')?.removeAttribute('aria-hidden');
      editor.changeViewZones(accessor=>{
        for(const id of this.zones.get(editor)||[])accessor.removeZone(id);const ids:string[]=[];this.zones.set(editor,ids);
        if(!visible()||!editor.getModel())return;
        for(const selectedSide of (includeLeft?.()?['left','right']:[side()]) as Side[]){const comments=session.comments.filter(c=>c.side===selectedSide);const lineNumbers=new Set(comments.map(c=>c.line));if(this.draft?.side===selectedSide)lineNumbers.add(this.draft.line);
        for(const line of [...lineNumbers].sort((a,b)=>a-b)){
          const container=document.createElement('div');container.className=`line-comments comments-${selectedSide}`;container.dataset.side=selectedSide;container.dataset.line=String(line);container.setAttribute('aria-label',`${selectedSide} line ${line} comments`);
          for(const comment of comments.filter(c=>c.line===line)){
            const card=document.createElement('article');card.className='line-comment'+(comment.resolved?' resolved':'');card.dataset.commentId=comment.id;
            const highlight=this.highlight(selectedSide,line,comment.id);if(highlight){card.style.borderLeft=`4px solid ${highlight.color}`;card.style.backgroundColor=`${highlight.color}18`;card.dataset.highlightColor=highlight.color;}
            const header=document.createElement('div');header.className='comment-header';const label=document.createElement('strong');label.textContent=`${selectedSide==='left'?'Left':'Right'} · line ${line}${comment.outdated?' · original line changed':''}${comment.resolved?' · Resolved':''}${comment.author==='agent'?' · Agent':''}${highlight?' · '+highlight.label:''}`;
            const edit=document.createElement('button');edit.textContent='Edit';edit.onclick=()=>this.start(selectedSide,line,comment);const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label','Delete comment');remove.onclick=()=>this.send({type:'commentRemove',id:session.id,commentId:comment.id});const reply=document.createElement('button');reply.textContent='Reply';reply.onclick=()=>{this.draft={side:selectedSide,line,body:'',replyTo:comment.id};this.render(true);requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.comment-input')?.focus());};
            const resolve=document.createElement('button');resolve.textContent=comment.resolved?'Reopen':'Resolve';resolve.onclick=()=>this.send({type:'commentResolve',id:session.id,commentId:comment.id,resolved:!comment.resolved});header.append(label,reply,resolve,edit,remove);
            const body=document.createElement('div');body.className='comment-body';body.textContent=comment.body;card.append(header,body);for(const reply of comment.replies||[]){const row=document.createElement('div');row.className='comment-reply';const author=document.createElement('strong');author.textContent=reply.author==='agent'?'Agent':'You';const text=document.createElement('span');text.textContent=reply.body;row.append(author,text);card.append(row);}
            if(comment.outdated){const anchor=document.createElement('small');anchor.textContent=`Originally: ${comment.anchor}`;card.append(anchor);}container.append(card);
          }
          const draft=this.draft;
          if(draft?.side===selectedSide&&draft.line===line){
            const form=document.createElement('form');form.className='comment-composer';const label=document.createElement('label');label.textContent=`${draft.replyTo?'Reply to':draft.commentId?'Edit':'Add'} comment · ${selectedSide} line ${line}`;const input=document.createElement('textarea');input.className='comment-input';input.setAttribute('aria-label',label.textContent);input.maxLength=10000;input.rows=3;input.value=draft.body;input.oninput=()=>{draft.body=input.value;};
            const controls=document.createElement('div');const submit=document.createElement('button');submit.type='submit';submit.className='comment-submit';submit.textContent=draft.replyTo?'Send reply':draft.commentId?'Update comment':'Add comment';const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.onclick=()=>{this.draft=undefined;this.render(true);};controls.append(submit,cancel);form.append(label,input,controls);
            form.onsubmit=event=>{event.preventDefault();if(!input.value.trim()){input.focus();return;}if(draft.replyTo)this.send({type:'commentReply',id:session.id,commentId:draft.replyTo,body:input.value});else this.send({type:'comment',id:session.id,side:selectedSide,line,body:input.value,commentId:draft.commentId});this.draft=undefined;this.render(true);};
            input.onkeydown=event=>{event.stopPropagation();if(event.key==='Escape'){this.draft=undefined;this.render(true);}else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey))form.requestSubmit();};container.append(form);
          }
          // Bounded cards scroll internally so long comments never obscure the whole file.
          const height=comments.filter(c=>c.line===line).reduce((sum,c)=>sum+Math.min(155,85+c.body.split('\n').length*18+(c.replies?.length||0)*50),0)+(draft?.side===selectedSide&&draft.line===line?150:0)+12;
          ids.push(accessor.addZone({afterLineNumber:Math.max(0,Math.min(mapLine?.(selectedSide,line)??line,editor.getModel()!.getLineCount())),heightInPx:height,domNode:container,suppressMouseDown:false,showInHiddenAreas:true}));
        }
        }
      });
    }
  }
}
