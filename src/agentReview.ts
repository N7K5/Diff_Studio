import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {promises as fs} from 'node:fs';
import {Studio} from './studio';
import {comparisonKey} from './recent';
import {joinLocation,localPath} from './transport';
import type {ChangeEntry,ComparisonGroup,CompareRequest,Session,Source} from './types';

const key=(request:CompareRequest)=>comparisonKey({type:'open',request});
export class AgentReview {
 private group?:ComparisonGroup;
 private entries=new Map<string,ChangeEntry>();
 private opening=new Map<string,Promise<Session>>();
 constructor(private studio:Studio,private changed:(group:ComparisonGroup,show?:boolean)=>void){}
 clear(){this.group=undefined;this.entries.clear();this.opening.clear();}
 async open(request:CompareRequest,replace=false){
  const generation=this.studio.generation;
  const normalize=async(source:Source):Promise<Source>=>{
   if(source.kind==='git'){const repo=await this.studio.git.root(source.repo);return {...source,repo,ref:source.ref==='INDEX'?'INDEX':await this.studio.git.resolve(repo,source.ref)};}
   if(source.kind==='file'&&!source.uri.startsWith('ssh:')){const file=localPath(source.uri);const uri=await fs.realpath(file).catch(async()=>path.join(await fs.realpath(path.dirname(file)).catch(()=>path.dirname(file)),path.basename(file)));return {...source,uri};}
   return source;
  };
  request={...request,left:await normalize(request.left),right:await normalize(request.right)};
  this.studio.ensureGeneration(generation);
  const id=key(request);const pending=this.opening.get(id);if(pending)return pending;
  const work=this.openOne(request,replace);this.opening.set(id,work);try{return await work;}finally{if(this.opening.get(id)===work)this.opening.delete(id);}
 }
 private async openOne(request:CompareRequest,replace:boolean){
  const existing=[...this.studio.sessions.values()].find(s=>!s.archived&&key({left:s.left.source,right:s.right.source})===key(request));
  const session=existing||await this.studio.open(request);
  if(existing&&!existing.left.dirty&&!existing.right.dirty)await this.studio.reload(existing.id);
  this.add([{path:session.title,status:!session.left.exists?'A':!session.right.exists?'D':'M',left:session.left.source,right:session.right.source,sessionId:session.id}],replace);
  return session;
 }
 async project(repo:string,leftRef='HEAD',rightRef='WORKING',replace=false){
  const generation=this.studio.generation;
  const selection=await this.studio.git.selection(repo,'',leftRef,rightRef);
  this.studio.ensureGeneration(generation);
  return this.capture(`${selection.repo} · ${leftRef} ↔ ${rightRef}`,selection.entries||[],replace);
 }
 async folders(left:string,right:string,replace=false){const generation=this.studio.generation;const entries=await this.studio.directories(left,right);this.studio.ensureGeneration(generation);return this.capture(`${left} ↔ ${right}`,entries,replace);}
 async changes(label:string,comparisons:ChangeEntry[],replace=false){
  if(typeof label!=='string'||!label.trim()||label.length>1000||!Array.isArray(comparisons)||comparisons.length>10000)throw new Error('Provide a label and up to 10000 comparisons.');
  for(const entry of comparisons)if(!entry||typeof entry.path!=='string'||!entry.path.trim()||!entry.left||!entry.right)throw new Error('Each comparison requires path, left and right sources.');
  return this.capture(label,comparisons.map(e=>({...e,status:e.status||'M'})),replace);
 }
 private async capture(label:string,entries:ChangeEntry[],replace=false){
  const group=await this.studio.captureGroup(label,entries,true);this.add(group.entries,replace);this.changed(group,replace);return group;
 }
 private location(entry:ChangeEntry){
  const source:Source=entry.right.kind==='text'?entry.left:entry.right;
  if(source.kind==='git')return joinLocation(source.repo,source.path);
  if(source.kind==='file')return source.uri.startsWith('ssh:')?source.uri:path.resolve(source.uri);
  return `snapshots/${entry.path.replaceAll('\\','/')}`;
 }
 private add(entries:ChangeEntry[],replace=false){
  if(replace)this.entries.clear();
  for(const entry of entries)this.entries.set(key(entry),entry);
  if(!this.group){this.group={id:randomUUID(),label:'Agent files',entries:[]};this.studio.groups.set(this.group.id,this.group);}
  const values=[...this.entries.values()];const locations=values.map(e=>this.location(e).split('/'));
  const common=locations[0]?.slice(0,-1)||[];
  while(common.length&&!locations.every(parts=>common.every((part,i)=>parts[i]===part)&&parts.length>common.length))common.pop();
  const names=locations.map(parts=>parts.slice(common.length).filter(Boolean).join('/'));
  this.group.entries=values.map((entry,index)=>({...entry,path:names.filter(n=>n===names[index]).length>1?`${names[index]} [${entry.sessionId?.slice(0,8)||index+1}]`:names[index]}));
  this.changed(this.group,replace);
 }
}
