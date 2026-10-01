import path from 'node:path';
import {promises as fs} from 'node:fs';
import {Transport, joinLocation, localPath, sshLocation} from './transport';
import {ChangeEntry, Source, CompareRequest, Revision, RevisionPage} from './types';

export function gitRelativePath(repo:string, input:string):string {
  if(typeof input!=='string'||input.includes('\0'))throw new Error('Choose a file or folder inside the repository.');
  let relative:string;
  if(repo.startsWith('ssh:')){
    const root=sshLocation(repo);let target=input;
    if(input.startsWith('ssh:')){const location=sshLocation(input);if(location.host!==root.host||location.port!==root.port)throw new Error('The selected path must be on the same SSH host as the repository.');target=location.path;}
    else if(input.startsWith('file:'))throw new Error('Choose a remote path for this SSH repository.');
    relative=path.posix.relative(root.path,path.posix.resolve(root.path,target||'.'));
  }else{
    const root=localPath(repo);const target=input.startsWith('file:')?localPath(input):input;
    if(target.startsWith('ssh:'))throw new Error('Choose a local path for this repository.');
    relative=path.relative(root,path.resolve(root,target||'.')).split(path.sep).join('/');
  }
  if(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))throw new Error('The selected path is outside the repository. Choose a path relative to its root or a full path inside it.');
  return relative;
}
export class GitService {
  constructor(private io:Transport) {}
  private async git(repo:string,...args:string[]):Promise<Buffer> {return this.io.run(repo,['git','--no-pager',...args]);}
  async root(repo:string):Promise<string> {const p=(await this.git(repo,'rev-parse','--show-toplevel')).toString().trim();if(repo.startsWith('ssh:')){const u=new URL(repo);u.pathname=p.split('/').map(encodeURIComponent).join('/');return u.toString();}return p;}
  async resolve(repo:string,ref:string):Promise<string> {
    if(!ref||ref.startsWith('-')||ref.includes('\0'))throw new Error('Enter a valid Git revision.');
    return (await this.git(repo,'rev-parse','--verify','--end-of-options',`${ref}^{commit}`)).toString().trim();
  }
  async base(repo:string,preferred=''):Promise<string> {
    if(preferred){await this.resolve(repo,preferred);return preferred;}
    for(const ref of ['origin/HEAD','master','main','origin/master','origin/main']){try{await this.resolve(repo,ref);return ref;}catch{}}
    throw new Error('No master/main base found. Enter a branch or commit in the Base field.');
  }
  async read(repo:string,file:string,ref:string):Promise<Buffer|null> {
    file=gitRelativePath(repo,file);
    if(!file)throw new Error('Choose a file to open a single-file diff, or use folder comparison to list changes.');
    const revision=ref==='INDEX'?':':(await this.resolve(repo,ref))+':';
    // Use an exact tree/index listing to distinguish an absent file from a failed Git command.
    const names=(await this.git(repo,...(ref==='INDEX'?['ls-files','-z','--',file]:['ls-tree','-r','--name-only','-z',revision.slice(0,-1),'--',file]))).toString().split('\0');
    if(!names.includes(file))return null;
    return this.git(repo,'show',`${revision}${file}`);
  }
  async history(repo:string,file:string):Promise<{ref:string;label:string}[]> {
    file=gitRelativePath(repo,file);
    const raw=(await this.git(repo,'log','-50','--format=%H%x00%h · %s · %ar','--',...(file?[file]:[]))).toString();
    return raw.trim().split('\n').filter(Boolean).map(line=>{const [ref,label]=line.split('\0');return {ref,label};});
  }
  async revisions(repoInput:string,fileInput='',offset=0,limit=200):Promise<RevisionPage> {
    if(!repoInput?.trim())throw new Error('Choose a repository to browse its revisions.');
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>500)throw new Error('Invalid revision page.');
    const repo=await this.root(repoInput);
    let selected=fileInput;
    if(!repo.startsWith('ssh:')&&(path.isAbsolute(selected)||selected.startsWith('file:')))selected=await fs.realpath(localPath(selected)).catch(()=>selected);
    const file=gitRelativePath(repo,selected);
    const [refsRaw,logRaw]=await Promise.all([
      this.git(repo,'for-each-ref','--sort=-creatordate','--format=%(refname)%00%(creatordate:iso-strict)%00%(subject)','refs/heads','refs/remotes','refs/tags'),
      this.git(repo,'log','--all','HEAD','--date-order',`--skip=${offset}`,`--max-count=${limit+1}`,'--format=%H%x00%cI%x00%s%x00%an','--',...(file?[file]:[]))
    ]);
    const refs:Revision[]=refsRaw.toString().split('\n').filter(Boolean).map(line=>{const [name,date,subject]=line.split('\0');return {ref:name,kind:name.startsWith('refs/tags/')?'tag':'branch',date,subject};});
    const all:Revision[]=logRaw.toString().split('\n').filter(Boolean).map(line=>{const [ref,date,subject,author]=line.split('\0');return {ref,kind:'commit',date,subject,author};});
    return {refs,commits:all.slice(0,limit),hasMore:all.length>limit,nextOffset:offset+Math.min(limit,all.length)};
  }
  async changes(repoInput:string,baseRef:string,mode:'working'|'committed'|'staged'='working',mergeBase=false):Promise<{repo:string;base:string;entries:ChangeEntry[]}> {
    const repo=await this.root(repoInput);
    let base=await this.resolve(repo,await this.base(repo,baseRef));
    if(mergeBase)base=(await this.git(repo,'merge-base',base,'HEAD')).toString().trim();
    return {repo,base,entries:await this.compareEntries(repo,base,mode==='working'?'WORKING':mode==='staged'?'INDEX':'HEAD')};
  }
  private async compareEntries(repo:string,leftRef:string,rightRef:string):Promise<ChangeEntry[]> {
    const left=leftRef==='INDEX'?'INDEX':await this.resolve(repo,leftRef);
    const right=['WORKING','INDEX'].includes(rightRef)?rightRef:await this.resolve(repo,rightRef);
    if(left===right)return [];
    const args=['diff','--name-status','-z','--find-renames'];
    if(right==='WORKING'){if(left!=='INDEX')args.push(left);}
    else if(right==='INDEX')args.push('--cached',left);
    else if(left==='INDEX')args.push('--cached','--reverse',right);
    else args.push(left,right);
    args.push('--');
    const parts=(await this.git(repo,...args)).toString().split('\0');const entries:ChangeEntry[]=[];
    while(parts.length>1){const status=parts.shift()!;const a=parts.shift()!;if(!status)break;const renamed=/^[RC]/.test(status);const b=renamed?parts.shift()!:a;
      const leftSource:Source={kind:'git',repo,path:a,ref:left};
      const rightSource:Source=right==='WORKING'?{kind:'file',uri:joinLocation(repo,b),allowMissing:true}:{kind:'git',repo,path:b,ref:right};
      entries.push({status:status[0],path:b,...(renamed?{oldPath:a}:{}),left:leftSource,right:rightSource});
    }
    if(right==='WORKING')for(const file of (await this.git(repo,'ls-files','--others','--exclude-standard','-z')).toString().split('\0').filter(Boolean))if(!entries.some(e=>e.path===file))entries.push({status:'?',path:file,left:{kind:'text',text:'',label:'Not in base'},right:{kind:'file',uri:joinLocation(repo,file)}});
    return entries;
  }
  private async names(repo:string,ref:string):Promise<string[]> {
    const args=ref==='WORKING'?['ls-files','--cached','--others','--exclude-standard','-z']:ref==='INDEX'?['ls-files','-z']:['ls-tree','-r','--name-only','-z',await this.resolve(repo,ref)];
    return (await this.git(repo,...args)).toString().split('\0').filter(Boolean);
  }
  async paths(repoInput:string,leftRef='HEAD',rightRef='WORKING'):Promise<string[]> {
    const repo=await this.root(repoInput);
    return [...new Set((await Promise.all([this.names(repo,leftRef),this.names(repo,rightRef)])).flat())].sort();
  }
  async selection(repoInput:string,input:string,leftRef='HEAD',rightRef='WORKING'):Promise<{repo:string;path:string;request?:CompareRequest;entries?:ChangeEntry[]}> {
    if(!repoInput?.trim())throw new Error('Choose a repository folder first.');
    const repo=await this.root(repoInput);
    // Resolve local aliases such as /tmp -> /private/tmp before the containment check.
    let selected=input||'';
    if(!repo.startsWith('ssh:')&&(path.isAbsolute(selected)||selected.startsWith('file:')))selected=await fs.realpath(localPath(selected)).catch(()=>selected);
    const file=gitRelativePath(repo,selected);
    if(!file)return {repo,path:file,entries:await this.compareEntries(repo,leftRef,rightRef)};
    const names=new Set((await Promise.all([this.names(repo,leftRef),this.names(repo,rightRef)])).flat());
    if(names.has(file))return {repo,path:file,request:{left:{kind:'git',repo,path:file,ref:leftRef},right:rightRef==='WORKING'?{kind:'file',uri:joinLocation(repo,file),allowMissing:true}:{kind:'git',repo,path:file,ref:rightRef}}};
    if([...names].some(name=>name.startsWith(file+'/'))){const entries=await this.compareEntries(repo,leftRef,rightRef);return {repo,path:file,entries:entries.filter(e=>e.path.startsWith(file+'/')||e.oldPath?.startsWith(file+'/'))};}
    throw new Error(`No file or folder named "${file}" was found in either selected version. Choose a file or leave the field empty for all changes.`);
  }
}
