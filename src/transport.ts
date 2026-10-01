import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';

export function hash(data: Uint8Array | string): string { return createHash('sha256').update(data).digest('hex'); }
export function decode(data: Uint8Array, maxBytes: number): string {
  if (data.length > maxBytes) throw new Error(`File exceeds the ${maxBytes / 1048576} MB limit. Change Max file size in Settings.`);
  if (data.includes(0)) throw new Error('Binary files are not editable text. Open them with a binary comparison tool.');
  try { return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(data); }
  catch { throw new Error('This file is not valid UTF-8. Convert its encoding before comparing.'); }
}
export function localPath(uri: string): string {
  if (uri.startsWith('file:')) return fileURLToPath(uri);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) throw new Error(`Unsupported file location: ${uri}`);
  return path.resolve(uri);
}
export function sshLocation(uri: string): {host:string; port?:string; path:string} {
  const u = new URL(uri);
  const host = (u.username ? decodeURIComponent(u.username) + '@' : '') + u.hostname;
  if (u.protocol !== 'ssh:' || u.password || u.search || u.hash || !/^[a-zA-Z0-9_][a-zA-Z0-9_.@:\[\]-]*$/.test(host) || host.startsWith('-')) throw new Error('Use ssh://[user@]host[:port]/absolute/path without passwords or query strings.');
  const remotePath = decodeURIComponent(u.pathname);
  if (!remotePath.startsWith('/') || remotePath.includes('\0')) throw new Error('SSH paths must be absolute.');
  return {host, port:u.port || undefined, path:remotePath};
}
export function joinLocation(root:string, relative:string):string {
  if (root.startsWith('ssh:')) { const u = new URL(root); u.pathname = path.posix.join(decodeURIComponent(u.pathname),relative).split('/').map(encodeURIComponent).join('/'); return u.toString(); }
  return path.join(localPath(root),relative);
}
export function sshRoot(input:string):string {
  const text=input.trim();
  const uri=new URL(text.startsWith('ssh://')?text:`ssh://${text}/`);
  if(!uri.pathname)uri.pathname='/';
  sshLocation(uri.toString());
  if(uri.pathname!=='/')throw new Error('Enter a host or user@host:port. Choose the folder after connecting.');
  return uri.toString();
}
export interface DirectoryListing {path:string;home:string;entries:{name:string;directory:boolean}[]}
export async function processOutput(command:string, args:string[], options:{cwd?:string; input?:string; timeout?:number; maxBytes?:number} = {}):Promise<Buffer> {
  return new Promise((resolve,reject)=>{
    const child = spawn(command,args,{cwd:options.cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
    const out:Buffer[]=[]; const err:Buffer[]=[]; let bytes=0; let settled=false;
    const fail=(e:Error)=>{if(!settled){settled=true;clearTimeout(timer);child.kill();reject(e);}};
    const timer=setTimeout(()=>fail(new Error(`${command} timed out. Check connectivity, credentials and SSH settings.`)), options.timeout || 20000);
    child.on('error',fail);
    child.stdout.on('data',(b:Buffer)=>{bytes+=b.length;if(bytes>(options.maxBytes||32*1048576))fail(new Error('Command output exceeds the size limit.'));else out.push(b);});
    child.stderr.on('data',(b:Buffer)=>{if(Buffer.concat(err).length<8192)err.push(b);});
    child.on('close',code=>{clearTimeout(timer);if(settled)return;settled=true;if(code===0)resolve(Buffer.concat(out));else reject(new Error(`${command} failed (${code}): ${Buffer.concat(err).toString().trim()}`));});
    child.stdin.on('error',()=>{});child.stdin.end(options.input);
  });
}
// Only this constant program is sent to the remote shell. Paths and contents travel as JSON on stdin.
const REMOTE = String.raw`import sys,json,os,base64,hashlib,tempfile,subprocess
r=json.load(sys.stdin); p=r['path']; action=r['action']; limit=r.get('limit',10485760)
def read(p):
 try:
  with open(p,'rb') as f: b=f.read(limit+1)
  if len(b)>limit: raise Exception('File exceeds size limit')
  return b
 except FileNotFoundError: return None
if action=='read':
 b=read(p); result={'data':base64.b64encode(b).decode() if b is not None else None}
elif action=='write':
 b=read(p); version=hashlib.sha256(b).hexdigest() if b is not None else 'missing'
 if version!=r['expected']: raise Exception('File changed on disk. Reload before saving; your edits are retained.')
 data=base64.b64decode(r['data']); target=os.path.realpath(p); folder=os.path.dirname(target)
 if len(data)>limit: raise Exception('File exceeds size limit')
 os.makedirs(folder,exist_ok=True)
 fd,tmp=tempfile.mkstemp(prefix='.diff-studio-',dir=folder)
 try:
  with os.fdopen(fd,'wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
  if b is not None: os.chmod(tmp,os.stat(target).st_mode & 0o777)
  os.replace(tmp,target)
 finally:
  if os.path.exists(tmp): os.unlink(tmp)
 result={'ok':True}
elif action=='list':
 result=[]
 for root,dirs,files in os.walk(p):
  dirs[:]=sorted(d for d in dirs if d not in ['.git','node_modules'] and not os.path.islink(os.path.join(root,d)))
  for f in sorted(files):
   if not os.path.islink(os.path.join(root,f)): result.append(os.path.relpath(os.path.join(root,f),p))
   if len(result)>10000: raise Exception('Directory exceeds 10000 files')
 if not os.path.isdir(p): raise Exception('Directory does not exist')
elif action=='browse':
 p=os.path.expanduser('~') if r.get('home') else p
 if os.path.isfile(p): p=os.path.dirname(p)
 entries=[]
 with os.scandir(p) as items:
  for item in items:
   try:
    directory=item.is_dir()
    if directory or item.is_file(): entries.append({'name':item.name,'directory':directory})
   except OSError: continue
   if len(entries)>10000: raise Exception('Folder exceeds 10000 entries. Use Go to path to browse a subfolder.')
 result={'path':p,'home':os.path.expanduser('~'),'entries':sorted(entries,key=lambda e:(not e['directory'],e['name'].lower()))}
elif action=='run':
 c=subprocess.run(r['args'],cwd=p,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=r.get('timeout',20))
 if c.returncode: raise Exception(c.stderr.decode(errors='replace')[:8192])
 if len(c.stdout)>limit: raise Exception('Command output exceeds size limit')
 result={'data':base64.b64encode(c.stdout).decode()}
else: raise Exception('Unknown action')
json.dump(result,sys.stdout)`;
const quote = (s:string)=>"'"+s.replace(/'/g,"'\\''")+"'";
export class Transport {
  private writes=new Map<string,Promise<void>>();
  constructor(public maxBytes=10*1048576, public timeout=20000) {}
  private async remote(uri:string, action:string, extra:object={}):Promise<any> {
    const loc=sshLocation(uri);
    const args=['-T','-o','BatchMode=yes','-o',`ConnectTimeout=${Math.ceil(this.timeout/1000)}`];
    if(loc.port)args.push('-p',loc.port);
    args.push('--',loc.host,`python3 -c ${quote(REMOTE)}`);
    const result=await processOutput('ssh',args,{input:JSON.stringify({action,path:loc.path,limit:this.maxBytes,timeout:Math.ceil(this.timeout/1000),...extra}),timeout:this.timeout+2000,maxBytes:this.maxBytes*2+1048576});
    return JSON.parse(result.toString());
  }
  async read(uri:string):Promise<Buffer|null> {
    if(uri.startsWith('ssh:')){const r=await this.remote(uri,'read');return r.data===null?null:Buffer.from(r.data,'base64');}
    const p=localPath(uri);
    try {const stat=await fs.stat(p);if(!stat.isFile())throw new Error('Select a file, not a directory.');if(stat.size>this.maxBytes)throw new Error('File exceeds size limit.');return await fs.readFile(p);}catch(e:any){if(e.code==='ENOENT')return null;throw e;}
  }
  async write(uri:string, data:Buffer, expected:string):Promise<void> {
    const key=uri.startsWith('ssh:')?new URL(uri).toString():await fs.realpath(localPath(uri)).catch(()=>localPath(uri));
    const prior=this.writes.get(key)||Promise.resolve();const next=prior.catch(()=>{}).then(()=>this.writeUnlocked(uri,data,expected));this.writes.set(key,next);
    try{await next;}finally{if(this.writes.get(key)===next)this.writes.delete(key);}
  }
  private async writeUnlocked(uri:string, data:Buffer, expected:string):Promise<void> {
    if(data.length>this.maxBytes)throw new Error('File exceeds size limit.');
    if(uri.startsWith('ssh:')){await this.remote(uri,'write',{data:data.toString('base64'),expected});return;}
    const current=await this.read(uri);
    if((current===null?'missing':hash(current))!==expected)throw new Error('File changed on disk. Reload before saving; your edits are retained.');
    const p=localPath(uri);const target=current===null?p:await fs.realpath(p);
    await fs.mkdir(path.dirname(target),{recursive:true});
    const tmp=path.join(path.dirname(target),`.diff-studio-${randomUUID()}`);
    try {await fs.writeFile(tmp,data,{flag:'wx',mode:current===null?0o600:(await fs.stat(target)).mode & 0o777});await fs.rename(tmp,target);}finally{await fs.rm(tmp,{force:true});}
  }
  async run(cwd:string,args:string[]):Promise<Buffer> {
    if(cwd.startsWith('ssh:'))return Buffer.from((await this.remote(cwd,'run',{args})).data,'base64');
    return processOutput(args[0],args.slice(1),{cwd:localPath(cwd),timeout:this.timeout,maxBytes:this.maxBytes});
  }
  async browse(uri:string,home=false):Promise<DirectoryListing> {
    if(!uri.startsWith('ssh:'))throw new Error('Remote browser requires an SSH location.');
    return this.remote(uri,'browse',{home});
  }
  async list(root:string):Promise<string[]> {
    if(root.startsWith('ssh:'))return this.remote(root,'list');
    const output:string[]=[];const base=localPath(root);
    const walk=async(dir:string)=>{for(const item of await fs.readdir(dir,{withFileTypes:true})){if(item.isSymbolicLink()||['.git','node_modules'].includes(item.name))continue;const p=path.join(dir,item.name);if(item.isDirectory())await walk(p);else if(item.isFile())output.push(path.relative(base,p));if(output.length>10000)throw new Error('Directory exceeds 10000 files.');}};
    await walk(base);return output.sort();
  }
}
