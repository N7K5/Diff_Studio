import type {LineComment} from './types';
export const lines=(text:string)=>text.split(/\r\n|\r|\n/);
// Keep comments on unchanged lines. Flag comments whose original line was replaced.
export function moveComments(comments:LineComment[],side:'left'|'right',before:string,after:string){
  if(before===after)return;
  const a=lines(before),b=lines(after);let start=0,end=0;
  while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
  for(const comment of comments.filter(c=>c.side===side)){
    if(comment.line<=start)continue;
    if(comment.line>a.length-end)comment.line+=b.length-a.length;
    else {comment.line=Math.max(1,Math.min(b.length,start+1));comment.outdated=true;}
  }
}
