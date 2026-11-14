import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AgentSetup,agentLaunchArguments,type AgentProvider} from '../src/agents/setup';
import {contentHash} from '../src/responses/completion';
import {connectAgentFiles,connectCommandFiles} from '../src/notes/connect-command-files';
const provider:AgentProvider={id:'codex_work',driver:'codex',name:'Work'};
function lab(selected=provider){
  const files=new Map<string,string>(),patches:unknown[]=[];
  let config:any={environment:{environmentId:'env',platform:{os:'linux'}},providers:[{instanceId:selected.id,driver:selected.driver,enabled:true,installed:true}],settings:{providerInstances:{[selected.id]:{driver:selected.driver,config:{launchArgs:'--strict-config',homePath:'/custom/home'},environment:[{name:'TOKEN',value:'',sensitive:true,valueRedacted:true}]},other:{driver:'future',config:{custom:true}}}}};
  const rpc={call:async(method:string,payload:any)=>{
    if(method==='server.getConfig')return structuredClone(config);
    assert.equal(method,'server.updateSettings');patches.push(structuredClone(payload));
    if(payload.patch.providerInstances)config.settings.providerInstances=structuredClone(payload.patch.providerInstances);
    if(payload.providerInstanceMutation){const change=payload.providerInstanceMutation;if(change.operation==='remove')delete config.settings.providerInstances[change.instanceId];else config.settings.providerInstances[change.instanceId]=structuredClone(change.instance);}
    return structuredClone(config.settings);
  }};
  const io={read:async(path:string)=>files.get(path),write:async(path:string,text:string)=>{files.set(path,text);},list:async()=>[]};
  const sources={'mcp_server.py':'# server','connect_commands.py':'# protocol','SKILL.md':'# skill',LICENSE:'MIT'},hash=contentHash(JSON.stringify(sources));
  return {files,patches,io,config,rpc,sources,hash,setup:new AgentSetup(rpc,io,'env','/t3/scratch',{files:sources,hash})};
}
test('one setup installs verified source and preserves unrelated instances, credentials and options',async()=>{
  const h=lab(),before=structuredClone(h.config.settings.providerInstances);assert.equal((await h.setup.inspect()).providers[0].id,provider.id);
  const result=await h.setup.install(provider,'python3');assert.equal(result.installed,true);assert.equal(h.patches.length,1);
  const after=h.config.settings.providerInstances;assert.deepEqual(after.other,before.other);assert.deepEqual(after[provider.id].environment,before[provider.id].environment);
  assert.equal(after[provider.id].config.homePath,'/custom/home');assert.ok(after[provider.id].config.launchArgs.startsWith('--strict-config -c '));
  assert.equal(h.files.get(result.bundle+'/SKILL.md'),'# skill');assert.equal((await h.setup.status(provider)).lastConnected,undefined);
  await h.setup.install(provider,'python3');assert.equal((await h.setup.status(provider)).installed,true);
  await h.setup.remove(provider);
  assert.deepEqual(h.config.settings.providerInstances,before);assert.equal((await h.setup.status(provider)).installed,false);
  assert.ok(h.files.has(result.bundle+'/mcp_server.py'),'live sessions retain immutable assets');
});
test('changed user options, wrong machines and modified installed code stop without replacing them',async()=>{
  const h=lab();const result=await h.setup.install(provider,'python3');
  h.config.settings.providerInstances[provider.id].config.launchArgs+=' --user-option';
  const changed=h.config.settings.providerInstances[provider.id].config.launchArgs;
  await assert.rejects(h.setup.remove(provider),/changed/);await assert.rejects(h.setup.install(provider,'python3'),/changed/);assert.equal(h.config.settings.providerInstances[provider.id].config.launchArgs,changed);
  const other=lab();other.config.environment.environmentId='wrong';await assert.rejects(other.setup.install(provider,'python3'),/machine changed/);assert.equal(other.files.size,0);assert.equal(other.patches.length,0);
  const modified=lab();modified.files.set(result.bundle+'/mcp_server.py','user custom code');await assert.rejects(modified.setup.install(provider,'python3'),/tool changed/);assert.equal(modified.patches.length,0);
});
test('source upload must read back completely before changing agent launch settings',async()=>{
  const h=lab();h.io.write=async()=>{};await assert.rejects(h.setup.install(provider,'python3'),/complete agent tool/);assert.equal(h.patches.length,0);
});
test('prepared receipts recover a settings write whose acknowledgement was lost',async()=>{
  const h=lab(),call=h.rpc.call;let fail=true;
  h.rpc.call=async(method,payload)=>{const result=await call(method,payload);if(method==='server.updateSettings'&&fail){fail=false;throw Error('connection lost after write');}return result;};
  await assert.rejects(h.setup.install(provider,'python3'),/connection lost/);
  await h.setup.install(provider,'python3');const launch=h.config.settings.providerInstances[provider.id].config.launchArgs;
  assert.equal(launch.match(/mcp_servers\.t3-obsidian/g)?.length,1);await h.setup.remove(provider);assert.equal(h.config.settings.providerInstances[provider.id].config.launchArgs,'--strict-config');
});
test('a temporary provider-health refresh cannot turn a verified settings save into a failed install',async()=>{
  const h=lab(),call=h.rpc.call;
  h.rpc.call=async(method,payload)=>{const result=await call(method,payload);if(method==='server.updateSettings')h.config.providers[0].installed=false;return result;};
  assert.equal((await h.setup.install(provider,'python3')).installed,true);
  assert.equal(JSON.parse(h.files.get('.t3-obsidian/agent-tools/installations/'+provider.id+'.json')!).status,'installed');
});
test('Claude setup keeps custom settings and refuses conflicting MCP configuration',async()=>{
  const claude:AgentProvider={id:'claudeAgent',driver:'claudeAgent',name:'Claude'},h=lab(claude);
  const result=await h.setup.install(claude,'/usr/bin/python3');assert.ok(h.config.settings.providerInstances.claudeAgent.config.launchArgs.includes('--mcp-config'));
  await h.setup.remove(claude);await h.setup.install(claude,'/other/python3');assert.ok(h.files.has(result.bundle+'/mcp_server.py'));
  const collision=lab(claude);collision.config.settings.providerInstances.claudeAgent.config.launchArgs='--mcp-config /private/existing.json';await assert.rejects(collision.setup.install(claude,'python3'),/custom MCP/);assert.equal(collision.patches.length,0);
});
test('Windows paths and executable names remain single structured arguments',()=>{
  const result=agentLaunchArguments('codex','C:\\Python 3\\python.exe','C:\\T3 Data\\mcp_server.py','C:\\T3 Data\\scratch','unused');
  assert.ok(result.includes('mcp_servers.t3-obsidian'));assert.ok(result.includes('Python 3'));assert.ok(result.includes('--transport-root'));
  assert.throws(()=>agentLaunchArguments('codex','python3\n--evil','server','root','config'),/executable/);
});
test('real file adapters isolate setup assets from command requests and permit a complete install',async()=>{
  const h=lab();const rpc={call:async(method:string,input:unknown):Promise<unknown>=>{
    const payload=input as {relativePath:string;contents?:string};
    if(method==='projects.writeFile'){h.files.set(payload.relativePath,payload.contents!);return {relativePath:payload.relativePath};}
    if(method==='projects.readFile'){const contents=h.files.get(payload.relativePath);if(contents===undefined)throw {kind:'ProjectReadFileError'};return {contents,truncated:false};}
    return h.rpc.call(method,input);
  }};
  const agent=connectAgentFiles(rpc,'/t3/scratch'),commands=connectCommandFiles(rpc,'/t3/scratch');
  const setup=new AgentSetup(rpc,agent,'env','/t3/scratch',{files:h.sources,hash:h.hash});await setup.install(provider,'python3');assert.equal((await setup.status(provider)).installed,true);
  await assert.rejects(agent.read('.t3-obsidian/clients/secret'),/transport path/);
  await assert.rejects(commands.read('.t3-obsidian/agent-tools/bundle'),/transport path/);
  await assert.rejects(agent.write('.t3-obsidian/agent-tools/../../outside','bad'),/transport path/);
});

