import {randomId} from '../shared/uuid';
import {validateClientCommand,type ClientCommand,type ClientCommandResult} from './client-command';

/** Compiled client identity and diagnostics; no application control API. */
export class DesktopClientMaintenance {
  readonly client:{instanceId:string;loadedVersion:string};
  constructor(loadedVersion:string){this.client={instanceId:randomId(),loadedVersion};}
  async execute(input:ClientCommand):Promise<ClientCommandResult>{
    const command=validateClientCommand(input);
    return {id:command.id,ok:true,client:this.client};
  }
}
