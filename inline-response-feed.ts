import type {HostedInlineRequest} from './hosted-inline';
import {applyThreadItem,inlineTurnMessages,type InlineThreadState} from './inline-thread';
import {finalResponseKey} from './final-response';
import {readInlineSnapshot,watchThread,type ThreadAccess} from './thread-stream';
import {responseTooLarge,T3ResponseTooLargeError,type StreamReadFailure} from './t3-response-limits';
import {logFailure} from './diagnostics';

interface Feed {state?:InlineThreadState;failure?:StreamReadFailure;monitor?:{stop():void};read?:Promise<InlineThreadState>;used:number;active:boolean}
/** The host shares one live transcript per thread. Cold recovery reads a
 * compact snapshot once; normal completion reads a single final item. */
export class InlineResponseFeeds {
  private feeds=new Map<string,Feed>();
  private stopped=false;
  constructor(private access:(environmentId:string)=>Promise<ThreadAccess>,private watch:typeof watchThread=watchThread,private now=()=>performance.now()){}
  private key(request:HostedInlineRequest){return JSON.stringify([request.threadEnvironmentId,request.projectId,request.threadId]);}
  failure(request:HostedInlineRequest){return this.feeds.get(this.key(request))?.failure;}
  private start(request:HostedInlineRequest,current:Feed){
    if(current.monitor)return;
    current.monitor=this.watch(request.threadId,()=>this.access(request.threadEnvironmentId),{
      item:item=>{
        if(!current.active||this.stopped||item.kind==='synchronized')return;
        if(item.kind==='snapshot'&&(item.snapshot?.thread?.id!==request.threadId||item.snapshot.thread.projectId!==request.projectId))return;
        if(item.kind==='event'&&item.event?.aggregateId!==undefined&&item.event.aggregateId!==request.threadId)return;
        current.state=applyThreadItem(current.state??{protocolVersion:2,messages:[],activities:[]},item).state;
      },reconnecting:error=>logFailure('stream.host.reconnecting',error,{threadId:request.threadId}),
    },undefined,undefined,{afterSequence:()=>current.state?.sequence??0,pollSnapshots:false});
  }
  async state(request:HostedInlineRequest,access:ThreadAccess,refresh=false,knownFailure?:StreamReadFailure):Promise<InlineThreadState|undefined>{
    if(this.stopped)return;
    const key=this.key(request);let feed=this.feeds.get(key);
    if(!feed){
      feed={used:this.now(),active:true,failure:knownFailure?.operation==='snapshot'?knownFailure:undefined};this.feeds.set(key,feed);
      if(feed.failure)this.start(request,feed);
    }
    feed.used=this.now();
    if(feed.state&&!refresh&&feed.state.protocolVersion===2)return feed.state;
    if(feed.failure)throw new T3ResponseTooLargeError();
    if(feed.read)return feed.read;
    const current=feed;
    const work=readInlineSnapshot(access,request.threadId,request.projectId,{messageIds:[request.messageId],turnIds:request.importTurn?[request.importTurn.turnId]:[]}).then(snapshot=>{
      if(!current.active||this.stopped)throw Error('The response stream closed.');
      current.state=applyThreadItem(current.state??{messages:[],activities:[]},{kind:'snapshot',snapshot}).state;if(current.state.protocolVersion===2)this.start(request,current);return current.state;
    }).catch(error=>{if(current.active&&responseTooLarge(error)){current.failure={kind:'response-too-large',operation:'snapshot'};this.start(request,current);}throw error;}).finally(()=>{if(current.read===work)current.read=undefined;});
    current.read=work;return work;
  }
  adopt(request:HostedInlineRequest,state:InlineThreadState,turnId:string,key:string):boolean {
    const feed=this.feeds.get(this.key(request));
    if(!feed?.active||!feed.state||finalResponseKey(feed.state,turnId)!==key)return false;
    const final=inlineTurnMessages(state,turnId).at(-1)!;
    feed.state={...feed.state,messages:feed.state.messages.map(m=>m.id===final.id?final:m)};return true;
  }
  prune(){for(const [key,feed] of this.feeds)if(this.now()-feed.used>30_000&&!feed.read){feed.active=false;feed.monitor?.stop();this.feeds.delete(key);}}
  stop(){this.stopped=true;for(const feed of this.feeds.values()){feed.active=false;feed.monitor?.stop();}this.feeds.clear();}
}
