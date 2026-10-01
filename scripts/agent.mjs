#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
const args=process.argv.slice(2);const bridgeIndex=args.indexOf('--bridge');
const descriptor=bridgeIndex>=0?args.splice(bridgeIndex,2)[1]:process.env.DIFF_STUDIO_BRIDGE;
const [command,...rest]=args;
const usage=`Diff Studio agent CLI (Node 18+)
  --bridge PATH (or DIFF_STUDIO_BRIDGE) points to the descriptor shown by Start Agent Bridge.
  list
  groups                                  List all saved file trees
  project REPO [BASE=HEAD] [TARGET=WORKING] Show a full Git changed-file tree
  folders LEFT RIGHT                      Show a folder comparison tree
  comments [SESSION]                      Read comments, replies and resolution state
  reply SESSION COMMENT_ID "Reply text"
  resolve SESSION COMMENT_ID
  reopen SESSION COMMENT_ID
  open LEFT RIGHT                         Local paths or ssh://host/absolute/path
  git REPO FILE REF                       Revision vs editable working file
  revisions REPO FILE LEFT_REF RIGHT_REF
  note SESSION "What I am changing and why"
  edit SESSION left|right CONTENT_FILE ["Explanation"]
  comment SESSION left|right LINE "Comment text"
  comment-remove SESSION COMMENT_ID
  save SESSION left|right
  reload SESSION
  reveal SESSION
  request JSON_FILE                       Raw /open request with file/git/text sources

Edits appear immediately in the studio; save is explicit. Existing SSH configuration is used.`;
if(!command||command==='--help'){console.log(usage);process.exit(0);}
try {
 if(!descriptor)throw new Error('Start the bridge in VS Code, then pass --bridge PATH.');
 const {url,token}=JSON.parse(await readFile(descriptor,'utf8'));
 const endpoint=new URL(url);if(endpoint.hostname!=='127.0.0.1'||endpoint.protocol!=='http:')throw new Error('Invalid bridge URL.');
 const request=async(route,body)=>{const r=await fetch(url+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const result=await r.json();if(!r.ok)throw new Error(result.error||r.statusText);return result;};
 const file=uri=>({kind:'file',uri});let result;
 if(command==='list')result=await request('/sessions');
 else if(command==='groups')result=await request('/groups');
 else if(command==='project')result=await request('/project',{repo:rest[0],leftRef:rest[1]||'HEAD',rightRef:rest[2]||'WORKING'});
 else if(command==='folders')result=await request('/folders',{left:rest[0],right:rest[1]});
 else if(command==='comments')result=await request('/comments'+(rest[0]?'?session='+encodeURIComponent(rest[0]):''));
 else if(command==='reply')result=await request('/reply',{id:rest[0],commentId:rest[1],body:rest.slice(2).join(' ')});
 else if(command==='resolve'||command==='reopen')result=await request('/resolve',{id:rest[0],commentId:rest[1],resolved:command==='resolve'});
 else if(command==='open')result=await request('/open',{left:file(rest[0]),right:file(rest[1])});
 else if(command==='git'||command==='revisions'){const [repo,path,ref,rightRef]=rest;result=await request('/open',{left:{kind:'git',repo,path,ref},right:command==='git'?{...file(repo.replace(/\/$/,'')+'/'+path),allowMissing:true}:{kind:'git',repo,path,ref:rightRef}});}
 else if(command==='request')result=await request('/open',JSON.parse(await readFile(rest[0],'utf8')));
 else if(command==='note')result=await request('/note',{id:rest[0],message:rest.slice(1).join(' ')});
 else if(command==='comment')result=await request('/comment',{id:rest[0],side:rest[1],line:Number(rest[2]),body:rest.slice(3).join(' ')});
 else if(command==='comment-remove')result=await request('/comment-remove',{id:rest[0],commentId:rest[1]});
 else if(command==='edit'){const [id,side,contentFile,...message]=rest;if(!['left','right'].includes(side))throw new Error('Side must be left or right');const sessions=await request('/sessions');const session=sessions.find(s=>s.id===id);if(!session)throw new Error('Session not found');result=await request('/edit',{id,side,text:await readFile(contentFile,'utf8'),expectedHash:session[side].hash,message:message.join(' ')||`Agent updating ${side} from ${contentFile}`});}
 else if(['save','reload','reveal'].includes(command))result=await request('/'+command,{id:rest[0],side:rest[1]});
 else throw new Error(usage);
 console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
