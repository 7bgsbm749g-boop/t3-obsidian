import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveNewThreadModel,readNewThreadModel} from '../model-defaults';
import {modelConfig,settingsSocket} from './rpc-fixture';

test('new threads use the configured environment default without adding reasoning options',()=>{
  const config=modelConfig();
  assert.deepEqual(resolveNewThreadModel(config,{id:'p'}),{instanceId:'codex',model:'gpt-5.6-sol'});
  assert.equal(Object.hasOwn(resolveNewThreadModel(config,{id:'p'}),'options'),false);
});

test('project overrides preserve configured reasoning and explicit automatic selection',()=>{
  const config:any=modelConfig();
  const model={instanceId:'codex',model:'project-model',options:[{id:'reasoningEffort',value:'medium'},{id:'fastMode',value:false}]};
  config.settings.projectSettingsOverrides.p={defaultModelSelection:model};
  assert.deepEqual(resolveNewThreadModel(config,{id:'p'}),model);
  config.settings.projectSettingsOverrides.p.defaultModelSelection=null;
  assert.deepEqual(resolveNewThreadModel(config,{id:'p'}),{instanceId:'codex',model:'automatic-model'});
  assert.equal(resolveNewThreadModel(config,{id:'other'}).model,'gpt-5.6-sol');
});

test('legacy project defaults apply only before migration, and resets ignore stale aggregates',()=>{
  const config:any=modelConfig(),project={id:'p',defaultModelSelection:{instanceId:'codex',model:'legacy'}};
  assert.equal(resolveNewThreadModel(config,project).model,'gpt-5.6-sol');
  config.settings.projectSettingsFolded=false;
  assert.equal(resolveNewThreadModel(config,project).model,'legacy');
  config.settings.projectSettingsOverrides.p={defaultModelSelection:null};
  assert.equal(resolveNewThreadModel(config,project).model,'automatic-model');
});

test('disabled project overrides inherit global defaults, unavailable globals use an enabled provider catalog',()=>{
  const config:any=modelConfig();
  config.providers.push({instanceId:'disabled',enabled:false,status:'ready',models:[{slug:'wrong'}]});
  config.settings.projectSettingsOverrides.p={defaultModelSelection:{instanceId:'disabled',model:'wrong',options:[{id:'reasoningEffort',value:'xhigh'}]}};
  assert.equal(resolveNewThreadModel(config,{id:'p'}).model,'gpt-5.6-sol');
  config.providers[0].availability='unavailable';
  config.providers.push({instanceId:'other',enabled:true,status:'ready',models:[{slug:'custom',isCustom:true},{slug:'provider-default',isDefault:true}]});
  assert.deepEqual(resolveNewThreadModel(config,{id:'p'}),{instanceId:'other',model:'provider-default'});
  config.providers[2].status='error';
  assert.throws(()=>resolveNewThreadModel(config,{id:'p'}),/No default model/);
});

test('an explicitly chosen provider is retained during probe errors; missing config never guesses',()=>{
  const config=modelConfig();config.providers[0].status='error';
  assert.equal(resolveNewThreadModel(config,{id:'p'}).model,'gpt-5.6-sol');
  for(const invalid of [undefined,{}, {providers:[],settings:{}}])assert.throws(()=>resolveNewThreadModel(invalid,{id:'p'}),/model defaults/);
});

test('authenticated model reads use a one-time socket ticket and close on success or invalid settings',async()=>{
  for(const invalid of [false,true]){
    let closed=false;
    const Socket=settingsSocket(()=>invalid?{}:modelConfig());
    class TrackedSocket extends Socket {close(){closed=true;super.close();}}
    const api=async(path:string,payload:any)=>{assert.equal(path,'/api/auth/websocket-ticket');assert.deepEqual(payload,{});return {ticket:'ephemeral'};};
    const result=readNewThreadModel(api,'https://selected.example',{id:'p'},url=>new TrackedSocket(url) as any);
    if(invalid)await assert.rejects(result,/model defaults/);else assert.equal((await result).model,'gpt-5.6-sol');
    assert.equal(closed,true);
  }
});
