import {LocalResponseManager,type LocalFinalNoteIO} from './local-response-manager';
import type {ResponseRequest,ResponseStorageTarget} from './response-model';
import type {ResponseRecord} from './response-record';
import type {DirectInlineUpdate} from './direct-inline-preview';
import type {ThreadAccess,ThreadAccessCloseReason} from './thread-stream';
import type {InlineStartRequest} from './inline-thread';
import type {SteeringInput} from './inline-steering';
import type {ReplyReference} from './reply-assets';
import type {T3ConnectionTimeoutError} from './t3-rpc';
import type {ResponseStopReceipt} from './response-stop-receipt';
export interface DeviceResponseIO {
  localFinalNotes?:LocalFinalNoteIO;
  localBindings?():readonly ResponseRequest[];
  saveLocalBinding?(request:ResponseRequest):Promise<void>;
  openedNotes?():Array<{path:string;document:string}>;
  saveLocalNote?(path:string):Promise<void>;
  syncReady?():boolean;
  localCompleted?(id:string,path:string):void;
  localFinalBody?(update:DirectInlineUpdate):Promise<string>;
  localFinalDraft?(document:string,request:ResponseRequest):Promise<string>;
  retainLocalFinal?(update:DirectInlineUpdate):Promise<void>;
  loadLocalFinal?(request:ResponseRequest):Promise<DirectInlineUpdate|undefined>;
  localQuestions?(update:DirectInlineUpdate):void;
  connectionTimeout?(target:ResponseStorageTarget,error:T3ConnectionTimeoutError):void;
  connectionRecovered?(target:ResponseStorageTarget):void;
  completionActor?:string;
  completionFailed?(error:unknown,id:string):void;
  loadStops?():string[];
  saveStops?(ids:string[]):void;
  receiveCoordinated?(record:ResponseRecord,proofBytes?:string):void|Promise<void>;
  receiveDirect?(update:DirectInlineUpdate):void;
  receiveThreadTitle?(id:string,title:string):void;
  readSaved?(path:string):Promise<string|undefined>;
  access(environmentId:string,reason?:ThreadAccessCloseReason):Promise<ThreadAccess>;
  readNote(path:string):Promise<string|undefined>;
  locateNote?(id:string,path:string):Promise<string|undefined>;
  noteChanged?(path:string):void;
  noteRenamed?(before:string,after:string):void;
  noteDeleted?(path:string):void;
  isOpen(path:string):boolean;
  isSaved?(path:string,hash:string,proof?:{id:string;body:string;cleaned?:boolean}):Promise<boolean>;
  updateNote(path:string,change:(current:string)=>string,allowed:()=>boolean):Promise<string|undefined>;
  resolveReplyReference?(reference:ReplyReference,request:ResponseRequest,access:ThreadAccess):Promise<string|undefined>;
}
/** Device-local replies only. Remote ownership, polling and migration are retired. */
export class DeviceResponseManager {
  private local?:LocalResponseManager;
  private stopped=false;
  private stops:Set<string>;
  constructor(readonly actor:string,private vaultId:string,private io:DeviceResponseIO){const stopped=io.loadStops?.();this.stops=new Set(Array.isArray(stopped)?stopped:[]);}
  private manager(){if(!this.local){if(!this.io.localFinalNotes)throw Error('Local reply saving is unavailable.');this.local=new LocalResponseManager(this.io.completionActor??this.actor,this.vaultId,this.io,this.io.localFinalNotes);}return this.local;}
  register(request:ResponseRequest){if(this.stopped||!request.localOnly)throw Error('Legacy reply creation was retired.');return this.manager().register(request);}
  delivered(_host:ResponseStorageTarget,id:string,delivery:InlineStartRequest){this.local?.delivered(id,delivery);return Promise.resolve();}
  stopLocally(id:string){this.stops.add(id);this.io.saveStops?.([...this.stops]);this.local?.stopLocally(id);}
  failResponse(_host:ResponseStorageTarget,id:string){return this.local?.cancel(id)??Promise.resolve();}
  stopResponse(_host:ResponseStorageTarget,id:string,body?:string,_operationId?:string):Promise<ResponseStopReceipt>{return this.manager().stop(id,body);}
  responseStatus(id:string){return this.local?.status(id);}
  localResponse(id:string){const record=this.local?.record(id);return record?{record,host:record.request.host}:undefined;}
  cachedResponse(id:string){return this.localResponse(id);}
  async relocateResponse(_host:ResponseStorageTarget,record:ResponseRecord,path:string){await this.register({...record.request,notePath:path});return this.local!.record(record.request.id)!;}
  follow(_host:ResponseStorageTarget,id:string,previous:string,messageId:string,path?:string){return this.manager().follow(id,messageId,path,previous);}
  steer(_host:ResponseStorageTarget,id:string,input:SteeringInput){return this.manager().steer(id,input);}
  resume(){if(!this.stopped)this.manager().resume();}
  localBindingsChanged(){if(!this.stopped)this.manager().resume();}
  explorerResponses(){return (this.local?.responses()??[]).filter(response=>!this.stops.has(response.id));}
  stoppableResponses(path:string){return this.explorerResponses().filter(response=>response.notePath===path&&response.active).map(response=>({id:response.id,hostTarget:this.local!.record(response.id)!.request.host}));}
  tick(){if(!this.stopped)this.local?.tick();}
  changed(path:string){this.io.noteChanged?.(path);this.local?.resume();}
  renamed(before:string,after:string){this.io.noteRenamed?.(before,after);this.local?.renamed(before,after);}
  deleted(path:string){this.io.noteDeleted?.(path);this.local?.deleted(path);}
  dispose(){this.stopped=true;this.local?.dispose();}
}
