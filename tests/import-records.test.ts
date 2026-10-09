import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readImportRecordsPage} from '../import-records';
import {leasePaths} from '../inline-lease';
import {hostedPaths} from '../hosted-inline';
import {validateResponseCommand} from '../response-command';

const identity={vaultId:'vault',environmentId:'host',workspaceRoot:'/vault',directory:'.obsidian/t3-code/inline/v1'},source={threadId:'source',projectId:'project',environmentId:'host'};
function fixture(){
 const storage=new Map<string,string>(),reads:string[]=[];
 const files={read:async(path:string)=>{reads.push(path);return storage.get(path);},list:async(directory:string)=>[...storage.keys()].filter(path=>path.startsWith(directory+'/'))};
 const add=(overrides:any={},state:any={},requestFile=true)=>{
  const request={id:randomUUID(),vaultId:identity.vaultId,threadId:source.threadId,projectId:source.projectId,threadEnvironmentId:source.environmentId,...overrides};
  storage.set(leasePaths(identity.directory,request.id).record,JSON.stringify({request,state}));
  if(requestFile)storage.set(hostedPaths(identity.directory,request.id).request,JSON.stringify(request));return request;
 };
 return {storage,reads,files,add};
}
test('host filters hundreds of unrelated requests and returns compact oversized matching leases without writes',async()=>{
 const h=fixture();for(let n=0;n<645;n++){const request=h.add({threadId:'other'});h.storage.set(leasePaths(identity.directory,request.id).record,'Unreadable unrelated body');}
 const request=h.add({}, {body:'x'.repeat(1_600_000),finalBody:'x'.repeat(1_600_000),bindingCheckpoint:{bindings:{prompt:{turnId:'run',kind:'explicit'}},turns:{run:{turnId:'run',messageId:'prompt',state:'completed'}},inputBoundaries:{private:'x'.repeat(1_600_000)}}});
 const before=[...h.storage],result=await readImportRecordsPage(h.files,identity,source);
 assert.equal(result.importRecords.length,1);assert.equal(result.importRecords[0].request.id,request.id);assert.ok(JSON.stringify(result).length<5000);
 assert.equal(h.reads.filter(path=>path.includes('/leases/')).length,1);assert.deepEqual([...h.storage],before);
 assert.equal(result.importRecords[0].state?.bindingCheckpoint?.turns?.run.messageId,'prompt');
});
test('missing or incomplete legacy requests use the full local lease, and source identities remain exact',async()=>{
 const h=fixture(),legacy=h.add({}, {},false),incomplete=h.add();
 h.storage.set(hostedPaths(identity.directory,incomplete.id).request,JSON.stringify({id:incomplete.id}));
 for(const overrides of [{vaultId:'other'},{projectId:'other'},{threadId:'other'},{threadEnvironmentId:'other'}])h.add(overrides);
 const page=await readImportRecordsPage(h.files,identity,source);
 assert.deepEqual(new Set(page.importRecords.map(record=>record.request.id)),new Set([legacy.id,incomplete.id]));
});
test('compact pages stay below the file-read limit and preserve every exact record once',async()=>{
 const h=fixture();for(let n=0;n<70;n++)h.add({initialInput:{text:'x'.repeat(15000)}});
 const ids:string[]=[];let cursor:string|undefined,pages=0;
 do{const page=await readImportRecordsPage(h.files,identity,source,cursor);assert.ok(new TextEncoder().encode(JSON.stringify(page)).length<512_000);assert.ok(page.importRecords.length<=64);ids.push(...page.importRecords.map(record=>record.request.id));cursor=page.nextCursor;pages++;}while(cursor);
 assert.ok(pages>1);assert.equal(ids.length,70);assert.equal(new Set(ids).size,70);
 const tooLarge=fixture();tooLarge.add({initialInput:{text:'x'.repeat(500001)}});await assert.rejects(readImportRecordsPage(tooLarge.files,identity,source),/exceeds its read limit/);
});
test('bulk import command validates exact source and opaque binding cursor',()=>{
 const command={version:1,id:randomUUID(),kind:'response-import-records',source};assert.deepEqual(validateResponseCommand(command),command);
 for(const value of [{...command,source:{...source,projectId:''}},{...command,cursor:'../wrong'},{...command,source:undefined}])assert.throws(()=>validateResponseCommand(value),/exact import source/);
});
