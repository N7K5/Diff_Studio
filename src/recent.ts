import {createHash} from 'node:crypto';
import type {CompareRequest, Source} from './types';

export interface RecentEntry<T> {id:string; key:string; title:string; value:T; time:string}
export class RecentList<T> {
  items:RecentEntry<T>[];
  constructor(private limit:number, entries:RecentEntry<T>[]=[]){this.items=entries;this.resize(limit);}
  resize(limit:number){
    if(!Number.isInteger(limit)||limit<0||limit>100)throw new Error('History limit must be an integer from 0 to 100.');
    this.limit=limit;this.items=this.items.slice(0,limit);
  }
  add(key:string,title:string,value:T){
    const entry={id:createHash('sha256').update(key).digest('hex'),key,title,value,time:new Date().toISOString()};
    this.items=[entry,...this.items.filter(item=>item.key!==key)].slice(0,this.limit);return entry;
  }
  remove(id:string){this.items=this.items.filter(item=>item.id!==id);}
}
export type ComparisonTarget =
 | {type:'open';request:CompareRequest}
 | {type:'directories';left:string;right:string}
 | {type:'gitCompare';repo:string;path:string;mode:string;leftRef:string;rightRef:string}
 | {type:'gitChanges';repo:string;base:string;mode:string;mergeBase:boolean};
const sourceKey=(s:Source)=>s.kind==='file'?['file',s.uri]:s.kind==='git'?['git',s.repo,s.path,s.ref]:['text',s.label,s.text];
export function comparisonKey(target:ComparisonTarget){return target.type==='open'?JSON.stringify(['open',sourceKey(target.request.left),sourceKey(target.request.right)]):JSON.stringify(target);}
export function persistable(target:ComparisonTarget){return target.type!=='open'||(target.request.left.kind!=='text'&&target.request.right.kind!=='text');}
export function comparisonDescription(target:ComparisonTarget){
  const describe=(s:Source)=>s.kind==='file'?s.uri:s.kind==='git'?`${s.repo}/${s.path} @ ${s.ref}`:s.label;
  if(target.type==='open')return `${describe(target.request.left)} ↔ ${describe(target.request.right)}`;
  if(target.type==='directories')return `${target.left} ↔ ${target.right}`;
  return target.type==='gitCompare'?`${target.repo}/${target.path} · ${target.leftRef} ↔ ${target.mode==='gitRevisions'?target.rightRef:'working tree'}`:`${target.repo} · ${target.base||'default base'} · ${target.mode}`;
}
