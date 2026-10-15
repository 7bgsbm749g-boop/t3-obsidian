import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateResponseCommand} from '../response-command';

const identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},source={threadId:'source',projectId:'project',environmentId:'host'};
test('bulk import command validates exact source and opaque binding cursor',()=>{
 const command={version:1,id:randomUUID(),kind:'response-import-records',source};assert.deepEqual(validateResponseCommand(command),command);
 for(const value of [{...command,source:{...source,projectId:''}},{...command,cursor:'../wrong'},{...command,source:undefined}])assert.throws(()=>validateResponseCommand(value),/exact import source/);
});
