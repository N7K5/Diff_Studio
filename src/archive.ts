import {promises as fs} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Studio} from './studio';
import {Source,DocumentState,Session,LineComment,ComparisonGroup,Activity} from './types';
import {hash,joinLocation} from './transport';
import {gitRelativePath} from './git';
import {lines} from './comments';

export const ARCHIVE_LIMIT=256*1048576;
interface SavedDocument {source:Source;label:string;text:string;savedText:string;initialText:string;language:string;exists:boolean;resolvedRef?:string;sha256:string}
interface SavedSession {id:string;title:string;left:SavedDocument;right:SavedDocument;comments:LineComment[];activity:Activity[]}
interface SavedGroup {id:string;label:string;entries:{path:string;status:string;oldPath?:string;sessionId?:string;unavailable?:string}[]}
export interface Archive {format:'diff-studio/session';version:1;createdAt:string;active?:string;sessions:SavedSession[];groups:SavedGroup[]}

export function createArchive(studio:Studio,active?:string):Archive{
  const document=(d:DocumentState):SavedDocument=>({source:d.origin||d.source,label:d.label,text:d.text,savedText:d.savedText,initialText:d.initialText??d.savedText,language:d.language,exists:d.exists,resolvedRef:d.resolvedRef,sha256:hash(d.text)});
  return {format:'diff-studio/session',version:1,createdAt:new Date().toISOString(),active,sessions:[...studio.sessions.values()].map(s=>({id:s.id,title:s.title,left:document(s.left),right:document(s.right),comments:structuredClone(s.comments),activity:structuredClone(s.activity)})),groups:[...studio.groups.values()].map(g=>({id:g.id,label:g.label,entries:g.entries.map(e=>({path:e.path,status:e.status,oldPath:e.oldPath,sessionId:e.sessionId,unavailable:e.unavailable}))}))};
}
export async function saveArchive(file:string,archive:Archive){
  const data=JSON.stringify(archive,null,2);if(Buffer.byteLength(data)>ARCHIVE_LIMIT)throw new Error('Session archive exceeds the 256 MB limit.');
  const temp=path.join(path.dirname(file),`.diff-studio-${randomUUID()}.tmp`);
  try{await fs.writeFile(temp,data,{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}
function text(value:unknown,name:string,max=ARCHIVE_LIMIT):string {if(typeof value!=='string'||value.length>max)throw new Error(`Invalid archive ${name}.`);return value;}
function object(value:any,name:string){if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(`Invalid archive ${name}.`);return value;}
function array(value:any,name:string,max=10000):any[]{if(!Array.isArray(value)||value.length>max)throw new Error(`Invalid archive ${name}.`);return value;}
function source(value:any):Source{
  object(value,'source');
  if(value.kind==='file')return {kind:'file',uri:text(value.uri,'file location',16000),...(value.allowMissing===true?{allowMissing:true}:{})};
  if(value.kind==='git')return {kind:'git',repo:text(value.repo,'repository',16000),path:text(value.path,'path',16000),ref:text(value.ref,'revision',1024)};
  if(value.kind==='text')return {kind:'text',label:text(value.label,'label',16000),text:text(value.text,'snapshot')};
  throw new Error('Invalid archive source kind.');
}
function document(value:any):SavedDocument{
  object(value,'document');const content=text(value.text,'file contents');if(hash(content)!==value.sha256)throw new Error('Archive content checksum does not match.');
  if(typeof value.exists!=='boolean')throw new Error('Invalid archive existence flag.');
  const ref=value.resolvedRef;if(ref!==undefined&&ref!=='INDEX'&&!/^[a-f0-9]{40,64}$/.test(ref))throw new Error('Invalid archived commit.');
  return {source:source(value.source),label:text(value.label,'label',16000),text:content,savedText:text(value.savedText,'saved contents'),initialText:text(value.initialText,'initial contents'),language:text(value.language,'language',100),exists:value.exists,resolvedRef:ref,sha256:value.sha256};
}
export function parseArchive(data:string):Archive{
  if(Buffer.byteLength(data)>ARCHIVE_LIMIT)throw new Error('Session archive exceeds the 256 MB limit.');
  let raw:any;try{raw=JSON.parse(data);}catch{throw new Error('This is not a valid .diff_studio JSON file.');}
  object(raw,'file');if(raw.format!=='diff-studio/session'||raw.version!==1)throw new Error('Unsupported .diff_studio format or version.');
  const ids=new Set<string>();const sessions:SavedSession[]=array(raw.sessions,'comparisons').map(s=>{
    object(s,'comparison');const id=text(s.id,'comparison ID',128);if(ids.has(id))throw new Error('Duplicate archive comparison ID.');ids.add(id);
    const left=document(s.left),right=document(s.right),commentIds=new Set<string>();
    const comments:LineComment[]=array(s.comments,'comments').map(c=>{
      object(c,'comment');if(!['left','right'].includes(c.side)||!Number.isInteger(c.line)||c.line<1||c.line>lines(c.side==='left'?left.text:right.text).length)throw new Error('Invalid archive comment line.');
      const id=text(c.id,'comment ID',128);if(commentIds.has(id))throw new Error('Duplicate comment ID.');commentIds.add(id);
      if(c.author!==undefined&&!['user','agent'].includes(c.author))throw new Error('Invalid comment author.');
      if(c.resolved!==undefined&&typeof c.resolved!=='boolean')throw new Error('Invalid comment resolution.');
      const replyIds=new Set<string>();const replies=array(c.replies??[],'comment replies',100).map(r=>{object(r,'reply');const id=text(r.id,'reply ID',128);if(replyIds.has(id)||!['user','agent'].includes(r.author))throw new Error('Invalid comment reply.');replyIds.add(id);return {id,body:text(r.body,'reply body',10000),author:r.author as 'user'|'agent',createdAt:text(r.createdAt,'reply date',100)};});
      return {id,author:c.author,resolved:c.resolved??false,replies,side:c.side,line:c.line,body:text(c.body,'comment',10000),anchor:text(c.anchor,'comment anchor'),outdated:c.outdated===true,createdAt:text(c.createdAt,'comment date',100),updatedAt:text(c.updatedAt,'comment date',100)};
    });
    const activity:Activity[]=array(s.activity,'activity',100).map(a=>{object(a,'activity');if(!['info','edit','save'].includes(a.kind))throw new Error('Invalid activity kind.');return {time:text(a.time,'activity date',100),message:text(a.message,'activity message',10000),kind:a.kind};});
    return {id,title:text(s.title,'title',16000),left,right,comments,activity};
  });
  const groups:SavedGroup[]=array(raw.groups,'groups').map(g=>({id:text(g.id,'group ID',128),label:text(g.label,'group label',16000),entries:array(g.entries,'changed files').map(e=>{object(e,'changed file');
    const unavailable=e.unavailable===undefined?undefined:text(e.unavailable,'unavailable reason',10000);
    if(unavailable!==undefined){if(!unavailable.trim()||e.sessionId!==undefined)throw new Error('Invalid unavailable archive file.');}
    else if(!ids.has(e.sessionId))throw new Error('Archive file references a missing comparison.');
    return {path:text(e.path,'changed path',16000),status:text(e.status,'change status',10),oldPath:e.oldPath===undefined?undefined:text(e.oldPath,'old path',16000),sessionId:e.sessionId,unavailable};})}));
  if(raw.active!==undefined&&!ids.has(raw.active))throw new Error('Archive active comparison is missing.');
  return {format:'diff-studio/session',version:1,createdAt:text(raw.createdAt,'creation date',100),active:raw.active,sessions,groups};
}
export async function readArchive(file:string){const info=await fs.stat(file);if(info.size>ARCHIVE_LIMIT)throw new Error('Session archive exceeds the 256 MB limit.');return parseArchive(await fs.readFile(file,'utf8'));}
export function importArchive(studio:Studio,archive:Archive){
  const ids=new Map<string,string>();const imported:Session[]=[];
  const document=(d:SavedDocument):DocumentState=>({source:{kind:'text',text:d.text,label:d.label},origin:d.source,label:d.label,text:d.text,savedText:d.savedText,initialText:d.initialText,resolvedRef:d.resolvedRef,version:d.exists?hash(d.savedText):'missing',language:d.language,exists:d.exists,writable:false,dirty:false,archived:true});
  for(const entry of archive.sessions){const id=randomUUID();ids.set(entry.id,id);const session:Session={id,title:entry.title,left:document(entry.left),right:document(entry.right),comments:structuredClone(entry.comments),activity:structuredClone(entry.activity),archived:true};studio.sessions.set(id,session);imported.push(session);}
  for(const group of archive.groups){const restored:ComparisonGroup={id:randomUUID(),label:group.label,entries:group.entries.map(e=>{if(e.unavailable){const placeholder:Source={kind:'text',label:e.path,text:''};return {...e,left:placeholder,right:placeholder};}const id=ids.get(e.sessionId!)!;const s=studio.get(id);return {...e,sessionId:id,left:s.left.source,right:s.right.source};})};studio.groups.set(restored.id,restored);}
  return {sessions:imported,active:archive.active?ids.get(archive.active):imported[0]?.id};
}
async function safeFile(repo:string,relative:string){
  if(!relative||relative.split(/[\\/]/).some(part=>part==='..'||part.toLowerCase()==='.git')||path.isAbsolute(relative)||relative.includes('\\'))throw new Error('Archive path is outside the selected repository.');
  const target=path.resolve(repo,relative);let probe=target;
  while(true){try{const actual=await fs.realpath(probe);const delta=path.relative(repo,actual);if(delta==='..'||delta.startsWith('..'+path.sep)||path.isAbsolute(delta)||delta.split(path.sep).some(part=>part.toLowerCase()==='.git'))throw new Error('Archive path resolves outside the selected repository.');break;}catch(e:any){if(e.code!=='ENOENT')throw e;const parent=path.dirname(probe);if(parent===probe)throw e;probe=parent;}}
  return target;
}
export async function linkRepository(studio:Studio,sessions:Session[],repoInput:string,originalRepo:string){
  const repo=await fs.realpath(await studio.git.root(repoInput));let linked=0,detached=0;
  for(const session of sessions){
    const gitDocs=[session.left,session.right].filter(d=>d.origin?.kind==='git'&&d.origin.repo===originalRepo);if(!gitDocs.length)continue;
    let commitsMatch=true;
    for(const d of gitDocs){const origin=d.origin as Extract<Source,{kind:'git'}>;try{if(!d.resolvedRef||d.resolvedRef==='INDEX')throw new Error('No fixed commit');const bytes=await studio.git.read(repo,origin.path,d.resolvedRef);if((bytes?.toString()??'')!==(d.initialText??d.text))throw new Error('Content mismatch');}catch{commitsMatch=false;}}
    for(const d of [session.left,session.right]){
      if(d.origin?.kind!=='file'||!d.archived)continue;
      try{
        if(!commitsMatch)throw new Error('Commit mismatch');
        const relative=gitRelativePath(originalRepo,d.origin.uri);const candidate=await safeFile(repo,relative);const bytes=await studio.io.read(candidate);
        if((bytes===null)!==!d.exists||(bytes?.toString()??'')!==d.savedText)throw new Error('Working content mismatch');
        d.source={kind:'file',uri:candidate,allowMissing:true};d.version=bytes===null?'missing':hash(bytes);d.writable=true;d.archived=false;d.dirty=d.text!==d.savedText;linked++;
      }catch{detached++;}
    }
  }
  return {linked,detached};
}
