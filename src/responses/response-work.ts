import type {InlineThreadState} from '../conversations/inline-thread';
import {responseToolGroups,currentResponseToolGroup,renderResponseToolGroup} from './response-tools';
import {responseImageResults,renderImageResult} from './image-results';
import {responseEmissions} from './response-emissions';
import type {IntermediateMode} from './response-presentation';
import type {SubagentSource} from './response-subagents';

/** Portable work presentation. Note projections and workspace chats use the
 * same tool/thought/emission ordering and current-activity ownership. No IO. */
export function responseWork(state:InlineThreadState,turns:string[],turnId:string,phase:string,mode:IntermediateMode,waiting:boolean,markdown:(text:string)=>string,source?:SubagentSource){
  const imageRows=source?state.activities.filter(activity=>turns.includes(activity.turnId??'')).flatMap(activity=>responseImageResults(activity,source.environmentId,source.threadId).map((reference,index)=>({id:`${activity.id}:image:${index}`,createdAt:activity.createdAt,sequence:activity.sequence??0,body:renderImageResult(reference)}))):[];
  const toolGroups=responseToolGroups(state,turns);
  const emissions=responseEmissions(state,turns,markdown,phase==='running'?turnId:undefined,source);
  let currentTool=phase==='running'&&!waiting?currentResponseToolGroup(state,turnId,toolGroups):undefined;
  const latest=phase==='running'?emissions.at(-1):undefined;
  const currentEmission=!waiting&&latest?.active&&latest.turnId===turnId&&
    !state.messages.some(message=>message.turnId===turnId&&Date.parse(message.createdAt??'')>Date.parse(latest.createdAt??''))&&
    (!currentTool||Date.parse(currentTool.tool.createdAt??'')<=Date.parse(latest.createdAt??''))?latest:undefined;
  if(currentEmission)currentTool=undefined;
  const workRows=toolGroups.map(group=>({groupId:group.id,createdAt:group.createdAt,sequence:group.sequence??0,body:renderResponseToolGroup(group),hasThoughts:!!group.thoughts?.length}));
  const historyRows=[...workRows,...(mode==='collapse'?imageRows:[]),...emissions.filter(item=>item!==currentEmission&&(mode==='collapse'||!['response.plan','response.proposed-plan'].includes(item.kind)))].sort((a,b)=>(Date.parse(a.createdAt??'')||0)-(Date.parse(b.createdAt??'')||0)||a.sequence-b.sequence);
  return {imageRows,toolGroups,workRows,historyRows,currentTool,currentEmission,activityGroup:toolGroups.filter(group=>group.turnId===turnId).at(-1)};
}
