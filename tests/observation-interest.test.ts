import {test} from 'node:test';
import assert from 'node:assert/strict';
import {folderWorkflowIR} from '../v2-folder-workflow';
import {observationInterest} from '../observation-interest';

function workflow(id:string,folderPath:string,events:Array<'create'|'modify'>,enabled=true){
  return {...folderWorkflowIR({id,name:id,folderPath,includeSubfolders:true,events,task:'Format the note.',destinationId:'qlo2-vps',projectId:'project',enabled,order:0}),activatedAt:'2026-09-26T00:00:00.000Z'};
}

test('no enabled workflows request no baselines or observations',()=>{
  for(const workflows of [[],[workflow('paused','Gym',['modify'],false)]]){
    const interest=observationInterest(workflows);
    assert.equal(interest.active,false);
    assert.equal(interest.baseline('Gym/A.md'),false);
    assert.equal(interest.accepts('vault.modify','Gym/A.md'),false);
  }
});

test('a setup draft does not capture until it has an activation time',()=>{
  const pending=workflow('pending','Gym',['modify']);delete (pending as {activatedAt?:string}).activatedAt;
  assert.equal(observationInterest([pending]).active,false);
});

test('enabled subscriptions admit only their event types and folder scopes',()=>{
  const interest=observationInterest([workflow('created','Gym',['create']),workflow('changed','Inbox',['modify'])]);
  assert.equal(interest.baseline('Gym/A.md'),true);
  assert.equal(interest.baseline('Archive/A.md'),false);
  assert.equal(interest.accepts('vault.create','Gym/A.md'),true);
  assert.equal(interest.accepts('vault.modify','Gym/A.md'),false);
  assert.equal(interest.accepts('vault.modify','Inbox/A.md'),true);
  assert.equal(interest.accepts('metadata.changed','Inbox/A.md'),true);
  assert.equal(interest.accepts('vault.create','Inbox/A.md'),false);
  assert.equal(interest.accepts('vault.delete','Inbox/A.md'),false);
  assert.equal(interest.accepts('vault.modify','Archive/A.md'),false);
});
