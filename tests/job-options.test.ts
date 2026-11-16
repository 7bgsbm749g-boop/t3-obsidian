import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveJobOptions,overrideCount} from '../src/conversations/job-options';
test('explicit false wins and legacy retention normalizes only new resolved jobs',()=>{
  const defaults={enabled:true,keepIntermediate:true};
  assert.deepEqual(resolveJobOptions(defaults,{inline:{enabled:false}}),{version:1,inline:{enabled:false,intermediateMode:'collapse',finalAnswerFormat:'formatted'}});
  assert.equal(overrideCount({inline:{enabled:false,intermediateMode:undefined}}),1);
  assert.deepEqual(defaults,{enabled:true,keepIntermediate:true});
});

for(const mode of ['remove','keep','collapse'] as const)test(`new jobs use the progress box despite saved ${mode} preferences and overrides`,()=>{
  assert.equal(resolveJobOptions({enabled:true,intermediateMode:mode},{inline:{intermediateMode:mode}}).inline.intermediateMode,'collapse');
  assert.equal(overrideCount({inline:{intermediateMode:mode}}),0);
});

test('model selections are frozen with the resolved job without mutating the composer draft',()=>{
 const draft={modelSelection:{instanceId:'p',model:'m',options:[{id:'effort',value:'high'}]}};
 const resolved=resolveJobOptions({enabled:true},draft);draft.modelSelection.options[0].value='low';
 assert.equal(resolved.modelSelection?.options?.[0].value,'high');
});

test('composer catalogs expose only available provider models and their advertised options',async()=>{
 const {composerModels,composerModelLabel}=await import('../src/conversations/composer-models');
 const models=composerModels({providers:[{enabled:false,instanceId:'disabled',models:[{slug:'wrong'}]},{enabled:true,availability:'unavailable',instanceId:'offline',models:[{slug:'wrong'}]},{enabled:true,instanceId:'active',displayName:'Provider',models:[{slug:'model',shortName:'Model',capabilities:{optionDescriptors:[{id:'reasoningEffort',label:'Effort',role:'reasoning',type:'select',options:[{id:'high',label:'High'}]}]}}]}]});
 assert.equal(models.length,1);assert.equal(models[0].selection.instanceId,'active');assert.equal(models[0].options[0].options[0].id,'high');
 assert.equal(composerModelLabel({...models[0].selection,options:[{id:'reasoningEffort',value:'high'}]},models),'Model High');
});
