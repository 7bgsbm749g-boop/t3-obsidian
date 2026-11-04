import type {App} from 'obsidian';
import type {ReplyReference} from '../responses/reply-assets';
import type {ResponseRequest} from '../responses/response-model';
import type {ThreadAccess} from '../conversations/thread-stream';
type Resolver=(reference:ReplyReference,request:ResponseRequest,access:ThreadAccess)=>Promise<string|undefined>;
const resolvers=new WeakMap<App,Resolver>();
export function registerProjectReferences(app:App,resolver:Resolver){resolvers.set(app,resolver);return ()=>{if(resolvers.get(app)===resolver)resolvers.delete(app);};}
export function projectReplyReference(app:App,reference:ReplyReference,request:ResponseRequest,access:ThreadAccess){return resolvers.get(app)?.(reference,request,access)??Promise.resolve(undefined);}
