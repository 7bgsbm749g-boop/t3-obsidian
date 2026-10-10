import {applyThreadItem,type InlineThreadState} from './inline-thread';
import {watchThread,type ThreadAccess,type ThreadStreamItem} from './thread-stream';

export interface TitleDestination {id:string;threadId:string;projectId:string;threadEnvironmentId:string}
type Feed={destinations:TitleDestination[];state:InlineThreadState;monitor?:{stop():void}};

/** Titles are display metadata. Following them never waits for host migration,
 * a turn binding, or a generated note commit, and never writes saved Markdown. */
export class ThreadTitleFeed {
  private feeds=new Map<string,Feed>();
  constructor(private access:(environmentId:string)=>Promise<ThreadAccess>,private title:(id:string,title:string)=>void,private watch=watchThread){}
  sync(destinations:TitleDestination[]){
    const groups=new Map<string,TitleDestination[]>();
    for(const destination of destinations){
      const key=JSON.stringify([destination.threadEnvironmentId,destination.projectId,destination.threadId]);
      groups.set(key,[...groups.get(key)??[],destination]);
    }
    for(const [key,feed] of this.feeds)if(!groups.has(key)){this.feeds.delete(key);feed.monitor?.stop();}
    for(const [key,targets] of groups){
      const existing=this.feeds.get(key);
      if(existing){existing.destinations=targets;if(existing.state.title)for(const target of targets)this.title(target.id,existing.state.title);continue;}
      const feed:Feed={destinations:targets,state:{messages:[],activities:[]}},target=targets[0];this.feeds.set(key,feed);
      const item=(item:ThreadStreamItem)=>{
        if(this.feeds.get(key)!==feed)return;
        if(item.kind==='snapshot'&&(item.snapshot?.thread?.id!==target.threadId||item.snapshot.thread.projectId!==target.projectId))return;
        const next=applyThreadItem(feed.state,item).state;
        feed.state={messages:[],activities:[],title:next.title,sequence:next.sequence,protocolVersion:next.protocolVersion};
        if(feed.state.title?.trim())for(const destination of feed.destinations)this.title(destination.id,feed.state.title);
      };
      // Every connection gets a fresh initial snapshot, followed by metadata
      // events. Reply recovery owns canonical history polling; titles do not
      // need another copy of that transcript or its own polling loop.
      feed.monitor=this.watch(target.threadId,()=>this.access(target.threadEnvironmentId),{item,reconnecting:()=>{}},undefined,undefined,{afterSequence:()=>undefined,pollSnapshots:false,titleOnly:true});
    }
  }
  dispose(){for(const feed of this.feeds.values())feed.monitor?.stop();this.feeds.clear();}
}
