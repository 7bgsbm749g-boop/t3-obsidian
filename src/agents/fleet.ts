import {forEachBounded} from '../shared/bounded-work';
import {toError} from '../shared/values';
import type {AgentProvider,AgentSetupState,AgentStatus,ManualSetup} from './setup';
export interface AgentMachine {id:string;name:string}
export interface AgentTarget extends AgentStatus {available?:boolean;provider:AgentProvider;error?:string}
export interface MachineSetup extends AgentMachine {targets:AgentTarget[];unsupported:AgentSetupState['unsupported'];windows?:boolean;manual?:ManualSetup;error?:string}
export interface FleetHost {
  prepare?(id:string,runtime:string):Promise<ManualSetup>;machines():AgentMachine[];inspect(id:string):Promise<AgentSetupState>;status(id:string,provider:AgentProvider):Promise<AgentStatus>;
  install(id:string,provider:AgentProvider,runtime:string):Promise<unknown>;remove(id:string,provider:AgentProvider):Promise<void>;
}
/** Two machines at a time; provider settings on one machine stay serialized. */
export class AgentFleet {
  snapshot:MachineSetup[]=[];private checking?:Promise<MachineSetup[]>;private action?:Promise<void>;
  constructor(private host:FleetHost){}
  scan():Promise<MachineSetup[]>{
    if(this.checking)return this.checking;
    const work=(async()=>{
      const machines=[...new Map(this.host.machines().map(machine=>[machine.id,machine])).values()],results=new Map<string,MachineSetup>();
      await forEachBounded(machines,2,async machine=>{
        const result:MachineSetup={...machine,targets:[],unsupported:[]};results.set(machine.id,result);
        try{
          const state=await this.host.inspect(machine.id);result.windows=state.windows;result.unsupported=state.unsupported??[];result.manual=state.manual;
          for(const provider of [...state.providers,...state.inactive??[]]){const available=state.providers.some(item=>item.id===provider.id);try{result.targets.push({provider,available,...await this.host.status(machine.id,provider)});}catch(error){result.targets.push({provider,available,installed:false,owned:false,error:toError(error).message});}}
        }catch(error){result.error=toError(error).message;}
      });
      return this.snapshot=machines.map(machine=>results.get(machine.id)!);
    })();this.checking=work;void work.finally(()=>{if(this.checking===work)this.checking=undefined;}).catch(()=>{});return work;
  }
  run(kind:'connect'|'disconnect'):Promise<void>{
    if(this.action)return this.action;
    const work=(async()=>{
      const machines=await this.scan();
      await forEachBounded(machines,2,async machine=>{
        if(machine.error)return;
        if(kind==='connect'&&this.host.prepare&&!machine.manual){try{machine.manual=await this.host.prepare(machine.id,machine.windows?'python':'python3');}catch(error){machine.error=toError(error).message;return;}}
        for(const target of machine.targets){
          if(kind==='connect'&&(target.available===false||target.custom||target.installed&&!target.needsUpdate))continue;
          if(kind==='disconnect'&&!target.owned)continue;
          try{if(kind==='connect')await this.host.install(machine.id,target.provider,machine.windows?'python':'python3');else await this.host.remove(machine.id,target.provider);target.error=undefined;}
          catch(error){target.error=toError(error).message;}
        }
      });
      const machineFailures=new Map(machines.filter(machine=>machine.error).map(machine=>[machine.id,machine.error!]));
      const failures=new Map(machines.flatMap(machine=>machine.targets.filter(target=>target.error).map(target=>[machine.id+':'+target.provider.id,target.error!])));
      await this.scan();for(const machine of this.snapshot){if(machineFailures.has(machine.id))machine.error=machineFailures.get(machine.id);}
      for(const machine of this.snapshot)for(const target of machine.targets){const error=failures.get(machine.id+':'+target.provider.id);if(error)target.error=error;}
    })();this.action=work;void work.finally(()=>{if(this.action===work)this.action=undefined;}).catch(()=>{});return work;
  }
}
