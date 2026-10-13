import {promises as fs} from 'node:fs';
import {join,dirname,resolve,basename,sep} from 'node:path';
import {collectImages} from './images';
import {folderLinkForPath,loadFolderLinks} from './folder-link';
import {validateNoteCommand,type NoteCommand,type NoteCommandResult} from './note-command';
import {editorStream} from './editor-stream';
import {prepareSendGuard,updateSendGuard} from './send-response-guard';
import {resolveJobOptions} from './job-options';
import {initialRegion} from './inline-thread';
import {commandId} from './direct';
import {applyOrchestration} from './orchestration';
import {INLINE_REPLY_INSTRUCTION} from './input-presentation';
import {stagedNoteInstruction} from './staged-note-instruction';
import {sendRequest,acceptedRequestThread,type Request} from './bridge';
import {desktopDefaults} from './desktop';
import type {LeaseIdentity,LeaseFiles} from './inline-lease';
import type {HostedInlineRequest} from './hosted-inline';

export interface BackgroundNoteSendIO {
 readNote(path:string):Promise<string|undefined>;
 updateNote(path:string,change:(document:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
 register(request:HostedInlineRequest):Promise<void>;
 send?(request:Request):Promise<{threadId:string}>;
}
/** The same durable note-command identity also works with no desktop client. */
export async function backgroundNoteSend(input:NoteCommand,identity:LeaseIdentity,files:LeaseFiles,io:BackgroundNoteSendIO):Promise<NoteCommandResult>{
 const command=validateNoteCommand(input);if(command.kind!=='send-note')throw Error('Choose a note send.');
 const ledgerPath=`${identity.directory}/note-sends/${command.id}.json`,prior=await files.read(ledgerPath);
 let ledger:any=prior?JSON.parse(prior):undefined;
 if(ledger&&JSON.stringify(ledger.command)!==JSON.stringify(command))throw Error('This command ID belongs to another note send.');
 if(ledger?.result)return ledger.result;
 if(ledger?.attempted||ledger?.failed)throw Error('This note send has already been attempted. Check its original T3 message; it will not be resent.');
 const settingsPath=join(identity.workspaceRoot,'.obsidian/plugins/send-to-t3-code/data.json'),settings=JSON.parse(await fs.readFile(settingsPath,'utf8'));
 if(settings.vaultId!==identity.vaultId)throw Error('The source vault identity changed.');
 if(!ledger){
  const link=folderLinkForPath(loadFolderLinks(settings).filter(link=>link.folderPath!=='/'),command.notePath)??(!command.notePath.includes('/')?loadFolderLinks(settings).find(link=>link.folderPath==='/'):undefined);
  if(!link)throw Error('Link this note’s folder to a T3 project before an agent send.');
  const environment=link.environmentId??settings.paired?.find((connection:any)=>connection.id===link.connectionId)?.environmentId??identity.environmentId;
  if(environment!==identity.environmentId)throw Error('A background agent note send must target a project on this vault machine. Mobile sends can use any connected machine.');
  const content=await io.readNote(command.notePath);if(!content?.trim())throw Error('This note is empty.');
  const images=await collectImages(content,async embed=>{
   if(/^[a-z][a-z0-9+.-]*:/i.test(embed.link))throw Error('Use a saved vault image for a background agent note send.');
   const candidates=[resolve(identity.workspaceRoot,dirname(command.notePath),decodeURIComponent(embed.link)),resolve(identity.workspaceRoot,decodeURIComponent(embed.link))];
   for(const path of candidates){if(!path.startsWith(resolve(identity.workspaceRoot)+sep))throw Error('The image leaves its vault.');try{return {bytes:await fs.readFile(path),name:basename(path)};}catch(error:any){if(error.code!=='ENOENT')throw error;}}
   throw Error('The embedded image was not found.');
  });
  const policy=resolveJobOptions({...settings.inlineStreaming,enabled:command.streamReply}),actor=commandId(command.id,'background-owner'),createdAt=new Date().toISOString();
  const request:Request={id:command.id,title:basename(command.notePath,'.md'),project:{id:link.projectId,title:link.projectTitle,workspaceRoot:link.workspaceRoot},connection:{...desktopDefaults(),transport:'desktop',environmentId:identity.environmentId},prompt:'',jobOptions:policy,...(command.threadId?{threadId:command.threadId}:{})};
  request.noteThread={notePath:command.notePath,projectId:link.projectId,workspaceRoot:link.workspaceRoot,connectionId:link.connectionId??'',environmentId:identity.environmentId};
  request.attachments=images.attachments;request.context=images.context;
  let prompt=images.markdown;
  if(command.streamReply){
   const source:HostedInlineRequest={version:4,nativeProjection:true,responseContainer:true,independent:true,id:command.id,initialOwner:actor,vaultId:identity.vaultId,host:identity,notePath:command.notePath,threadId:command.threadId??commandId(command.id,'thread'),messageId:commandId(command.id,'message'),projectId:link.projectId,threadEnvironmentId:identity.environmentId,initialHash:initialRegion(command.id).bodyHash,createdAt,threadTitle:request.title,intermediateMode:policy.inline.intermediateMode,keepIntermediate:policy.inline.intermediateMode!=='remove',finalAnswerFormat:policy.inline.finalAnswerFormat};
   request.inlineBindings=[];
   for(const notePath of command.destinations.length?command.destinations:[command.notePath])request.inlineBindings.push(await editorStream(source,notePath,{...io,beforeInsert:binding=>prepareSendGuard(files,binding)},()=>true));
   request.inlineHost=request.inlineBindings[0];prompt+=`\n\n${INLINE_REPLY_INSTRUCTION}`;
  }
  const destination=join(link.workspaceRoot,command.notePath);
  request.prompt=applyOrchestration(prompt+`\n\nSent from Obsidian.\nObsidian vault: ${JSON.stringify(basename(identity.workspaceRoot))}\nDestination note path: ${JSON.stringify(destination)}`,settings.orchestration??{});
  if(request.inlineBindings?.length)request.prompt+=stagedNoteInstruction(request.inlineBindings);
  if(request.prompt.length>120_000)throw Error('The note and image context exceed T3’s prompt limit.');
  ledger={version:1,command,request,attempted:false};await files.write(ledgerPath,JSON.stringify(ledger));
 }
 const request:Request=ledger.request;
 try{
  for(const binding of request.inlineBindings??[])await io.register(binding);
  ledger.attempted=true;await files.write(ledgerPath,JSON.stringify(ledger));
  const started=await (io.send??sendRequest)(request);
  for(const binding of request.inlineBindings??[])await updateSendGuard(files,binding,'accepted');
  const selectedAt=new Date().toISOString(),linkPath=`${identity.directory}/note-thread-links/${command.id}.json`;
  if(!await files.read(linkPath))await files.write(linkPath,JSON.stringify({...request.noteThread,threadId:started.threadId,selectedAt,updatedAt:selectedAt}));
  const result:NoteCommandResult={id:command.id,ok:true,threadId:started.threadId,messageId:commandId(command.id,'message'),bindingIds:request.inlineBindings?.map(binding=>binding.id)??[]};
  ledger.result=result;await files.write(ledgerPath,JSON.stringify(ledger));return result;
 }catch(error){
  const accepted=acceptedRequestThread(request);
  for(const binding of request.inlineBindings??[])await updateSendGuard(files,binding,accepted?'accepted':'failed',ledger.attempted===true&&!accepted);
  ledger.failed=true;await files.write(ledgerPath,JSON.stringify(ledger));throw error;
 }
}
