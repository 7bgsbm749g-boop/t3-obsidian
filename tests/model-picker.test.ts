import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {modelConfig} from './rpc-fixture';
const compiled=build({entryPoints:['src/conversations/model-picker.ts'],bundle:true,platform:'node',format:'cjs',write:false,external:['obsidian']});
test('picker filters unavailable providers and retains configured options without changing defaults',async()=>{
  const module={exports:{} as any};runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,require:()=>({FuzzySuggestModal:class{}})});
  const config:any=modelConfig();config.providers[0].models.push({slug:'gpt-5.6-sol'});
  config.settings.defaultModelSelection.options=[{id:'reasoningEffort',value:'high'}];
  config.providers.push({instanceId:'offline',enabled:true,status:'ready',availability:'unavailable',models:[{slug:'wrong'}]});
  const before=JSON.stringify(config),choices=module.exports.modelChoices(config,'p');
  assert.equal(choices.length,3);assert.equal(choices[0].selection,undefined);
  assert.equal(choices[2].selection.options[0].value,'high');
  choices[2].selection.options[0].value='low';assert.equal(JSON.stringify(config),before);
  assert.throws(()=>module.exports.modelChoices({},'p'),/defaults/);
});
