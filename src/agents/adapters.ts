import {hasControlCharacters} from '../shared/values';

export const AGENT_DRIVERS=['codex','claudeAgent','cursor','opencode'] as const;
export type AgentDriver=typeof AGENT_DRIVERS[number];
export function supportsAgent(driver:string):driver is AgentDriver{return AGENT_DRIVERS.some(value=>value===driver);}
/** T3's argument tokenizer, never a command shell. */
export function quoteAgentArgument(value:string){
  if(hasControlCharacters(value))throw Error('Invalid agent launch argument.');
  return '"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
}
export function agentLaunchArguments(driver:AgentDriver,runtime:string,server:string,root:string,config:string){
  if(!runtime.trim()||runtime!==runtime.trim()||hasControlCharacters(runtime))throw Error('Invalid Python executable.');
  if(driver==='codex'){
    const value='mcp_servers.t3-obsidian={command='+JSON.stringify(runtime)+',args=['+[server,'--transport-root',root].map(value=>JSON.stringify(value)).join(',')+']}';
    return '-c '+quoteAgentArgument(value);
  }
  if(driver==='cursor')return '--plugin-dir '+quoteAgentArgument(config);
  if(driver==='opencode')return '';
  return '--mcp-config '+quoteAgentArgument(config);
}
