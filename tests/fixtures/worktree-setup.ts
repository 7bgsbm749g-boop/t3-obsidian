import type {WorktreeSetup} from '../../worktree-setup';
export const setupAt='2026-10-30T00:00:00.000Z';
export const preparationItem={id:'turn-item:provider:codex:native-item:workspace-preparation%3Arun',runId:'run',type:'command_execution',ordinal:1,title:'Workspace ready',input:'Preparing workspace',output:'Workspace preparation completed.',status:'completed',startedAt:setupAt,completedAt:'2026-10-30T00:00:01.900Z',updatedAt:'2026-10-30T00:00:01.900Z'};
export const completedSetup:WorktreeSetup={threadId:'fixture-thread',phase:'done',startedAt:setupAt,endedAt:'2026-10-30T00:00:02.000Z',branch:'test/worktree',baseRef:'main',worktreePath:'/synthetic/worktree',setupScript:null,error:null,sequence:8,
  stages:[{id:'fetch',status:'done',startedAt:setupAt,endedAt:'2026-10-30T00:00:00.756Z',percent:null,detail:null,tail:[]},
    {id:'checkout',status:'done',startedAt:'2026-10-30T00:00:00.756Z',endedAt:'2026-10-30T00:00:01.856Z',percent:null,detail:null,tail:[]},
    {id:'setup-script',status:'skipped',startedAt:null,endedAt:null,percent:null,detail:null,tail:[]},
    {id:'agent',status:'done',startedAt:'2026-10-30T00:00:01.946Z',endedAt:'2026-10-30T00:00:02.000Z',percent:null,detail:null,tail:[]}]};
