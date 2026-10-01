import http from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {Studio} from './studio';
import {AgentReview} from './agentReview';
import type {ComparisonGroup} from './types';
import {hash} from './transport';

export class AgentBridge {
  private server?:http.Server;
  private descriptor?:string;
  private token=randomBytes(32).toString('hex');
  private review:AgentReview;
  constructor(private studio:Studio, private reveal:(id:string,force?:boolean)=>void = ()=>{},changed:(group:ComparisonGroup)=>void=()=>{}) {this.review=new AgentReview(studio,changed);}
  async start(directory:string):Promise<string> {
    if(this.descriptor)return this.descriptor;
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    this.server=http.createServer((req,res)=>{void this.handle(req,res);});
    await new Promise<void>((resolve,reject)=>{this.server!.once('error',reject);this.server!.listen(0,'127.0.0.1',()=>resolve());});
    const address=this.server.address();if(!address||typeof address==='string')throw new Error('Bridge failed to bind.');
    this.descriptor=path.join(directory,`agent-${process.pid}-${address.port}.bridge.json`);
    await fs.writeFile(this.descriptor,JSON.stringify({url:`http://127.0.0.1:${address.port}`,token:this.token,pid:process.pid}),{mode:0o600});
    return this.descriptor;
  }
  async stop():Promise<void>{const server=this.server;this.server=undefined;if(server){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}if(this.descriptor)await fs.rm(this.descriptor,{force:true});this.descriptor=undefined;}
  private async handle(req:http.IncomingMessage,res:http.ServerResponse):Promise<void>{
    res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
    const reply=(code:number,value:unknown)=>{res.writeHead(code);res.end(JSON.stringify(value));};
    // Reject browser requests, even from local pages. No CORS is enabled.
    const actual=Buffer.from(req.headers.authorization||'');const expected=Buffer.from(`Bearer ${this.token}`);
    if(req.headers.origin || actual.length!==expected.length || !timingSafeEqual(actual,expected)){reply(401,{error:'Unauthorized'});return;}
    try{
      const url=new URL(req.url||'/','http://127.0.0.1');
      if(req.method==='GET'&&url.pathname==='/sessions'){reply(200,[...this.studio.sessions.values()].map(s=>this.view(s.id)));return;}
      if(req.method==='GET'&&url.pathname==='/groups'){reply(200,[...this.studio.groups.values()]);return;}
      if(req.method==='GET'&&url.pathname==='/comments'){const id=url.searchParams.get('session');const sessions=id?[this.studio.get(id)]:[...this.studio.sessions.values()];reply(200,sessions.flatMap(s=>s.comments.map(comment=>({sessionId:s.id,title:s.title,left:s.left.label,right:s.right.label,...comment}))));return;}
      if(req.method!=='POST'){reply(404,{error:'Not found'});return;}
      let bytes=0;const chunks:Buffer[]=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>this.studio.io.maxBytes*2+65536)throw new Error('Request too large');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString());let result:unknown;
      switch(url.pathname){
        case '/open': {const s=await this.review.open(body);this.reveal(s.id);result=this.view(s.id);break;}
        case '/project':{const group=await this.review.project(body.repo,body.leftRef,body.rightRef);const first=group.entries.find(e=>e.sessionId);if(first)this.reveal(first.sessionId!);result=group;break;}
        case '/folders':{const group=await this.review.folders(body.left,body.right);const first=group.entries.find(e=>e.sessionId);if(first)this.reveal(first.sessionId!);result=group;break;}
        case '/reply':this.studio.reply(body.id,body.commentId,body.body,'agent');result=this.view(body.id);break;
        case '/resolve':this.studio.resolveComment(body.id,body.commentId,body.resolved);result=this.view(body.id);break;
        case '/note':this.studio.note(body.id,body.message);this.reveal(body.id);result={ok:true};break;
        case '/edit': {
          if(typeof body.expectedHash!=='string'||!body.expectedHash)throw new Error('expectedHash is required; read the session before editing.');
          if(body.message)this.studio.note(body.id,body.message,'edit');
          this.studio.edit(body.id,body.side,body.text,body.expectedHash);this.reveal(body.id);result=this.view(body.id);break;
        }
        case '/comment':this.studio.comment(body.id,body.side,body.line,body.body,body.commentId,'agent');this.reveal(body.id);result=this.view(body.id);break;
        case '/comment-remove':this.studio.removeComment(body.id,body.commentId);this.reveal(body.id);result=this.view(body.id);break;
        case '/save':await this.studio.save(body.id,body.side);result=this.view(body.id);break;
        case '/reload':await this.studio.reload(body.id,body.discard===true);result=this.view(body.id);break;
        case '/reveal':this.studio.get(body.id);this.reveal(body.id,true);result={ok:true};break;
        default:reply(404,{error:'Not found'});return;
      }
      reply(200,result);
    }catch(e:any){reply(400,{error:e.message});}
  }
  private view(id:string){const s=this.studio.get(id);return {...s,left:{...s.left,hash:hash(s.left.text)},right:{...s.right,hash:hash(s.right.text)}};}
}
