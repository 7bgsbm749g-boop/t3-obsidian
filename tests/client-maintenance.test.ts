import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DesktopClientMaintenance} from '../src/app/client-maintenance-desktop';
import {validateClientCommand,type ClientCommand} from '../src/app/client-command';

test('client diagnostics retain the compiled version and per-instance identity',async()=>{
 const client=new DesktopClientMaintenance('0.0.429'),other=new DesktopClientMaintenance('0.0.429');
 const id=randomUUID(),result=await client.execute({version:1,id,kind:'client-status'});
 assert.equal(result.id,id);assert.equal(result.ok,true);assert.equal(result.client?.loadedVersion,'0.0.429');
 assert.notEqual(result.client?.instanceId,other.client.instanceId);
 assert.equal((await client.execute({version:1,id:randomUUID(),kind:'client-status'})).client?.instanceId,result.client?.instanceId);
});
test('legacy reload requests are rejected even with a complete release description',async()=>{
 const command={version:1,id:randomUUID(),kind:'reload-client',releaseVersion:'0.0.429',runtimeSha256:{'main.js':'a'.repeat(64),'manifest.json':'b'.repeat(64),'styles.css':'c'.repeat(64)}};
 assert.throws(()=>validateClientCommand(command),/Invalid client command/);
 await assert.rejects(new DesktopClientMaintenance('0.0.428').execute(command as unknown as ClientCommand),/Invalid client command/);
});
test('failure logs and diagnostic settings retain their existing validation',async()=>{
 const client=new DesktopClientMaintenance('0.0.429'),command:ClientCommand={version:1,id:randomUUID(),kind:'send-failure-log',since:'2026-10-09T17:40:00Z'};
 assert.equal((await client.execute(command)).ok,true);
 assert.equal((await client.execute({version:1,id:randomUUID(),kind:'diagnostic-settings',diagnosticPreferences:{connection:true}})).ok,true);
 for(const value of [{...command,since:'yesterday'},{...command,kind:'client-status'},{...command,releaseVersion:'0.0.429'},{...command,runtimeSha256:{}},{version:1,id:randomUUID(),kind:'app:save'}])assert.throws(()=>validateClientCommand(value));
});
