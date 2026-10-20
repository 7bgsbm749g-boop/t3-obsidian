export const handoffAt='2026-10-20T20:00:01.000Z';
export const handoffPrompt='Continue the bounded synthetic task and reply HANDOFF_READY.';
export const handoffMessageId='message:mcp:11111111-1111-4111-8111-111111111111:worktree-continuation:22222222-2222-4222-8222-222222222222';
export const handoffSource={id:'source',ordinal:1,status:'interrupted',userMessageId:'prompt',requestedAt:'2026-10-20T20:00:00.000Z',completedAt:'2026-10-20T20:00:03.000Z'};
export const handoffRun={id:'resume',ordinal:2,status:'running',userMessageId:handoffMessageId,requestedAt:'2026-10-20T20:00:02.000Z',completedAt:null};
export const handoffMessage={id:handoffMessageId,role:'user',createdBy:'agent',creationSource:'mcp',runId:'resume',text:handoffPrompt,streaming:false,createdAt:'2026-10-20T20:00:02.000Z'};
export const handoffItem={id:'handoff-tool',type:'dynamic_tool',toolName:'t3-code.t3_worktree_handoff',runId:'source',status:'completed',startedAt:handoffAt,completedAt:'2026-10-20T20:00:02.500Z',
  input:{branch:'test/handoff',continuationPrompt:handoffPrompt},output:{branch:'test/handoff',worktreePath:'/synthetic/worktree',continuation:{status:'scheduled',delivery:'queued'}}};
export function handoffProjection(overrides:any={}){
 return {snapshotSequence:10,projection:{thread:{id:'thread',projectId:'project',title:'Handoff test'},runs:[handoffSource,handoffRun],
  messages:[{id:'prompt',role:'user',runId:'source',text:'Synthetic task',streaming:false},handoffMessage,{id:'before',role:'assistant',runId:'source',text:'Before move',streaming:false}],
  turnItems:[handoffItem],...overrides}};
}
