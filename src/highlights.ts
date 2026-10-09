import {randomUUID} from 'node:crypto';
import {lines} from './comments';
import type {HighlightSet,HighlightRange,Session} from './types';

const text=(value:unknown,name:string,max=1000)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(`Highlight ${name} must contain 1 to ${max} characters.`);return value.trim();};
const id=(value:unknown)=>{if(typeof value!=='string'||!/^[\w-]{1,128}$/.test(value))throw new Error('Invalid highlight ID.');return value;};
const color=(value:unknown)=>{if(typeof value!=='string'||!/^#[0-9a-f]{6}$/i.test(value))throw new Error('Highlight color must be a six-digit hex color, such as #e5a84b.');return value.toLowerCase();};

/** Validate the entire batch before any annotations or comments are changed. */
export function prepareHighlights(input:any,get:(id:string)=>{left:{text:string};right:{text:string};comments:Session['comments']},saved=false):HighlightSet&{ranges:(HighlightRange&{comment?:string})[]}{
 if(!input||typeof input!=='object'||!Array.isArray(input.ranges)||!input.ranges.length||input.ranges.length>1000)throw new Error('Provide 1 to 1000 highlight ranges.');
 const rangeIds=new Set<string>();
 return {id:saved?id(input.id):input.id===undefined?randomUUID():id(input.id),label:text(input.label,'label'),color:color(input.color??(saved?undefined:'#e5a84b')),ranges:input.ranges.map((r:any)=>{
  if(!r||typeof r!=='object')throw new Error('Invalid highlight range.');
  const sessionId=text(r.sessionId,'comparison ID',128),session=get(sessionId);
  if(r.side!=='left'&&r.side!=='right')throw new Error('Highlight side must be left or right.');
  const side=r.side as 'left'|'right',endLine=r.endLine??r.startLine;
  if(!Number.isInteger(r.startLine)||!Number.isInteger(endLine)||r.startLine<1||endLine<r.startLine||endLine>lines(session[side].text).length)throw new Error('Highlight range must use existing 1-based lines, with endLine at or after startLine.');
  if(saved&&r.comment!==undefined)throw new Error('Saved highlights must reference stored comment threads.');
  if(r.comment!==undefined&&r.commentId!==undefined)throw new Error('Use comment or commentId, not both.');
  if(r.commentId!==undefined&&!session.comments.some(c=>c.id===r.commentId&&c.side===side))throw new Error('Highlight comment must belong to the same comparison and side.');
  if(r.outdated!==undefined&&typeof r.outdated!=='boolean')throw new Error('Invalid highlight outdated flag.');
  const rangeId=saved?id(r.id):randomUUID();if(rangeIds.has(rangeId))throw new Error('Duplicate highlight range ID.');rangeIds.add(rangeId);
  return {id:rangeId,sessionId,side,startLine:r.startLine,endLine,label:r.label===undefined||r.label===''?'':text(r.label,'range label'),color:r.color===undefined?undefined:color(r.color),commentId:r.commentId,outdated:saved&&r.outdated===true,...(r.comment===undefined?{}:{comment:text(r.comment,'comment',10000)})};
 })};
}

/** Preserve untouched ranges; explicitly flag ranges crossed by an edit. */
export function moveHighlights(sets:Iterable<HighlightSet>,sessionId:string,side:'left'|'right',before:string,after:string){
 if(before===after)return;
 const a=lines(before),b=lines(after);let prefix=0,suffix=0;
 while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
 while(suffix<a.length-prefix&&suffix<b.length-prefix&&a[a.length-1-suffix]===b[b.length-1-suffix])suffix++;
 const delta=b.length-a.length;
 for(const set of sets)for(const range of set.ranges){
  if(range.sessionId!==sessionId||range.side!==side||range.endLine<=prefix)continue;
  if(range.startLine>a.length-suffix){range.startLine+=delta;range.endLine+=delta;continue;}
  range.outdated=true;
  range.startLine=Math.max(1,Math.min(b.length,range.startLine<=prefix?range.startLine:prefix+1));
  range.endLine=Math.max(range.startLine,Math.min(b.length,range.endLine>a.length-suffix?range.endLine+delta:b.length-suffix));
 }
}
