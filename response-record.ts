import type {ResponseRequest,ResponseState,ResponseFiles} from './response-model';
import type {InlineBindingCheckpoint} from './inline-thread';
import type {StoppedBodyReference} from './response-stop-receipt';
import type {FinalAttemptAbort} from './completion-attempt';
/** Passive native-display record shapes. There is no authority, client or lease runtime. */
export interface FinalResponseIntent {checkpoint?:InlineBindingCheckpoint;turnIds?:string[];messageId:string;turnId:string|null;sequence:number;body:string;phase:'complete'|'interrupted'}
export interface FinalResponseGrant extends FinalResponseIntent {actor:string;token:string}
export interface ResponseRecord {preparedFinal?:{commitId:string;hash:string;proofHash:string};preparedFinalTombstones?:FinalAttemptAbort[];presenceUntil?:number;finalWriter?:FinalResponseGrant;relocations?:Array<{before:string;after:string}>;coordinated?:boolean;migrating?:boolean;legacyFenceUntil?:number;request:ResponseRequest;owner:string;epoch:number;expiresAt:number;revision:number;responseRemovedAt?:number;stopRequestedAt?:number;discardResponse?:boolean;stoppedBody?:string;stoppedBodyRef?:StoppedBodyReference;state?:ResponseState}
export interface ResponseStorageFiles extends ResponseFiles {list(directory:string):Promise<string[]>;listBatch?(directory:string,limit:number):Promise<string[]>;close?():Promise<void>;remove(path:string):Promise<void>;version?(path:string):Promise<string|undefined>;forget?(path:string):Promise<void>}
