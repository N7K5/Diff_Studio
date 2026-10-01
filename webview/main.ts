import * as monaco from 'monaco-editor';
import type {Session, Settings, ChangeEntry, Revision, RevisionPage} from '../src/types';
import {defaults} from '../src/types';
import {CommentUI} from './comments';
import {Sidebar} from './sidebar';
import {changeTree, ChangeNode} from '../src/tree';
import type {ComparisonTarget} from '../src/recent';
declare function acquireVsCodeApi(): {postMessage(message:unknown):void; getState():any; setState(state:any):void};
const api=acquireVsCodeApi();
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const input=(id:string)=>$<HTMLInputElement>(id);
const value=(id:string)=>input(id).value;
const send=(message:object)=>api.postMessage(message);
const action=(id:string,fn:()=>void)=>$(id).addEventListener('click',fn);
let composerCollapsed=false;let copiedTimer:ReturnType<typeof setTimeout>|undefined;
let config:Settings={...defaults};let session:Session|undefined;let changes:ChangeEntry[]=[];
let models:{original:monaco.editor.ITextModel;modified:monaco.editor.ITextModel}|undefined;
let changing=false;let focused:'left'|'right'='right';let bridgePath:string|undefined;
let disposables:monaco.IDisposable[]=[];
let revisionRefs:Revision[]=[];let revisionCommits:Revision[]=[];let revisionRequest=0;let revisionTimer:ReturnType<typeof setTimeout>|undefined;let nextRevisionOffset=0;
const pendingSettings:Partial<Settings>={};
const workerUrls=new Map<string,string>();
(self as any).MonacoEnvironment={getWorker:async(_id:string,label:string)=>{
 const file=label==='json'?'json.worker.js':['typescript','javascript'].includes(label)?'ts.worker.js':'editor.worker.js';
 if(!workerUrls.has(file)){const response=await fetch(`${document.body.dataset.workerBase}/${file}`);if(!response.ok)throw new Error(`Worker failed: ${file}`);workerUrls.set(file,URL.createObjectURL(new Blob([await response.text()],{type:'text/javascript'})));}
 return new Worker(workerUrls.get(file)!);
}};
function theme(){const light=document.body.classList.contains('vscode-light');const high=document.body.classList.contains('vscode-high-contrast');monaco.editor.setTheme(high?'hc-black':light?'vs':'vs-dark');}
theme();new MutationObserver(theme).observe(document.body,{attributes:true,attributeFilter:['class']});
const editor=monaco.editor.createDiffEditor($('diff-editor'),{automaticLayout:true,originalEditable:true,readOnly:false,renderSideBySide:true,useInlineViewWhenSpaceIsLimited:false,enableSplitViewResizing:true,minimap:{enabled:false},scrollBeyondLastLine:false,fontSize:13,ignoreTrimWhitespace:false,renderMarginRevertIcon:true,accessibilityVerbose:true});
const focusEditor=monaco.editor.create($('focus-editor'),{automaticLayout:true,minimap:{enabled:false},scrollBeyondLastLine:false});
const commentUI=new CommentUI([{editor:editor.getOriginalEditor(),side:()=> 'left',visible:()=>!$('diff-editor').hidden&&value('layout')!=='inline'},{editor:editor.getModifiedEditor(),side:()=> 'right',visible:()=>!$('diff-editor').hidden,includeLeft:()=>value('layout')==='inline',mapLine:(side,line)=>{if(side==='right'||value('layout')!=='inline')return line;let delta=0;for(const change of editor.getLineChanges()||[]){if(line<change.originalStartLineNumber)break;if(change.originalEndLineNumber&&line<=change.originalEndLineNumber)return change.modifiedEndLineNumber?change.modifiedStartLineNumber+Math.min(line-change.originalStartLineNumber,change.modifiedEndLineNumber-change.modifiedStartLineNumber):change.modifiedStartLineNumber;const oldLength=change.originalEndLineNumber?change.originalEndLineNumber-change.originalStartLineNumber+1:0;const newLength=change.modifiedEndLineNumber?change.modifiedEndLineNumber-change.modifiedStartLineNumber+1:0;delta+=newLength-oldLength;}return line+delta;}},{editor:focusEditor,side:()=>value('layout')==='left'?'left':'right',visible:()=>!$('focus-editor').hidden}],()=>session,send);
for(const l of monaco.languages.getLanguages().sort((a,b)=>a.id.localeCompare(b.id))){const option=document.createElement('option');option.value=l.id;option.textContent=l.aliases?.[0]||l.id;$('language').append(option);}
function showMessage(text:string,error=false){$('message').textContent=text;$('message').hidden=!text;$('message').classList.toggle('error',error);}
const sidebar=new Sidebar($('sidebar-rail'),$('sidebar-handle'),$('sidebar-resizer'),()=>config,(key,value)=>changeSetting(key,value));
function applySettings(){
 editor.updateOptions({fontSize:config.fontSize,ignoreTrimWhitespace:config.ignoreWhitespace,wordWrap:config.wordWrap?'on':'off',diffWordWrap:config.wordWrap?'on':'off',hideUnchangedRegions:{enabled:config.hideUnchanged},maxFileSize:config.maxFileMB});
 focusEditor.updateOptions({fontSize:config.fontSize,wordWrap:config.wordWrap?'on':'off'});
 for(const [key,v] of Object.entries(config)){const el=input(`setting-${key}`);if(el===document.activeElement)continue;if(typeof v==='boolean')el.checked=v;else el.value=String(v);}
 applyPanelVisibility();
}
function applyPanelVisibility(){
 const showComposer=config.showTopBar&&!composerCollapsed;
 $('top-panel').hidden=!showComposer;$('activity').hidden=!config.showBottomBar;document.querySelector<HTMLElement>('.editor-footer')!.hidden=!config.showBottomBar;
 $('top-toggle').textContent=showComposer?'Collapse comparison setup':'Choose files / revisions';$('top-toggle').setAttribute('aria-expanded',String(showComposer));
 $('bottom-toggle').textContent=config.showBottomBar?'Hide bottom bar':'Show bottom bar';$('bottom-toggle').setAttribute('aria-expanded',String(config.showBottomBar));
 sidebar.update();
 requestAnimationFrame(()=>{editor.layout();focusEditor.layout();});
}
function changeSetting(key:keyof Settings,v:Settings[keyof Settings]){if(key==='showTopBar')composerCollapsed=false;const field=input(`setting-${key}`);if(typeof v==='number'&&!field.checkValidity()){field.reportValidity();return;}(pendingSettings as any)[key]=v;(config as any)[key]=v;applySettings();send({type:'settings',key,value:v});}
action('top-toggle',()=>changeSetting('showTopBar',$('top-panel').hidden));action('bottom-toggle',()=>changeSetting('showBottomBar',!config.showBottomBar));
function applyLayout(){
 const layout=value('layout');const single=layout==='left'||layout==='right';
 $('diff-editor').hidden=single;$('focus-editor').hidden=!single;
 $('left-head').hidden=layout==='right';$('right-head').hidden=layout==='left';
 if(single&&session&&models){focused=layout;focusEditor.setModel(layout==='left'?models.original:models.modified);focusEditor.updateOptions({readOnly:!session[layout].writable});focusEditor.layout();}
 else {editor.updateOptions({renderSideBySide:layout!=='inline'});editor.layout();}
 commentUI.render();
}
function metadata(){
 if(!session||!models)return;
 for(const side of ['left','right'] as const){const d=session[side];const model=side==='left'?models.original:models.modified;d.text=model.getValue(undefined,true);d.dirty=!d.archived&&d.text!==d.savedText;
  $(`${side}-name`).textContent=d.label;$(`${side}-name`).title=d.label;
  $(`${side}-info`).textContent=`${d.archived?'Archived snapshot':d.writable?'Editable':'Read only'} · ${d.exists?'':'Missing · '}${model.getLineCount()} lines · ${new TextEncoder().encode(d.text).length.toLocaleString()} bytes${d.dirty?' · Unsaved':''}`;
  const button=$<HTMLButtonElement>(`save-${side}`);button.disabled=!d.writable||(!d.dirty&&d.exists);button.textContent=d.writable?`${d.exists?'Save':'Create'} ${side}${d.dirty?' •':''}`:'Read only';
 }
 $('save-state').textContent=session.left.dirty||session.right.dirty?'Unsaved file edits — Save session also captures them':session.archived?'Bundled review · Save session includes comments':'File changes saved · Save session includes comments';
 $('save-state').classList.toggle('unsaved',session.left.dirty||session.right.dirty);
}
function renderSession(next:Session,reason?:string){
 const isNew=next.id!==session?.id||reason==='swap';const previous=session;session=next;
 $('empty').hidden=true;$('comparison').hidden=false;$('title').textContent=next.title;
 changing=true;
 if(isNew||!models){
  for(const d of disposables)d.dispose();disposables=[];editor.setModel(null);focusEditor.setModel(null);models?.original.dispose();models?.modified.dispose();
  models={original:monaco.editor.createModel(next.left.text,next.left.language),modified:monaco.editor.createModel(next.right.text,next.right.language)};editor.setModel(models);
  for(const side of ['left','right'] as const){const model=side==='left'?models.original:models.modified;disposables.push(model.onDidChangeContent(()=>{if(changing||!session)return;metadata();send({type:'edit',id:session.id,side,text:model.getValue(undefined,true)});}));}
 }else {
  for(const side of ['left','right'] as const){const model=side==='left'?models.original:models.modified;const keep=reason==='activity'||reason==='save'||(reason==='external'&&model.getValue(undefined,true)!==previous?.[side].savedText);if(!keep&&model.getValue(undefined,true)!==next[side].text){model.pushEditOperations([],[{range:model.getFullModelRange(),text:next[side].text}],()=>null);}}
 }
 changing=false;editor.updateOptions({originalEditable:next.left.writable,readOnly:!next.right.writable});
 input('language').value=next.right.language;metadata();applyLayout();if(isNew)commentUI.render(true);renderActivity();for(const b of Array.from(document.querySelectorAll<HTMLElement>('#changes [data-session-id]')))b.setAttribute('aria-current',String(b.dataset.sessionId===session.id));
}
function renderActivity(){
 $('activity-list').replaceChildren();for(const item of session?.activity||[]){const li=document.createElement('li');const time=document.createElement('time');time.textContent=new Date(item.time).toLocaleTimeString();const text=document.createElement('span');text.textContent=item.message;li.append(time,text);li.className=item.kind;$('activity-list').append(li);}$('activity-list').scrollTop=$('activity-list').scrollHeight;
}
editor.getOriginalEditor().onDidFocusEditorText(()=>focused='left');editor.getModifiedEditor().onDidFocusEditorText(()=>focused='right');
function save(side:'left'|'right'){if(session?.[side].writable)send({type:'save',id:session.id,side});}
for(const ed of [editor.getOriginalEditor(),editor.getModifiedEditor(),focusEditor])ed.addCommand(monaco.KeyMod.CtrlCmd|monaco.KeyCode.KeyS,()=>save(focused));
editor.onDidUpdateDiff(()=>{if(changing)return;commentUI.render();const list=editor.getLineChanges()||[];let adds=0,removes=0;for(const c of list){if(c.modifiedEndLineNumber)adds+=c.modifiedEndLineNumber-c.modifiedStartLineNumber+1;if(c.originalEndLineNumber)removes+=c.originalEndLineNumber-c.originalStartLineNumber+1;}$('stats').textContent=`+${adds} −${removes} · ${list.length} change${list.length===1?'':'s'}`;});
function modeChanged(){
 const mode=value('mode');const git=mode.startsWith('git');$('file-fields').hidden=git;$('git-fields').hidden=!git;
 $('git-file-label').hidden=mode==='gitBase';$('right-ref-label').hidden=mode==='gitBase';$('right-ref').hidden=mode==='gitWorking';$('git-mode-label').hidden=mode!=='gitBase';$('merge-base-label').hidden=mode!=='gitBase';$('revision-tools').hidden=!git;
 $('mode-help').textContent=({files:'Local paths or ssh://user@host/path. Both files are editable.',directories:'Compare folder contents recursively. Select a changed file below.',gitWorking:'Choose a file or folder. Leave the path empty to review all repository changes.',gitRevisions:'Compare files or folders across branches, tags or commits. Leave the path empty for all changes.',gitBase:'Review added, removed, renamed, staged and untracked files.'} as Record<string,string>)[mode];
 if(mode==='gitBase'&&value('left-ref')==='HEAD')input('left-ref').value=config.baseBranch;
 if(mode==='gitWorking'&&!value('left-ref'))input('left-ref').value='HEAD';
 renderRevisionOptions();queueRevisions();
}
$('mode').addEventListener('change',modeChanged);
const formKeys=['mode','left-path','right-path','repo','git-file','left-ref','right-ref','git-mode','revision-order'];
for(const key of formKeys)$(key).addEventListener('change',()=>api.setState(Object.fromEntries(formKeys.map(k=>[k,value(k)]))));
const prior=api.getState();if(prior)for(const key of formKeys)if(prior[key])input(key).value=prior[key];modeChanged();
function busy(){showMessage('Loading comparison…');$<HTMLButtonElement>('compare').disabled=true;}
action('compare',()=>{
 const mode=value('mode');busy();
 if(mode==='files')send({collapseComposer:true,type:'open',request:{left:{kind:'file',uri:value('left-path')},right:{kind:'file',uri:value('right-path')}}});
 else if(mode==='directories')send({collapseComposer:true,type:'directories',left:value('left-path'),right:value('right-path')});
 else if(mode==='gitBase')send({collapseComposer:true,type:'gitChanges',repo:value('repo'),base:value('left-ref'),mode:value('git-mode'),mergeBase:input('merge-base').checked});
 else send({collapseComposer:true,type:'gitCompare',repo:value('repo'),path:value('git-file'),mode,leftRef:value('left-ref')||'HEAD',rightRef:value('right-ref')||'HEAD'});
});
for(const side of ['left','right']){action(`browse-${side}`,()=>send({type:'browse',field:`${side}-path`,location:value(`${side}-path`),directory:value('mode')==='directories'}));action(`connect-${side}`,()=>send({type:'connectRemote',field:`${side}-path`}));}
action('connect-repo',()=>send({type:'connectRemote',field:'repo'}));
const gitBrowse=(field:string,directory:boolean)=>send({type:'browse',field,directory,repo:value('repo'),mode:value('mode'),leftRef:value('left-ref'),rightRef:value('right-ref'),gitMode:value('git-mode'),mergeBase:input('merge-base').checked});
action('browse-repo',()=>gitBrowse('repo',true));action('browse-git-file',()=>gitBrowse('git-file',false));action('browse-git-folder',()=>gitBrowse('git-file',true));action('history',()=>send({type:'history',repo:value('repo'),path:value('git-file')}));
action('browse-repo-file',()=>send({type:'repoFile',repo:value('repo'),mode:value('mode'),leftRef:value('left-ref'),rightRef:value('right-ref')}));
function queueRevisions(){
 clearTimeout(revisionTimer);revisionRequest++; // Ignore replies for a previous repository or path.
 revisionTimer=setTimeout(()=>{if(value('mode').startsWith('git')&&value('repo').trim())loadRevisions();},300);
}
function loadRevisions(append=false){
 clearTimeout(revisionTimer);
 if(!value('repo').trim()){$('revision-info').textContent='Choose a repository to load versions.';return;}
 if(!append){revisionRefs=[];revisionCommits=[];nextRevisionOffset=0;renderRevisionOptions();}
 const requestId=++revisionRequest;$('revision-info').textContent='Loading Git versions…';$<HTMLButtonElement>('more-versions').disabled=true;
 send({type:'revisions',requestId,repo:value('repo'),path:value('mode')==='gitBase'?'':value('git-file'),offset:append?nextRevisionOffset:0});
}
function renderRevisionOptions(){
 const newest=value('revision-order')!=='oldest';const sorted=(items:Revision[])=>[...items].sort((a,b)=>(Date.parse(a.date)-Date.parse(b.date))*(newest?-1:1));
 const dateLabel=(date:string)=>{const d=new Date(date);return Number.isNaN(d.getTime())?'':d.toLocaleString(undefined,{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
 for(const side of ['left','right']){
  const select=$<HTMLSelectElement>(`${side}-version`);select.replaceChildren();
  const option=(parent:HTMLElement,text:string,ref:string)=>{const o=document.createElement('option');o.value=ref;o.textContent=text;parent.append(o);};
  option(select,'Browse versions…','');if(side==='right')option(select,'Working file · editable','WORKING');
  option(select,'HEAD · current commit','HEAD');if(value('mode')!=='gitBase')option(select,'INDEX · staged version','INDEX');
  for(const [kind,label] of [['branch','Branches'],['tag','Tags'],['commit','Commits · '+(newest?'newest first':'oldest first')]] as const){
   const revisions=sorted(kind==='commit'?revisionCommits:revisionRefs.filter(r=>r.kind===kind));if(!revisions.length)continue;
   const group=document.createElement('optgroup');group.label=label;
   for(const r of revisions){const name=kind==='commit'?r.ref.slice(0,8):r.ref.replace(/^refs\/(heads|remotes|tags)\//,'');option(group,`${dateLabel(r.date)} · ${name} · ${r.subject}${r.author?' · '+r.author:''}`,r.ref);}
   select.append(group);
  }
  const current=side==='right'&&value('mode')==='gitWorking'?'WORKING':value(`${side}-ref`);
  const match=Array.from(select.options).find(o=>o.value===current||o.value.replace(/^refs\/(heads|remotes|tags)\//,'')===current);select.value=match?.value||'';
 }
}
for(const side of ['left','right'])$(`${side}-version`).addEventListener('change',()=>{
 const ref=value(`${side}-version`);if(!ref)return;
 if(side==='right'&&ref==='WORKING'){input('mode').value='gitWorking';modeChanged();}
 else {input(`${side}-ref`).value=ref;if(side==='right'&&value('mode')==='gitWorking'){input('mode').value='gitRevisions';modeChanged();}}
 api.setState(Object.fromEntries(formKeys.map(k=>[k,value(k)])));
});
for(const key of ['repo','git-file'])$(key).addEventListener('change',queueRevisions);
for(const side of ['left','right'])$(`${side}-ref`).addEventListener('change',renderRevisionOptions);
$('revision-order').addEventListener('change',renderRevisionOptions);action('refresh-versions',()=>loadRevisions());action('more-versions',()=>loadRevisions(true));
function settingsOpen(open:boolean){$('settings').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));}
action('settings-toggle',()=>settingsOpen($('settings').hidden));action('settings-close',()=>settingsOpen(false));
action('settings-shortcut',()=>settingsOpen($('settings').hidden));
for(const [key,initial] of Object.entries(defaults))$(`setting-${key}`).addEventListener('change',()=>{const el=input(`setting-${key}`);const v=typeof initial==='boolean'?el.checked:typeof initial==='number'?Number(el.value):el.value;changeSetting(key as keyof Settings,v);});
$('layout').addEventListener('change',applyLayout);
action('save-left',()=>save('left'));action('save-right',()=>save('right'));
action('previous',()=>{if(value('layout')==='left'||value('layout')==='right'){input('layout').value='sideBySide';applyLayout();}editor.goToDiff('previous');});
action('next',()=>{if(value('layout')==='left'||value('layout')==='right'){input('layout').value='sideBySide';applyLayout();}editor.goToDiff('next');});
for(const type of ['swap','reload','native'])action(type,()=>{if(session)send({type,id:session.id});});
action('agent',()=>send({type:'agent'}));
action('copy-agent',()=>send({type:'copyAgentInstructions'}));
action('copy-review',()=>send({type:'copyReviewRequest'}));
$('follow-agent').addEventListener('change',()=>send({type:'agentFollow',value:input('follow-agent').checked}));
$('file-set').addEventListener('change',()=>send({type:'groupSelect',id:value('file-set')}));
action('add-comment',()=>{const ed=value('layout')==='left'||value('layout')==='right'?focusEditor:focused==='left'?editor.getOriginalEditor():editor.getModifiedEditor();commentUI.start(focused,ed.getPosition()?.lineNumber||1);});
for(const [button,type] of [['import-session','importSession'],['export-session','exportSession'],['link-repository','linkRepository']])action(button,()=>send({type}));
action('activity-toggle',()=>{const list=$('activity-list');list.hidden=!list.hidden;$('activity-toggle').textContent=list.hidden?'Expand':'Collapse';$('activity-toggle').setAttribute('aria-expanded',String(!list.hidden));});
$('language').addEventListener('change',()=>{if(models&&session){const language=value('language');monaco.editor.setModelLanguage(models.original,language);monaco.editor.setModelLanguage(models.modified,language);session.left.language=language;session.right.language=language;send({type:'language',id:session.id,language});}});
let activeSidebar:'files'|'history'|'review'='files';
function sidebarTab(tab:'files'|'history'|'review'){
 activeSidebar=tab;for(const name of ['files','history','review']){$(`${name}-panel`).hidden=name!==tab;const button=$(`${name}-tab`);button.setAttribute('aria-selected',String(name===tab));button.tabIndex=name===tab?0:-1;}
}
const sidebarTabs=['files','review','history'] as const;
for(const name of sidebarTabs){action(`${name}-tab`,()=>sidebarTab(name));$(`${name}-tab`).addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const index=sidebarTabs.indexOf(name);const next=event.key==='Home'?'files':event.key==='End'?'history':sidebarTabs[(index+(event.key==='ArrowRight'?1:2))%3];sidebarTab(next);$(`${next}-tab`).focus();}});}

const collapsedFolders=new Set<string>();
function renderChanges(){
 $('changes').replaceChildren();const filter=value('filter').toLowerCase();const entries=changes.filter(e=>e.path.toLowerCase().includes(filter));
 $('changes-empty').hidden=entries.length>0;$('changes-empty').textContent=changes.length?'No files match your filter.':'Compare folders or a branch to explore changed files.';
 function append(parent:HTMLElement,nodes:ChangeNode[]){for(const node of nodes){
  if(node.entry){const entry=node.entry;const button=document.createElement('button');button.className='change-item';button.setAttribute('role','treeitem');const status=document.createElement('span');status.className=`status status-${entry.status}`;status.textContent=entry.status;const name=document.createElement('span');name.textContent=node.name;button.title=entry.oldPath?`${entry.oldPath} → ${entry.path}`:entry.path;button.dataset.path=entry.path;if(entry.sessionId)button.dataset.sessionId=entry.sessionId;button.setAttribute('aria-current',String(entry.sessionId===session?.id));button.append(status,name);if(entry.unavailable){button.classList.add('unavailable');button.title+=` · ${entry.unavailable}`;const badge=document.createElement('small');badge.className='unavailable-badge';badge.textContent='Unavailable';button.append(badge);}button.onclick=()=>{if(entry.unavailable){showMessage(`${entry.path}: ${entry.unavailable} Select a supported text file from the tree to open its diff.`,true);return;}busy();if(entry.sessionId)send({type:'select',id:entry.sessionId,pauseAgent:true});else send({type:'open',request:{left:entry.left,right:entry.right,title:entry.path}});};parent.append(button);}
  else {const folder=document.createElement('details');folder.className='change-folder';folder.open=!!filter||!collapsedFolders.has(node.path);const summary=document.createElement('summary');summary.textContent=node.name;summary.title=node.path;summary.setAttribute('role','treeitem');summary.setAttribute('aria-expanded',String(folder.open));const group=document.createElement('div');group.setAttribute('role','group');append(group,node.children);folder.append(summary,group);folder.addEventListener('toggle',()=>{summary.setAttribute('aria-expanded',String(folder.open));if(!filter){if(folder.open)collapsedFolders.delete(node.path);else collapsedFolders.add(node.path);}});parent.append(folder);}
 }}
 append($('changes'),changeTree(entries));
}
$('changes').addEventListener('keydown',event=>{
 const target=event.target as HTMLElement;const visible=Array.from($('changes').querySelectorAll<HTMLElement>('[role="treeitem"]')).filter(el=>el.getClientRects().length);const index=visible.indexOf(target);if(index<0)return;
 if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?visible.length-1:Math.min(visible.length-1,Math.max(0,index+(event.key==='ArrowDown'?1:-1)));visible[next]?.focus();}
 if(event.key==='ArrowRight'&&target.tagName==='SUMMARY'){event.preventDefault();(target.parentElement as HTMLDetailsElement).open=true;}
 if(event.key==='ArrowLeft'){event.preventDefault();if(target.tagName==='SUMMARY'&&(target.parentElement as HTMLDetailsElement).open)(target.parentElement as HTMLDetailsElement).open=false;else target.closest('[role="group"]')?.parentElement?.querySelector('summary')?.focus();}
});
function renderHistory(items:any[],unsaved:any[]){
 $('sessions').replaceChildren();$('session-count').textContent=String(items.length);$('history-empty').hidden=items.length>0;
 $('history-empty').textContent=config.comparisonHistoryLimit===0?'Comparison history is disabled in Settings.':'Your recent comparisons appear here.';
 for(const item of items){const row=document.createElement('div');row.className='history-row';const button=document.createElement('button');button.className='session-item';button.textContent=`${item.dirty?'● ':''}${item.title}`;button.title=`${item.detail}\nOpened ${new Date(item.time).toLocaleString()}`;button.setAttribute('aria-current',String(item.active));button.onclick=()=>{busy();send({type:'historyOpen',id:item.id});};const remove=document.createElement('button');remove.className='history-remove';remove.textContent='×';remove.title='Remove from history';remove.setAttribute('aria-label',`Remove ${item.title} from history`);remove.onclick=()=>send({type:'historyRemove',id:item.id});row.append(button,remove);$('sessions').append(row);}
 $('unsaved').replaceChildren();$('unsaved-section').hidden=!unsaved.length;for(const item of unsaved){const button=document.createElement('button');button.className='session-item';button.textContent=`● ${item.title}`;button.title='Unsaved buffer retained independently of history';button.onclick=()=>send({type:'select',id:item.id});$('unsaved').append(button);}
}
function restoreSources(target:ComparisonTarget){
 if(target.type==='open'){const left=target.request.left,right=target.request.right;if(left.kind==='git'){input('mode').value=right.kind==='git'?'gitRevisions':'gitWorking';input('repo').value=left.repo;input('git-file').value=left.path;input('left-ref').value=left.ref;input('right-ref').value=right.kind==='git'?right.ref:'HEAD';}else if(left.kind==='file'&&right.kind==='file'){input('mode').value='files';input('left-path').value=left.uri;input('right-path').value=right.uri;}}
 else if(target.type==='directories'){input('mode').value='directories';input('left-path').value=target.left;input('right-path').value=target.right;}
 else {input('repo').value=target.repo;if(target.type==='gitCompare'){input('mode').value=target.mode;input('git-file').value=target.path;input('left-ref').value=target.leftRef;input('right-ref').value=target.rightRef;}else {input('mode').value='gitBase';input('git-file').value='';input('left-ref').value=target.base;input('git-mode').value=target.mode;input('merge-base').checked=target.mergeBase;}}
 modeChanged();api.setState(Object.fromEntries(formKeys.map(k=>[k,value(k)])));
}
$('filter').addEventListener('input',renderChanges);
window.addEventListener('message',event=>{
 const m=event.data;
 switch(m.type){
  case 'init':if(!value('repo'))input('repo').value=m.repo;bridgePath=m.bridgePath;queueRevisions();break;
  case 'session':renderSession(m.session,m.reason);break;
  case 'comments':if(session&&session.id===m.id){session.comments=m.comments;commentUI.render();}break;
  case 'notice':showMessage(m.message);break;
  case 'archiveOpened':sidebarTab('review');break;
  case 'catalog':{
   const selected=m.currentGroup||value('file-set');$('file-set').replaceChildren();for(const group of m.groups){const option=document.createElement('option');option.value=group.id;option.textContent=`${group.label} (${group.count})`;$('file-set').append(option);}if(!m.groups.length){const option=document.createElement('option');option.textContent='No comparisons yet';option.value='';$('file-set').append(option);}input('file-set').value=selected;
   $('review-count').textContent=String(m.sessions.length);$('archive-state').textContent=`${m.dirty?'● ':''}${m.archivePath?'Session file open':'Session'} · ${m.sessions.length} comparisons`;$('archive-state').title=m.archivePath||'Save session to keep all comparisons and comments';
   $('review-sessions').replaceChildren();for(const s of m.sessions){const b=document.createElement('button');b.className='session-item';b.textContent=`${s.title}${s.comments?' · 💬 '+s.comments:''}`;b.title=s.detail||s.title;b.onclick=()=>send({type:'select',id:s.id});$('review-sessions').append(b);}
   $('review-groups').replaceChildren();for(const g of m.groups){const b=document.createElement('button');b.className='session-item review-group';b.textContent=`▸ ${g.label} (${g.count})`;b.title=g.label;b.onclick=()=>send({type:'groupSelect',id:g.id});$('review-groups').append(b);}break;
  }
  case 'settings':{const old=config.layout;config={...m.settings,...pendingSettings};applySettings();if(!session||old!==config.layout){input('layout').value=config.layout;applyLayout();}break;}
  case 'settingSaved':{const key=m.key as keyof Settings;if(pendingSettings[key]===m.value)delete pendingSettings[key];config={...m.settings,...pendingSettings};applySettings();if(key==='layout'){input('layout').value=config.layout;applyLayout();}break;}
  case 'sessions':renderHistory(m.sessions,m.unsaved||[]);break;
  case 'restoreSources':restoreSources(m.target);break;
  case 'changes':if(!m.preserveTab)sidebarTab('files');if(m.id)input('file-set').value=m.id;changes=m.entries;$('file-count').textContent=String(changes.length);renderChanges();showMessage(`${m.label} · ${changes.length} changed files${changes.some(e=>e.unavailable)?` · ${changes.filter(e=>e.unavailable).length} unavailable for text comparison`:''}`);break;
  case 'picked':{const changed=value(m.field)!==m.value;input(m.field).value=m.value;api.setState(Object.fromEntries(formKeys.map(k=>[k,value(k)])));if(changed&&['repo','git-file'].includes(m.field))queueRevisions();if(['left-ref','right-ref'].includes(m.field))renderRevisionOptions();break;}
  case 'revisions':{if(m.requestId!==revisionRequest)break;const page=m.page as RevisionPage;revisionRefs=page.refs;revisionCommits=m.append?[...new Map([...revisionCommits,...page.commits].map(r=>[r.ref,r])).values()]:page.commits;nextRevisionOffset=page.nextOffset;renderRevisionOptions();$('more-versions').hidden=!page.hasMore;$<HTMLButtonElement>('more-versions').disabled=false;$('revision-info').textContent=`${revisionCommits.length} commits loaded · ${value('mode')!=='gitBase'&&value('git-file')?'selected path':'repository history'} · local time`;break;}
  case 'revisionError':if(m.requestId===revisionRequest){$('revision-info').textContent=m.message;$('more-versions').hidden=true;}break;
  case 'error':showMessage(m.message,true);$<HTMLButtonElement>('compare').disabled=false;break;
  case 'done':$<HTMLButtonElement>('compare').disabled=false;if($('message').textContent==='Loading comparison…')showMessage('');break;
  case 'comparisonOpened':composerCollapsed=true;applyPanelVisibility();break;
  case 'agentFollow':input('follow-agent').checked=m.value;$('follow-agent-control').dataset.follow=String(m.value);break;
  case 'agentInstructionsCopied':if(m.review){$('copy-review').textContent='Review request copied';setTimeout(()=>$('copy-review').textContent='Copy review request',2500);break;}$('copy-agent').textContent='Instructions copied';clearTimeout(copiedTimer);copiedTimer=setTimeout(()=>$('copy-agent').textContent='Copy agent instructions',2500);break;
  case 'bridge':bridgePath=m.path;clearTimeout(copiedTimer);$('bridge-status').textContent=bridgePath?'Agent bridge ready':'Agent offline';$('bridge-status').classList.toggle('connected',!!bridgePath);$('agent').textContent=bridgePath?'Disconnect agent':'Connect agent';$('copy-agent').hidden=!bridgePath;$('follow-agent-control').hidden=!bridgePath;$('copy-review').hidden=!bridgePath;$('copy-agent').textContent='Copy agent instructions';break;
  case 'mode':input('mode').value=m.mode;modeChanged();break;
 }
});
send({type:'ready'});
