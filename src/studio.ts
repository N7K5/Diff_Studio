import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {Transport, hash, decode, joinLocation} from './transport';
import {GitService} from './git';
import {lines,moveComments} from './comments';
import {comparisonKey} from './recent';
import {Source, DocumentState, Session, CompareRequest, ChangeEntry, ComparisonGroup, LineComment, languageFor} from './types';
export class Studio {
  readonly sessions=new Map<string,Session>();
  readonly git:GitService;
  readonly groups=new Map<string,ComparisonGroup>();
  onChange: (session:Session, reason:string)=>void = ()=>{};
  private locks=new Map<string,Promise<unknown>>();
  constructor(readonly io=new Transport()){this.git=new GitService(io);}
  async document(source:Source):Promise<DocumentState> {
    if(!source||!['file','git','text'].includes(source.kind))throw new Error('Source must be file, git or text.');
    let bytes:Buffer|null;let label:string;let resolvedRef:string|undefined;
    if(source.kind==='text'){if(typeof source.text!=='string')throw new Error('Text source requires text.');bytes=Buffer.from(source.text);label=source.label || 'Snapshot';}
    else if(source.kind==='git'){resolvedRef=source.ref==='INDEX'?'INDEX':await this.git.resolve(source.repo,source.ref);bytes=await this.git.read(source.repo,source.path,resolvedRef);label=`${source.path} · ${source.ref==='INDEX'?'INDEX':source.ref.slice(0,24)}`;}
    else {bytes=await this.io.read(source.uri);if(bytes===null&&!source.allowMissing)throw new Error(`File does not exist: ${source.uri}`);label=source.uri;}
    const text=bytes===null?'':decode(bytes,this.io.maxBytes);
    return {source,label,text,savedText:text,initialText:text,resolvedRef,version:bytes===null?'missing':hash(bytes),writable:source.kind==='file',language:languageFor(source.kind==='git'?source.path:label),exists:bytes!==null,dirty:false};
  }
  async open(request:CompareRequest):Promise<Session> {
    const [left,right]=await Promise.all([this.document(request.left),this.document(request.right)]);
    const session:Session={id:randomUUID(),title:request.title||`${path.basename(left.label)} ↔ ${path.basename(right.label)}`,left,right,activity:[],comments:[]};
    this.sessions.set(session.id,session);this.note(session.id,'Comparison opened');this.onChange(session,'open');return session;
  }
  async captureGroup(label:string,entries:ChangeEntry[],reuse=false):Promise<ComparisonGroup>{
    // Capture supported text independently: an unavailable file must not discard its neighbors.
    const snapshots:(Session|undefined)[]=new Array(entries.length);let cursor=0;
    const captured=entries.map(entry=>({...entry,sessionId:undefined}));
    await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{
      while(cursor<entries.length){const index=cursor++,entry=captured[index];if(entry.unavailable)continue;
        try{const prior=reuse?[...this.sessions.values()].find(s=>!s.archived&&comparisonKey({type:'open',request:entry})===comparisonKey({type:'open',request:{left:s.left.source,right:s.right.source}})):undefined;
          if(prior){snapshots[index]=prior;continue;}
          const [left,right]=await Promise.all([this.document(entry.left),this.document(entry.right)]);snapshots[index]={id:randomUUID(),title:entry.path,left,right,activity:[],comments:[]};}
        catch(error){entry.unavailable=(error instanceof Error?error.message:String(error)).slice(0,10000)||'This file could not be opened.';}
      }
    }));
    const group:ComparisonGroup={id:randomUUID(),label,entries:captured.map((entry,index)=>({...entry,sessionId:snapshots[index]?.id}))};
    for(const snapshot of snapshots)if(snapshot)this.sessions.set(snapshot.id,snapshot);this.groups.set(group.id,group);return group;
  }
  comment(id:string,side:'left'|'right',line:number,body:string,commentId?:string,author:'user'|'agent'='user'):LineComment{
    const s=this.get(id);if(!['left','right'].includes(side))throw new Error('Choose the left or right pane.');
    if(!Number.isInteger(line)||line<1||line>lines(s[side].text).length)throw new Error('Choose an existing line.');
    if(typeof body!=='string'||!body.trim()||body.length>10000)throw new Error('Comments must contain 1 to 10000 characters.');
    const existing=commentId?s.comments.find(c=>c.id===commentId):undefined;if(commentId&&!existing)throw new Error('Comment not found.');
    const now=new Date().toISOString();const comment:LineComment=existing?{...existing,body:body.trim(),updatedAt:now}:{id:randomUUID(),side,line,body:body.trim(),author,resolved:false,replies:[],anchor:lines(s[side].text)[line-1],outdated:false,createdAt:now,updatedAt:now};
    if(existing)s.comments[s.comments.indexOf(existing)]=comment;else s.comments.push(comment);
    this.onChange(s,'comments');return comment;
  }
  removeComment(id:string,commentId:string){const s=this.get(id);s.comments=s.comments.filter(c=>c.id!==commentId);this.onChange(s,'comments');}
  reply(id:string,commentId:string,body:string,author:'user'|'agent'='user'){
    const s=this.get(id),comment=s.comments.find(c=>c.id===commentId);if(!comment)throw new Error('Comment not found.');
    if(typeof body!=='string'||!body.trim()||body.length>10000)throw new Error('Replies must contain 1 to 10000 characters.');
    if((comment.replies?.length||0)>=100)throw new Error('This comment has reached its 100 reply limit.');
    const reply={id:randomUUID(),body:body.trim(),author,createdAt:new Date().toISOString()};(comment.replies??=[]).push(reply);comment.updatedAt=reply.createdAt;this.onChange(s,'comments');return reply;
  }
  resolveComment(id:string,commentId:string,resolved:boolean){
    if(typeof resolved!=='boolean')throw new Error('Resolved must be true or false.');
    const s=this.get(id),comment=s.comments.find(c=>c.id===commentId);if(!comment)throw new Error('Comment not found.');comment.resolved=resolved;comment.updatedAt=new Date().toISOString();this.onChange(s,'comments');return comment;
  }
  get(id:string):Session {const s=this.sessions.get(id);if(!s)throw new Error('Comparison not found. Open a comparison first.');return s;}
  note(id:string,message:string,kind:'info'|'edit'|'save'='info'):void {if(typeof message!=='string'||message.length>10000)throw new Error('Activity message must contain at most 10000 characters.');const s=this.get(id);s.activity.push({time:new Date().toISOString(),message,kind});s.activity=s.activity.slice(-100);this.onChange(s,'activity');}
  edit(id:string,side:'left'|'right',text:string,expected?:string):Session {
    if(!['left','right'].includes(side))throw new Error('Side must be left or right.');
    const s=this.get(id);const d=s[side];if(!d.writable)throw new Error('Git revisions and snapshots are read-only. Edit the working file.');
    if(typeof text!=='string'||Buffer.byteLength(text)>this.io.maxBytes)throw new Error('Edited text exceeds the file size limit.');
    if(expected && hash(d.text)!==expected)throw new Error('The editor changed since the agent read it. Read the session and retry.');
    moveComments(s.comments,side,d.text,text);d.text=text;d.dirty=text!==d.savedText;this.onChange(s,'edit');return s;
  }
  async save(id:string,side:'left'|'right'):Promise<Session> {
    if(!['left','right'].includes(side))throw new Error('Side must be left or right.');
    return this.serial(`${id}:${side}`,async()=>{
      const s=this.get(id);const d=s[side];if(d.source.kind!=='file')throw new Error('This side is read-only.');
      const text=d.text;await this.io.write(d.source.uri,Buffer.from(text),d.version);
      d.version=hash(text);d.savedText=text;d.exists=true;d.dirty=d.text!==text;this.note(id,`Saved ${side}: ${d.label}`,'save');this.onChange(s,'save');return s;
    });
  }
  async reload(id:string,discard=false):Promise<Session> {
    const s=this.get(id);if((s.left.dirty||s.right.dirty)&&!discard)throw new Error('Unsaved edits exist. Save them or explicitly discard before reloading.');
    const load=async(d:DocumentState)=>d.archived?structuredClone(d):{...await this.document(d.source),origin:d.origin};const [left,right]=await Promise.all([load(s.left),load(s.right)]);moveComments(s.comments,'left',s.left.text,left.text);moveComments(s.comments,'right',s.right.text,right.text);left.initialText=s.left.initialText;right.initialText=s.right.initialText;s.left=left;s.right=right;this.note(id,'Reloaded both sources');this.onChange(s,'reload');return s;
  }
  async refreshClean():Promise<void> {
    for(const s of this.sessions.values())for(const side of ['left','right'] as const){const d=s[side];if(d.source.kind!=='file'||d.dirty)continue;try{const fresh=await this.document({...d.source,allowMissing:true});if(!d.dirty && s[side]===d && fresh.version!==d.version){moveComments(s.comments,side,d.text,fresh.text);fresh.initialText=d.initialText;fresh.origin=d.origin;s[side]=fresh;this.note(s.id,`External change detected: ${d.label}`);this.onChange(s,'external');}}catch{/* Explicit reload surfaces transient connectivity errors. */}}
  }
  async directories(left:string,right:string):Promise<ChangeEntry[]> {
    const [a,b]=await Promise.all([this.io.list(left),this.io.list(right)]);const entries:ChangeEntry[]=[];const leftFiles=new Set(a),rightFiles=new Set(b);
    for(const file of [...new Set([...a,...b])].sort()){
      const l=joinLocation(left,file),r=joinLocation(right,file);
      const entry:ChangeEntry={status:!leftFiles.has(file)?'A':!rightFiles.has(file)?'D':'M',path:file,left:{kind:'file',uri:l,allowMissing:true},right:{kind:'file',uri:r,allowMissing:true}};
      try{const [x,y]=await Promise.all([this.io.read(l),this.io.read(r)]);if(x!==null&&y!==null&&x.equals(y))continue;entry.status=x===null?'A':y===null?'D':'M';}
      catch(error){entry.unavailable=(error instanceof Error?error.message:String(error)).slice(0,10000)||'This file could not be read.';}
      entries.push(entry);
    }return entries;
  }
  private async serial<T>(key:string,fn:()=>Promise<T>):Promise<T>{const prior=this.locks.get(key)||Promise.resolve();const next=prior.catch(()=>{}).then(fn);this.locks.set(key,next);try{return await next;}finally{if(this.locks.get(key)===next)this.locks.delete(key);}}
}
