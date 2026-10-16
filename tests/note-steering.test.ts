import {test} from 'node:test';
import assert from 'node:assert/strict';
import {noteSteeringTarget,type NoteSteeringCandidate} from '../note-steering';

const destination={notePath:'Note.md',threadId:'thread',projectId:'project',environmentId:'env'};
const running={id:'thread',projectId:'project',session:{status:'running',activeTurnId:'turn'},latestTurn:{turnId:'turn',state:'running'}};
const response:NoteSteeringCandidate={...destination,id:'response',state:{turnId:'turn',status:'running'}};

test('running sends select the exact attached turn and destination',()=>{
  const other=[{...response,id:'other-note',notePath:'Other.md'},{...response,id:'other-thread',threadId:'other'},{...response,id:'other-project',projectId:'other'},{...response,id:'other-env',environmentId:'other'},{...response,id:'old-turn',state:{turnId:'old',status:'running'}}];
  assert.equal(noteSteeringTarget(running,destination,[...other,response]),response);
  assert.equal(noteSteeringTarget(running,destination,other),undefined);
});

test('idle turns create a new response; terminal responses are not reused',()=>{
  assert.equal(noteSteeringTarget({...running,session:{status:'ready',activeTurnId:null},latestTurn:{state:'completed'}},destination,[response]),undefined);
  for(const status of ['complete','interrupted','error','cancelled'])assert.equal(noteSteeringTarget(running,destination,[{...response,state:{turnId:'turn',status}}]),undefined);
});

test('reloaded anchors wait for turn ownership rather than creating duplicates',()=>{
  assert.throws(()=>noteSteeringTarget(running,destination,[{...response,state:undefined}]),/reconnecting/);
  assert.throws(()=>noteSteeringTarget(running,destination,[{...response,state:{status:'waiting'}}]),/reconnecting/);
});

test('several streams of one turn require an exact selected response',()=>{
  const second={...response,id:'second'};
  assert.throws(()=>noteSteeringTarget(running,destination,[response,second]),/Several responses/);
  assert.equal(noteSteeringTarget(running,destination,[response,second],'second'),second);
  assert.throws(()=>noteSteeringTarget(running,destination,[response],'removed'),/no longer owns/);
});

test('pending approval and input never become an ordinary steering message',()=>{
  for(const key of ['hasPendingApprovals','hasPendingUserInput'])assert.throws(()=>noteSteeringTarget({...running,[key]:true},destination,[response]),/waiting for approval or input/);
});
