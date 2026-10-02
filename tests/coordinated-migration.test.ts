import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planNativeMigration} from '../coordinated-migration';
import {initialRegion} from '../inline-thread';
import {responseAnchor} from '../native-response-projection';
const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
test('migration planning preserves exact many-to-many registrations, provenance and personal data without mutation',()=>{
  const region=initialRegion(id),record:any={request:{id,notePath:'Ready/Arms.md',initialHash:region.bodyHash},owner:'phone',epoch:8,expiresAt:123,revision:31,state:{status:'running',notePath:'Ready/Arms.md',hashes:[region.bodyHash],incoming:[{messageId:'incoming',label:'You · Author'}],bindingCheckpoint:{bindings:{request:{turnId:'exact-turn',kind:'explicit'}}}}};
  const before='Workout numbers: 20, 16, 12\nHistory\n'+region.text+'\nAnother registration';
  const copy=structuredClone(record),plan=planNativeMigration(record,before);assert.equal(plan.kind,'planned');
  if(plan.kind==='planned'){assert.deepEqual(plan.legacy,copy);assert.ok(plan.after.includes('Workout numbers: 20, 16, 12\nHistory'));assert.ok(plan.after.includes(responseAnchor(id)));assert.ok(plan.after.endsWith('\nAnother registration'));assert.ok(plan.localBody.includes('Working'));}
  assert.deepEqual(record,copy);assert.ok(before.includes('Working'));
});
test('unknown content, ambiguous boundaries and unfinished cleanup retain legacy ownership',()=>{
  const region=initialRegion(id),record:any={request:{id,notePath:'Arms.md',initialHash:region.bodyHash},state:{status:'running',notePath:'Arms.md',hashes:[region.bodyHash]}};
  for(const document of [region.text.replace('Working','User edited'),region.text+region.text,'No markers'])assert.equal(planNativeMigration(record,document).kind,'retain-legacy');
  assert.equal(planNativeMigration({...record,state:{...record.state,finalSaved:true}},region.text).kind,'retain-legacy');
});
