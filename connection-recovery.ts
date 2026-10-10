import {T3ConnectionTimeoutError} from './t3-rpc';

export interface ConnectionReloadState {lastReloadAt?:number;awaitingRecovery?:string}
export interface ConnectionRecoveryIO {
  load():ConnectionReloadState;
  save(state:ConnectionReloadState):void;
  reload(beforeDispatch:()=>boolean):Promise<boolean>;
  failure(error:unknown):void;
  now?():number;
}
/** Two independently opened, silent connections confirm a recovery failure.
 * One persisted reload per outage prevents a restart loop while offline. */
export class ConnectionRecovery {
  private faults=new Map<string,{ids:Set<string>;at:number}>();
  private pending?:string;private work?:Promise<void>;private stopped=false;private nextAttempt=0;
  constructor(private io:ConnectionRecoveryIO){}
  private now(){return this.io.now?.()??Date.now();}
  failed(target:string,error:unknown){
    if(this.stopped||!(error instanceof T3ConnectionTimeoutError))return false;
    const now=this.now(),old=this.faults.get(target),fault=old&&now-old.at<60_000?old:{ids:new Set<string>(),at:now};
    if(fault.ids.has(error.connectionId))return false;
    fault.ids.add(error.connectionId);this.faults.set(target,fault);
    if(this.faults.size>32)this.faults.delete(this.faults.keys().next().value!);
    if(fault.ids.size>=2&&!this.io.load().awaitingRecovery&&!this.pending){this.pending=target;this.nextAttempt=Math.max(this.nextAttempt,now+1000);}
    return true;
  }
  recovered(target:string){
    if(this.stopped)return;
    this.faults.delete(target);if(this.pending===target)this.pending=undefined;
    const saved=this.io.load();if(saved.awaitingRecovery===target)this.io.save({...saved,awaitingRecovery:undefined});
  }
  tick(){
    if(this.stopped||this.work||!this.pending||this.now()<this.nextAttempt)return;
    const target=this.pending,saved=this.io.load();
    if(saved.awaitingRecovery||saved.lastReloadAt!==undefined&&this.now()-saved.lastReloadAt<300_000)return;
    const work=(async()=>{
      let recorded=false;
      try{
        // The caller performs the normal saved-editor and exact-runtime checks
        // immediately before invoking the native reload command.
        await this.io.reload(()=>{
          if(this.stopped||this.pending!==target)return false;
          this.io.save({lastReloadAt:this.now(),awaitingRecovery:target});recorded=true;this.pending=undefined;return true;
        });
      }catch(error){
        if(recorded&&this.io.load().awaitingRecovery===target){this.io.save(saved);if(!this.stopped)this.pending=target;}
        this.nextAttempt=this.now()+3000;this.io.failure(error);
      }
    })();this.work=work;void work.finally(()=>{if(this.work===work)this.work=undefined;}).catch(()=>{});
  }
  status(){return {pending:!!this.pending,reloading:!!this.work,...this.io.load()};}
  dispose(){this.stopped=true;this.pending=undefined;this.faults.clear();}
}
