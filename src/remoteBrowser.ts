import * as vscode from 'vscode';
import {Transport, joinLocation, sshLocation, sshRoot} from './transport';
import {RecentList, RecentEntry} from './recent';

export interface RemoteConnection {root:string;folder:string}
function atPath(uri:string,folder:string){const u=new URL(uri);u.pathname=folder.split('/').map(encodeURIComponent).join('/');return u.toString();}
type ConnectionItem=vscode.QuickPickItem & {action:'local'|'new'|'remote';entry?:RecentEntry<RemoteConnection>};
export class RemoteBrowser {
  readonly recent:RecentList<RemoteConnection>;
  constructor(private io:Transport, private state:vscode.Memento, limit:number){this.recent=new RecentList(limit,state.get('remoteConnections',[]));}
  async resize(limit:number){this.recent.resize(limit);await this.persist();}
  private async persist(){await this.state.update('remoteConnections',this.recent.items);}
  async connect():Promise<string|null|undefined>{
    const choice=await new Promise<ConnectionItem|undefined>(resolve=>{
      const picker=vscode.window.createQuickPick<ConnectionItem>();picker.title='Choose connection';picker.placeholder='Local computer, a recent VM, or a new SSH connection';
      const refresh=()=>{picker.items=[{label:'$(device-desktop) Local computer',action:'local'},{label:'$(add) Connect to SSH VM…',action:'new'},...this.recent.items.map(entry=>({label:`$(remote) ${sshLocation(entry.value.root).host}`,description:entry.value.root,detail:entry.value.folder,action:'remote' as const,entry,buttons:[{iconPath:new vscode.ThemeIcon('close'),tooltip:'Remove VM from history'}]}))];};
      refresh();picker.onDidTriggerItemButton(async event=>{this.recent.remove(event.item.entry!.id);refresh();await this.persist();});
      picker.onDidAccept(()=>{const selected=picker.selectedItems[0];if(selected){resolve(selected);picker.hide();}});
      picker.onDidHide(()=>{resolve(undefined);picker.dispose();});picker.show();
    });
    if(!choice)return undefined;if(choice.action==='local')return null;
    let root=choice.entry?.value.root;
    if(choice.action==='new'){
      const host=await vscode.window.showInputBox({title:'Connect to SSH VM',prompt:'Host alias or user@host:port · uses your OpenSSH keys and configuration',placeHolder:'user@example.com',validateInput:value=>{try{sshRoot(value);return undefined;}catch(e:any){return e.message;}}});
      if(!host)return undefined;root=sshRoot(host);
    }
    const listing=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:`Connecting to ${sshLocation(root!).host}…`},()=>this.io.browse(root!,true));
    const folder=choice.entry?.value.folder||joinLocation(root!,listing.path);
    this.recent.add(root!,sshLocation(root!).host,{root:root!,folder});await this.persist();return folder;
  }
  async browse(start:string,directory:boolean):Promise<string|undefined>{
    let current=start;
    while(true){
      const listing=await vscode.window.withProgress({location:vscode.ProgressLocation.Notification,title:'Reading remote folder…'},()=>this.io.browse(current));
      current=atPath(current,listing.path);
      type Item=vscode.QuickPickItem & {uri?:string;action:'select'|'enter'|'path'};
      const choices:Item[]=[...(directory?[{label:'$(check) Select this folder',description:listing.path,uri:current,action:'select' as const}]:[]),{label:'$(arrow-up) Parent folder',uri:joinLocation(current,'..'),action:'enter'},{label:'$(home) Home folder',uri:atPath(current,listing.home),action:'enter'},{label:'$(go-to-file) Go to path…',action:'path'},...listing.entries.filter(e=>!directory||e.directory).map(e=>({label:`$(${e.directory?'folder':'file'}) ${e.name}`,uri:joinLocation(current,e.name),action:e.directory?'enter' as const:'select' as const}))];
      const selected=await vscode.window.showQuickPick(choices,{title:`Remote ${directory?'folder':'file'} · ${sshLocation(current).host}:${listing.path}`,placeHolder:directory?'Open a folder, then choose Select this folder':'Open folders or choose a file',matchOnDescription:true});
      if(!selected)return undefined;
      if(selected.action==='select'){
        await this.rememberFolder(current);return selected.uri;
      }
      if(selected.action==='enter'){current=selected.uri!;continue;}
      const target=await vscode.window.showInputBox({title:'Go to remote folder',value:listing.path,prompt:'Absolute remote folder path (or ~/path)',validateInput:value=>value.startsWith('/')||value==='~'||value.startsWith('~/')?undefined:'Enter an absolute folder path or ~/path.'});
      if(target)current=atPath(current,target==='~'?listing.home:target.startsWith('~/')?listing.home+'/'+target.slice(2):target);
    }
  }
  private async rememberFolder(folder:string){
    const url=new URL(folder);url.pathname='/';const root=url.toString();const entry=this.recent.items.find(item=>item.value.root===root);
    if(entry){entry.value.folder=folder;await this.persist();}
  }
}