test('default instances without the removed legacy providers map can be configured',async()=>{
  const selected:AgentProvider={id:'codex',driver:'codex',name:'Codex'},h=lab(selected);
  h.config.settings.providerInstances={};
  await h.setup.install(selected,'python3');
  assert.equal(h.config.settings.providerInstances.codex.driver,'codex');
  assert.ok(h.config.settings.providerInstances.codex.config.launchArgs.includes('mcp_servers.t3-obsidian'));
  await h.setup.remove(selected);assert.deepEqual(h.config.settings.providerInstances,{});
});
test('numeric UUID instance identities and all supported adapters are detected without enabling other agents',async()=>{
  const h=lab();h.config.providers=[...['codex','claudeAgent','cursor','opencode','grok'].map((driver,index)=>({driver,instanceId:'1abc-'+index,enabled:true,installed:true,displayName:driver})),{driver:'cursor',instanceId:'disabled',enabled:false,installed:true}];
  const state=await h.setup.inspect();assert.equal(state.providers.length,4);assert.deepEqual(state.unsupported.map(value=>value.driver),['grok']);assert.equal(h.patches.length,0);
});
test('Cursor gets its own MCP plugin while OpenCode merges an additional config layer',async()=>{
  for(const driver of ['cursor','opencode'] as const){
    const selected:AgentProvider={id:driver,driver,name:driver},h=lab(selected),before=structuredClone(h.config.settings.providerInstances);
    const result=await h.setup.install(selected,'python3');
    if(driver==='cursor'){
      assert.ok(h.config.settings.providerInstances.cursor.config.launchArgs.includes('--plugin-dir'));
      const config=[...h.files].find(([path])=>path.endsWith('/mcp.json'))!;assert.equal(JSON.parse(config[1]).mcpServers['t3-obsidian'].type,'stdio');
    }else{
      const environment=h.config.settings.providerInstances.opencode.environment,setting=environment.find((entry:any)=>entry.name==='OPENCODE_CONFIG');assert.ok(setting.value.endsWith('.json'));
      const source=[...h.files].find(([path])=>setting.value.endsWith(path))!;assert.equal(JSON.parse(source[1]).mcp['t3-obsidian'].type,'local');
    }
    assert.equal((await h.setup.status(selected)).owned,true);await h.setup.remove(selected);assert.deepEqual(h.config.settings.providerInstances,before);assert.ok(h.files.has(result.bundle+'/mcp_server.py'));
  }
});
test('a changed OpenCode custom config is kept and forged receipts cannot change unrelated environment variables',async()=>{
  const selected:AgentProvider={id:'opencode',driver:'opencode',name:'OpenCode'},h=lab(selected);
  h.config.settings.providerInstances.opencode.environment.push({name:'OPENCODE_CONFIG',value:'/my/custom.json'});
  await assert.rejects(h.setup.install(selected,'python3'),/Custom OpenCode/);assert.equal(h.patches.length,0);
  const own=lab(selected);await own.setup.install(selected,'python3');const path='.t3-obsidian/agent-tools/installations/opencode.json',receipt=JSON.parse(own.files.get(path)!);receipt.environment.name='OTHER_VARIABLE';own.files.set(path,JSON.stringify(receipt));
  await assert.rejects(own.setup.remove(selected),/environment receipt/);assert.equal(own.patches.length,1);
});
test('manual setup prepares the shared server and skill without changing any harness settings',async()=>{
  const h=lab();assert.equal(await h.setup.manual('python3'),undefined);
  const result=await h.setup.prepare('python3');assert.equal(JSON.parse(result.config).mcpServers['t3-obsidian'].command,'python3');assert.ok(result.path.startsWith('/t3/scratch/.t3-obsidian/agent-tools/'));
  assert.deepEqual(await h.setup.manual('python3'),result);assert.equal(h.patches.length,0);
  h.files.set(result.path.replace('/t3/scratch/',''),'changed');await assert.rejects(h.setup.prepare('python3'),/tool changed/);assert.equal(h.patches.length,0);
});
test('background detection finds a deleted server asset and a retry repairs it before reusing settings',async()=>{
  const h=lab(),result=await h.setup.install(provider,'python3');assert.equal((await h.setup.status(provider)).installed,true);
  h.files.delete(result.bundle+'/mcp_server.py');assert.equal((await h.setup.status(provider)).installed,false);
  await h.setup.install(provider,'python3');assert.equal((await h.setup.status(provider)).installed,true);
});

test('disconnect restores owned options after an agent is disabled without enabling it',async()=>{
 const h=lab();await h.setup.install(provider,'python3');h.config.providers[0].enabled=false;h.config.settings.providerInstances[provider.id].enabled=false;
 const state=await h.setup.inspect();assert.equal(state.providers.length,0);assert.equal(state.inactive?.[0].id,provider.id);
 await assert.rejects(h.setup.install(provider,'python3'),/unavailable/);
 await h.setup.remove(provider);assert.equal(h.config.settings.providerInstances[provider.id].config.launchArgs,'--strict-config');assert.equal(h.config.settings.providerInstances[provider.id].enabled,false);assert.equal((await h.setup.status(provider)).owned,false);
});
