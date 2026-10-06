import type {App} from 'obsidian';
import type {ReplyReference} from './reply-assets';
import type {HostedInlineRequest} from './hosted-inline';
import type {ThreadAccess} from './thread-stream';
type Resolver=(reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess)=>Promise<string|undefined>;
const resolvers=new WeakMap<App,Resolver>();
export function registerProjectReferences(app:App,resolver:Resolver){resolvers.set(app,resolver);return ()=>{if(resolvers.get(app)===resolver)resolvers.delete(app);};}
export function projectReplyReference(app:App,reference:ReplyReference,request:HostedInlineRequest,access:ThreadAccess){return resolvers.get(app)?.(reference,request,access)??Promise.resolve(undefined);}
