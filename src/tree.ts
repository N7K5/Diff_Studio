import type {ChangeEntry} from './types';
export interface ChangeNode {name:string;path:string;children:ChangeNode[];entry?:ChangeEntry}
export function changeTree(entries:ChangeEntry[]):ChangeNode[]{
  const root:ChangeNode={name:'',path:'',children:[]};
  for(const entry of entries){
    const parts=entry.path.split('/');let parent=root;
    for(let i=0;i<parts.length;i++){
      const name=parts[i],leaf=i===parts.length-1;
      let node=parent.children.find(n=>n.name===name&&!!n.entry===leaf);
      if(!node){node={name,path:parts.slice(0,i+1).join('/'),children:[],...(leaf?{entry}:{})};parent.children.push(node);}
      parent=node;
    }
  }
  function sort(nodes:ChangeNode[]){nodes.sort((a,b)=>Number(!!a.entry)-Number(!!b.entry)||a.name.localeCompare(b.name));for(const node of nodes)sort(node.children);}
  sort(root.children);return root.children;
}
