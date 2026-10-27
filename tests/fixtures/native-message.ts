import {randomUUID} from 'node:crypto';
import type {ResponseRequest} from '../../response-model';

export const nativeLaunchId='mcp:11111111-1111-4111-8111-111111111111';
export const nativeFollowUpId='message:mcp:11111111-1111-4111-8111-111111111111:thread-send:22222222-2222-4222-8222-222222222222';
export const nativeAt='2026-10-27T00:00:00.000Z';
export function nativeRequest(messageId=nativeLaunchId):ResponseRequest {
  return {version:4,localOnly:true,nativeProjection:true,responseContainer:true,independent:true,
    id:randomUUID(),initialOwner:randomUUID(),vaultId:'synthetic-vault',host:{environmentId:'synthetic-environment',workspaceRoot:'/synthetic',directory:'.obsidian/t3-code/inline/v1'},
    notePath:'Synthetic.md',threadId:nativeLaunchId,projectId:'synthetic-project',threadEnvironmentId:'synthetic-environment',
    messageId,initialInput:{messageId,text:'Synthetic prompt',label:'Agent'},initialHash:'0'.repeat(64),createdAt:nativeAt};
}
