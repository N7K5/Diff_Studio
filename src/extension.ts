import * as vscode from 'vscode';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import {agentInstructions} from './agentInstructions';
import {randomBytes} from 'node:crypto';
import {Studio} from './studio';
import {AgentBridge} from './bridge';
import {Transport, localPath} from './transport';
import {gitRelativePath} from './git';
import {html} from './html';
import {createArchive,saveArchive,readArchive,importArchive,linkRepository} from './archive';
import {RemoteBrowser} from './remoteBrowser';
import {RecentList, ComparisonTarget, comparisonKey, persistable, comparisonDescription} from './recent';
import {defaults, Settings, CompareRequest, Source, ComparisonGroup} from './types';

export async function activate(context:vscode.ExtensionContext) {
  class EditorAwareTransport extends Transport {
    override async write(uri:string,data:Buffer,expected:string){
      if(!uri.startsWith('ssh:')){const target=localPath(uri);if(vscode.workspace.textDocuments.some(d=>d.uri.scheme==='file'&&d.uri.fsPath===target&&d.isDirty))throw new Error('This file has unsaved changes in another VS Code editor. Save that editor and reload the comparison first.');}
      return super.write(uri,data,expected);
    }
  }
  const studio=new Studio(new EditorAwareTransport());let panel:vscode.WebviewPanel|undefined;let active:string|undefined;let ready=false;let bridgePath:string|undefined;let refreshing=false;let uiEditing=false;let pendingMode:string|undefined;let archivePath:string|undefined;let archiveDirty=false;let archiveRevision=0;let currentGroup:string|undefined;let followAgent=true;let pendingHighlight:{id:string;rangeId:string}|undefined;
  const output=vscode.window.createOutputChannel('Diff Studio Pro');context.subscriptions.push(output);
  function settings():Settings {const c=vscode.workspace.getConfiguration('diffStudio');return Object.fromEntries(Object.entries(defaults).map(([key,value])=>[key,c.get(key,value)])) as unknown as Settings;}
  const history=new RecentList<ComparisonTarget>(settings().comparisonHistoryLimit,context.workspaceState.get('comparisonHistory',[]));
  const historySessions=new Map<string,string>();
  const remote=new RemoteBrowser(studio.io,context.globalState,settings().remoteHistoryLimit);
  function saveHistory(){void context.workspaceState.update('comparisonHistory',history.items.filter(item=>persistable(item.value)));}
  function sendHistory(){sendCatalog();send({type:'sessions',sessions:history.items.map(item=>{const id=historySessions.get(item.key);const s=id?studio.sessions.get(id):undefined;return {id:item.id,title:item.title,detail:comparisonDescription(item.value),time:item.time,active:id===active,dirty:!!(s?.left.dirty||s?.right.dirty)};}),unsaved:[...studio.sessions.values()].filter(s=>s.left.dirty||s.right.dirty).map(s=>({id:s.id,title:s.title}))});}
  function markArchiveDirty(){archiveDirty=true;archiveRevision++;}
  function sendCatalog(){send({type:'catalog',highlights:[...studio.highlights.values()],sessions:[...studio.sessions.values()].map(s=>({id:s.id,title:s.title,comments:s.comments.length,archived:s.archived,detail:`${s.left.label} ↔ ${s.right.label}`})),groups:[...studio.groups.values()].map(g=>({id:g.id,label:g.label,count:g.entries.length})),archivePath,dirty:archiveDirty,currentGroup});}
  function displayGroup(group:ComparisonGroup,preserveTab=false){currentGroup=group.id;send({type:'changes',id:group.id,entries:group.entries,label:group.label,preserveTab,clearFilter:!preserveTab});}
  function agentFollow(value:boolean){followAgent=value;send({type:'agentFollow',value});}
  async function showChanges(label:string,entries:import('./types').ChangeEntry[]){const group=await studio.captureGroup(label,entries);markArchiveDirty();displayGroup(group);sendCatalog();}

  async function exportSession(target?:vscode.Uri){
    const chosen=target||await vscode.window.showSaveDialog({title:`Save session · ${studio.sessions.size} comparisons`,filters:{'Diff Studio Pro session':['diff_studio']},defaultUri:archivePath?vscode.Uri.file(archivePath):undefined,saveLabel:'Save session'});if(!chosen)return;
    const revision=archiveRevision;await saveArchive(chosen.fsPath,createArchive(studio,active));archivePath=chosen.fsPath;archiveDirty=revision!==archiveRevision;sendCatalog();send({type:'notice',message:`Session saved: ${chosen.fsPath}`});return chosen.fsPath;
  }
  async function attachRepository(imported=[...studio.sessions.values()].filter(s=>s.archived)){
    const origins=[...new Set(imported.flatMap(s=>[s.left,s.right].map(d=>d.origin).filter((o):o is Extract<Source,{kind:'git'}>=>o?.kind==='git').map(o=>o.repo)))];
    if(!origins.length){send({type:'notice',message:'This session has no Git repository to link. All bundled snapshots remain available.'});return;}
    const origin=origins.length===1?origins[0]:await vscode.window.showQuickPick(origins,{title:'Which archived repository should be linked?'});if(!origin)return;
    const picked=await vscode.window.showOpenDialog({title:'Locate matching local repository',canSelectFolders:true,canSelectFiles:false,canSelectMany:false,openLabel:'Link repository'});if(!picked?.[0])return;
    try{const result=await linkRepository(studio,imported,picked[0].fsPath,origin);if(active)send({type:'session',session:studio.get(active)});sendHistory();send({type:'notice',message:`Repository linked: ${result.linked} working files editable; ${result.detached} unmatched files kept as archived snapshots.`});}
    catch(e:any){send({type:'notice',message:`Repository could not be linked: ${e.message}. The archive remains fully available.`});}
  }
  async function importSession(target?:vscode.Uri){
    const picked=target||((await vscode.window.showOpenDialog({title:'Open Diff Studio Pro session',canSelectFiles:true,canSelectFolders:false,canSelectMany:false,filters:{'Diff Studio Pro session':['diff_studio']}}))?.[0]);if(!picked)return;
    const archive=await readArchive(picked.fsPath);const imported=importArchive(studio,archive);archivePath=picked.fsPath;archiveRevision++;archiveDirty=studio.sessions.size>imported.sessions.length;const restoredGroup=[...studio.groups.values()].find(g=>g.entries.some(e=>e.sessionId===imported.active));if(restoredGroup)currentGroup=restoredGroup.id;reveal(imported.active);if(restoredGroup)displayGroup(restoredGroup,true);sendCatalog();send({type:'archiveOpened'});
    const choice=await vscode.window.showQuickPick([{label:'Review bundled snapshots',description:'No repository needed',link:false},{label:'Link a local repository…',description:'Only matching working files become editable',link:true}],{title:'Open session',placeHolder:'All compared contents and comments are already included'});
    if(choice?.link)await attachRepository(imported.sessions);return imported;
  }
  function remember(target:ComparisonTarget,title:string,sessionId?:string){const key=comparisonKey(target);if(sessionId)historySessions.set(key,sessionId);history.add(key,title,target);saveHistory();sendHistory();}
  function configure(){const s=settings();studio.io.maxBytes=s.maxFileMB*1048576;studio.io.timeout=s.sshTimeoutSeconds*1000;history.resize(s.comparisonHistoryLimit);saveHistory();void remote.resize(s.remoteHistoryLimit);sendHistory();send({type:'settings',settings:s});}configure();
  function send(message:unknown){if(ready)void panel?.webview.postMessage(message);}
  function reveal(id?:string){
    if(id)active=id;
    if(!panel){
      panel=vscode.window.createWebviewPanel('diffStudio','Diff Studio Pro',vscode.ViewColumn.Active,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'dist')]});
      const uri=(name:string)=>panel!.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri,'dist',name)).toString();
      panel.webview.html=html({script:uri('webview.js'),css:uri('style.css'),monacoCss:uri('webview.css'),workerBase:uri(''),cspSource:panel.webview.cspSource,nonce:randomBytes(18).toString('hex')});
      panel.onDidDispose(()=>{panel=undefined;ready=false;});
      panel.webview.onDidReceiveMessage(async message=>{try{await studio.runExclusive(()=>handle(message));}catch(e:any){send({type:'error',message:e.message});output.appendLine(e.stack||e.message);}});
    }
    panel.reveal(undefined,true);if(active)send({type:'session',session:studio.get(active)});sendHistory();
  }
  const bridge=new AgentBridge(studio,(id,force)=>{if(force||followAgent||!active)reveal(id);},(group,show)=>{
    markArchiveDirty();if(!panel)reveal();if(show||followAgent||!currentGroup||currentGroup===group.id)displayGroup(group,!show);if(show&&!group.entries.some(e=>e.sessionId)){active=undefined;send({type:'clearComparison'});}sendCatalog();
  },()=>{
    pendingHighlight=undefined;active=undefined;currentGroup=undefined;pendingMode=undefined;archivePath=undefined;archiveDirty=false;archiveRevision++;history.items=[];historySessions.clear();saveHistory();
    send({type:'reset',repo:vscode.workspace.workspaceFolders?.[0]?.uri.fsPath||''});agentFollow(true);sendHistory();
  },(id,rangeId)=>revealHighlight(id,rangeId));
  function revealHighlight(id:string,rangeId?:string){const range=studio.highlightRange(id,rangeId);pendingHighlight={id,rangeId:range.id};agentFollow(false);reveal(range.sessionId);if(ready){send({type:'highlightFocus',...pendingHighlight});pendingHighlight=undefined;}}
  studio.onHighlightsChange=()=>{markArchiveDirty();if(!panel)reveal();sendCatalog();};
  async function resetSession(){
    if(studio.sessions.size||studio.groups.size){
      const choice=await vscode.window.showQuickPick([{label:'Save session and reset',description:'Save comparisons, edits and comments to an archive first'},{label:'Reset session',description:'Discard this review; files on disk and saved archives stay unchanged'},{label:'Cancel',description:'Keep the current session'}],{title:'Reset session',placeHolder:'Clear all comparisons, comments and history; keep the agent connected',ignoreFocusOut:true});
      if(choice?.label==='Save session and reset'){if(!await exportSession())return;if(archiveDirty)throw new Error('The session changed while saving. Save it again before resetting.');}
      else if(choice?.label!=='Reset session')return;
    }
    bridge.reset(true);
  }
  studio.onChange=(session,reason)=>{markArchiveDirty();if(reason==='open')remember({type:'open',request:{left:session.left.source,right:session.right.source,title:session.title}},session.title,session.id);else sendHistory();if(session.id===active){if(uiEditing)send({type:'comments',id:session.id,comments:session.comments});else send({type:'session',session,reason});}};
  async function open(request:CompareRequest){
    if(!vscode.workspace.isTrusted)throw new Error('Trust this workspace before accessing files.');
    const target:ComparisonTarget={type:'open',request};const key=comparisonKey(target);
    const prior=[...studio.sessions.values()].reverse().find(s=>comparisonKey({type:'open',request:{left:s.left.source,right:s.right.source}})===key);
    if(prior){if(!prior.left.dirty&&!prior.right.dirty)await studio.reload(prior.id);remember(target,prior.title,prior.id);reveal(prior.id);return prior;}
    const s=await studio.open(request);reveal(s.id);return s;
  }
  async function startAgent(){if(!vscode.workspace.isTrusted)throw new Error('Trust this workspace to start the agent bridge.');bridgePath=await bridge.start(context.globalStorageUri.fsPath);send({type:'bridge',path:bridgePath});output.appendLine(`Agent bridge descriptor: ${bridgePath}`);return bridgePath;}
  async function stopAgent(){await bridge.stop();bridgePath=undefined;send({type:'bridge'});}
  async function copyAgentInstructions(review=false){
    if(!bridgePath)throw new Error('Connect agent before copying instructions.');
    const descriptor=bridgePath;const skillPath=context.asAbsolutePath('skills/diff-studio/SKILL.md');
    const skill=await fs.readFile(skillPath,'utf8');
    if(descriptor!==bridgePath)throw new Error('The agent connection changed. Connect again and copy fresh instructions.');
    const current=active?studio.get(active):undefined;
    const text=agentInstructions({descriptor,cli:context.asAbsolutePath('scripts/agent.mjs'),skillPath,skill,host:os.hostname(),platform:process.platform,remote:vscode.env.remoteName,workspaces:(vscode.workspace.workspaceFolders||[]).map(folder=>folder.uri.fsPath),active:current?{id:current.id,title:current.title}:undefined});
    const copied=review?text+'\nReview request: Read `comments` for all current comparisons. Address my unresolved comments within this task, preserve unrelated edits, reply on each thread with the change or explanation, and resolve only verified fixes. Use `groups` and the existing session IDs so the Files tree and comments remain intact.\n':text;await vscode.env.clipboard.writeText(copied);send({type:'agentInstructionsCopied',review});return copied;
  }

  async function compareGit(m:any){
    const result=await studio.git.selection(m.repo,m.path||'',m.leftRef||'HEAD',m.mode==='gitRevisions'?(m.rightRef||'HEAD'):'WORKING');
    send({type:'picked',field:'repo',value:result.repo});send({type:'picked',field:'git-file',value:result.path});
    if(result.request)await open(result.request);
    else {const label=`${result.path||'Repository'} · ${m.leftRef||'HEAD'} ↔ ${m.mode==='gitRevisions'?(m.rightRef||'HEAD'):'working tree'}`;remember({type:'gitCompare',repo:result.repo,path:result.path,mode:m.mode,leftRef:m.leftRef||'HEAD',rightRef:m.rightRef||'HEAD'},`${path.basename(result.repo)} · ${label}`);await showChanges(label,result.entries||[]);}
  }
  async function openRepository(m:any,repo:string){
    send({type:'picked',field:'repo',value:repo});send({type:'picked',field:'git-file',value:''});
    if(m.mode==='gitBase')await handle({type:'gitChanges',repo,base:m.leftRef||settings().baseBranch,mode:m.gitMode||'working',mergeBase:!!m.mergeBase});
    else await compareGit({...m,repo,path:''});
  }
  async function handle(m:any){
    if(!vscode.workspace.isTrusted)throw new Error('Trust this workspace to use Diff Studio Pro.');
    switch(m.type){
      case 'ready':ready=true;configure();send({type:'init',repo:vscode.workspace.workspaceFolders?.[0]?.uri.fsPath||'',bridgePath});send({type:'bridge',path:bridgePath});agentFollow(followAgent);sendHistory();if(currentGroup&&studio.groups.has(currentGroup))displayGroup(studio.groups.get(currentGroup)!,true);if(active)send({type:'session',session:studio.get(active)});if(pendingHighlight){send({type:'highlightFocus',...pendingHighlight});pendingHighlight=undefined;}if(pendingMode){send({type:'mode',mode:pendingMode});pendingMode=undefined;}break;
      case 'open':await open(m.request);break;
      case 'gitCompare':await compareGit(m);break;
      case 'revisions':{
        try{const page=await studio.git.revisions(m.repo,m.path||'',m.offset||0);send({type:'revisions',requestId:m.requestId,append:!!m.offset,page});}
        catch(e:any){send({type:'revisionError',requestId:m.requestId,message:e.message});}
        return;
      }
      case 'repoFile':{
        const paths=await studio.git.paths(m.repo,m.leftRef||'HEAD',m.mode==='gitRevisions'?(m.rightRef||'HEAD'):'WORKING');
        const chosen=await vscode.window.showQuickPick(paths.map(file=>({label:file})),{title:'Choose file relative to repository',placeHolder:'Search files from both selected versions',matchOnDetail:true});
        if(chosen)await compareGit({...m,path:chosen.label});break;
      }
      case 'historyOpen':{const item=history.items.find(item=>item.id===m.id);if(!item)throw new Error('This history entry is no longer available.');send({type:'restoreSources',target:item.value});await handle(item.value);break;}
      case 'historyRemove':history.remove(m.id);saveHistory();sendHistory();break;
      case 'connectRemote':{if(!['repo','left-path','right-path'].includes(m.field))throw new Error('Unknown connection target.');const location=await remote.connect();if(location!==undefined)send({type:'picked',field:m.field,value:location??(m.field==='repo'?vscode.workspace.workspaceFolders?.[0]?.uri.fsPath||'':'')});break;}
      case 'highlightSelect':revealHighlight(m.id,m.rangeId);break;
      case 'highlightRemove':studio.removeHighlights(m.id);break;
      case 'select':{if(m.pauseAgent&&bridgePath)agentFollow(false);const s=studio.get(m.id);remember({type:'open',request:{left:s.left.source,right:s.right.source,title:s.title}},s.title,s.id);reveal(m.id);break;}
      case 'groupSelect':{const group=studio.groups.get(m.id);if(group){if(bridgePath)agentFollow(false);displayGroup(group);sendCatalog();}break;}
      case 'agentFollow':agentFollow(m.value===true);break;
      case 'commentReply':studio.reply(m.id,m.commentId,m.body);break;
      case 'commentResolve':studio.resolveComment(m.id,m.commentId,m.resolved);break;
      case 'comment':studio.comment(m.id,m.side,m.line,m.body,m.commentId);break;
      case 'commentRemove':studio.removeComment(m.id,m.commentId);break;
      case 'resetSession':await resetSession();break;
      case 'exportSession':await exportSession();break;
      case 'importSession':await importSession();break;
      case 'linkRepository':await attachRepository();break;
      case 'browse':{
        if(m.repo?.startsWith('ssh:')&&m.field==='git-file'){
          const paths=await studio.git.paths(m.repo,m.leftRef||'HEAD',m.mode==='gitRevisions'?(m.rightRef||'HEAD'):'WORKING');
          const folders=new Set<string>();for(const file of paths){let folder=path.posix.dirname(file);while(folder!=='.'){folders.add(folder);folder=path.posix.dirname(folder);}}
          const choices=m.directory?[{label:'$(repo) All repository changes',value:''},...[...folders].sort().map(folder=>({label:`$(folder) ${folder}`,value:folder}))]:paths.map(file=>({label:file,value:file}));
          const pick=await vscode.window.showQuickPick(choices,{title:m.directory?'Choose remote Git folder':'Choose remote Git file',matchOnDescription:true});
          if(pick)await compareGit({...m,path:pick.value});break;
        }
        const location=m.field==='repo'?m.repo:m.location;
        if(location?.startsWith('ssh:')){
          const chosen=await remote.browse(location,!!m.directory);
          if(chosen){send({type:'picked',field:m.field,value:chosen});if(m.field==='repo')await openRepository(m,chosen);}
          break;
        }
        const pick=await vscode.window.showOpenDialog({title:m.field==='repo'?'Open Git repository':m.directory?'Select comparison folder':'Select comparison file',openLabel:m.directory?'Select folder':'Select file',canSelectMany:false,canSelectFiles:!m.directory,canSelectFolders:!!m.directory,defaultUri:m.repo&&!m.repo.startsWith('ssh:')?vscode.Uri.file(localPath(m.repo)):undefined});
        if(pick?.[0]){
          const value=pick[0].scheme==='file'?pick[0].fsPath:pick[0].toString();send({type:'picked',field:m.field,value});
          if(m.field==='repo'){
            await openRepository(m,value);
          }else if(m.field==='git-file')await compareGit({...m,path:value});
        }break;
      }
      case 'directories':{const entries=await studio.directories(m.left,m.right);remember({type:'directories',left:m.left,right:m.right},`${path.basename(m.left)} ↔ ${path.basename(m.right)} · folders`);await showChanges(`${m.left} ↔ ${m.right}`,entries);break;}
      case 'gitChanges':{const result=await studio.git.changes(m.repo,m.base||settings().baseBranch,m.mode,m.mergeBase);remember({type:'gitChanges',repo:result.repo,base:m.base||settings().baseBranch,mode:m.mode||'working',mergeBase:!!m.mergeBase},`${path.basename(result.repo)} · changes against ${m.base||'base'}`);await showChanges(`Compared with ${m.base||'auto-detected base'} · ${result.base.slice(0,8)}`,result.entries);break;}
      case 'history':{const repo=await studio.git.root(m.repo);const choices=await studio.git.history(repo,gitRelativePath(repo,m.path||''));const choice=await vscode.window.showQuickPick(choices,{title:'Choose left revision'});if(choice)send({type:'picked',field:'left-ref',value:choice.ref});break;}
      case 'edit':uiEditing=true;try{studio.edit(m.id,m.side,m.text);}finally{uiEditing=false;}break;
      case 'language':{const s=studio.get(m.id);if(typeof m.language==='string'&&m.language.length<100){s.left.language=m.language;s.right.language=m.language;}break;}
      case 'save':await studio.save(m.id,m.side);break;
      case 'reload':{const s=studio.get(m.id);let discard=false;if(s.left.dirty||s.right.dirty){discard=await vscode.window.showWarningMessage('Discard unsaved edits in both panes and reload?',{modal:true},'Discard and reload')==='Discard and reload';if(!discard)break;}await studio.reload(m.id,discard);break;}
      case 'swap':{const s=studio.get(m.id);[s.left,s.right]=[s.right,s.left];for(const c of s.comments)c.side=c.side==='left'?'right':'left';for(const set of studio.highlights.values())for(const r of set.ranges)if(r.sessionId===s.id)r.side=r.side==='left'?'right':'left';markArchiveDirty();studio.note(s.id,'Swapped comparison sides');send({type:'session',session:s,reason:'swap'});break;}
      case 'settings':{const key=m.key as keyof Settings;if(!(key in defaults))throw new Error('Unknown setting');const manifest=context.extension.packageJSON.contributes.configuration.properties[`diffStudio.${key}`];if(typeof m.value!==typeof defaults[key] || (manifest.enum&&!manifest.enum.includes(m.value)) || (typeof m.value==='number'&&(!Number.isFinite(m.value)||(manifest.type==='integer'&&!Number.isInteger(m.value))||m.value<manifest.minimum||m.value>manifest.maximum)))throw new Error('Setting value is outside its supported range.');await vscode.workspace.getConfiguration('diffStudio').update(key,m.value,vscode.ConfigurationTarget.Global);configure();send({type:'settingSaved',key,value:m.value,settings:settings()});break;}
      case 'agent':if(bridgePath)await stopAgent();else await startAgent();break;
      case 'copyAgentInstructions':await copyAgentInstructions();break;
      case 'copyReviewRequest':await copyAgentInstructions(true);break;
      case 'native':{const s=studio.get(m.id);const uri=async(source:Source,text:string)=>source.kind==='file'&&!source.uri.startsWith('ssh:')?vscode.Uri.file(localPath(source.uri)):(await vscode.workspace.openTextDocument({content:text,language:s.right.language})).uri;await vscode.commands.executeCommand('vscode.diff',await uri(s.left.source,s.left.text),await uri(s.right.source,s.right.text),s.title);break;}
    }
    if(m.collapseComposer&&['open','directories','gitCompare','gitChanges'].includes(m.type))send({type:'comparisonOpened'});
    send({type:'done'});
  }
  const command=(name:string,fn:(...args:any[])=>any)=>context.subscriptions.push(vscode.commands.registerCommand(name,async(...args:any[])=>{try{return await studio.runExclusive(()=>fn(...args));}catch(e:any){void vscode.window.showErrorMessage(`Diff Studio Pro: ${e.message}`);throw e;}}));
  command('diffStudio.open',(request?:CompareRequest)=>request?.left?open(request):reveal());
  command('diffStudio.compareSelected',async(uri?:vscode.Uri,selected?:vscode.Uri[])=>{let files=selected?.length===2?selected:undefined;if(!files){files=await vscode.window.showOpenDialog({canSelectMany:true,canSelectFiles:true,canSelectFolders:false,title:'Select exactly two files'}) as vscode.Uri[]|undefined;}if(!files)return;if(files.length!==2)throw new Error('Select exactly two files.');await open({left:{kind:'file',uri:files[0].fsPath},right:{kind:'file',uri:files[1].fsPath}});});
  command('diffStudio.gitWorking',async()=>{const file=vscode.window.activeTextEditor?.document.uri;if(!file||file.scheme!=='file'){reveal();return;}const repo=await studio.git.root(path.dirname(file.fsPath));const ref=await vscode.window.showInputBox({prompt:'Git revision (HEAD, branch, tag, SHA, or INDEX)',value:'HEAD'});if(!ref)return;await open({left:{kind:'git',repo,path:path.relative(repo,file.fsPath).split(path.sep).join('/'),ref},right:{kind:'file',uri:file.fsPath}});});
  command('diffStudio.gitBase',()=>{pendingMode='gitBase';reveal();if(ready){send({type:'mode',mode:pendingMode});pendingMode=undefined;}});
  command('diffStudio.resetSession',resetSession);
  command('diffStudio.saveSession',exportSession);command('diffStudio.openSession',importSession);
  command('diffStudio.copyAgentInstructions',copyAgentInstructions);
  command('diffStudio.startAgent',async()=>{const p=await startAgent();output.show(true);return p;});command('diffStudio.stopAgent',stopAgent);
  const navigationItems=[['Open Comparison Studio','diffStudio.open','diff'],['Changes Against Branch','diffStudio.gitBase','git-compare'],['Compare Current File','diffStudio.gitWorking','file-code'],['Open Saved Session','diffStudio.openSession','folder-opened'],['Save Session','diffStudio.saveSession','save'],['Start Agent Bridge','diffStudio.startAgent','hubot'],['Copy Agent Instructions','diffStudio.copyAgentInstructions','copy']].map(([label,command,icon])=>{const item=new vscode.TreeItem(label);item.command={command,title:label};item.iconPath=new vscode.ThemeIcon(icon);return item;});
  const navigation=vscode.window.createTreeView('diffStudio.navigation',{treeDataProvider:{getTreeItem:item=>item,getChildren:()=>navigationItems}});
  context.subscriptions.push(navigation,navigation.onDidChangeVisibility(event=>{if(event.visible)reveal();}));
  if(navigation.visible)reveal();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e=>{if(e.affectsConfiguration('diffStudio'))configure();}));
  const timer=setInterval(()=>{if(refreshing||!panel)return;refreshing=true;void studio.refreshClean().finally(()=>{refreshing=false;});},3000);
  context.subscriptions.push({dispose(){clearInterval(timer);void bridge.stop();panel?.dispose();}});
  return {studio,open,startAgent,stopAgent,reveal,getPanel:()=>panel};
}
