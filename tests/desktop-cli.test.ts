import {test} from 'node:test';
import assert from 'node:assert/strict';
import {win32,posix,join} from 'node:path';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {selectDesktopCli,desktopLauncher,DESKTOP_LAUNCHER_MAX_BYTES} from './fixtures/baseline-native/desktop-cli';
import {runDesktop,desktopThreadAccess} from './fixtures/baseline-native/desktop';

const home='C:\\Users\\T3 user & (work)!';
const launcher=win32.join(home,'.t3/bin/t3.cmd');
const desktop=win32.join(home,'Apps/T3 Code (Nightly).exe');
const entry=win32.join(home,'Apps/resources/server.asar/apps/server/dist/bin.mjs');
function wrapper(executable=desktop,script=entry){return `@echo off
rem Written by T3 Code: runs the desktop app's bundled t3 CLI.
setlocal EnableExtensions DisableDelayedExpansion
set "T3CODE_CLI_PATH=${launcher}"
if not defined T3CODE_HOME set "T3CODE_HOME=${win32.join(home,'.t3')}"
set "ELECTRON_RUN_AS_NODE=1"
set "T3CODE_DESKTOP_CLI_LAUNCHER=1"
if exist "${executable}" goto run
echo T3 Code has moved or been removed. Open the app once to update this command. 1>&2
exit /b 127
:run
"${executable}" "${script}" %*
set "t3_exit=%ERRORLEVEL%"
exit /b %t3_exit%
`;}

test('Windows prefers the desktop launcher over a stale standalone executable and preserves overrides',()=>{
  const exe=win32.join(home,'.t3/bin/t3.exe');
  const exists=(path:string)=>[launcher,exe].includes(path);
  assert.equal(selectDesktopCli('win32',home,win32.join,exists),launcher);
  assert.equal(selectDesktopCli('win32',home,win32.join,exists,exe),exe);
  assert.equal(selectDesktopCli('win32',home,win32.join,path=>path===exe),exe);
  assert.equal(selectDesktopCli('linux','/home/test',posix.join,path=>path==='/usr/local/bin/t3'),'/usr/local/bin/t3');
});
test('the generated launcher is decoded without a shell and follows updated targets',()=>{
  const first=desktopLauncher(launcher,wrapper().replaceAll('\n','\r\n'));
  assert.equal(first.executable,desktop);assert.deepEqual(first.args,[entry]);
  assert.deepEqual(first.env,{ELECTRON_RUN_AS_NODE:'1',T3CODE_DESKTOP_CLI_LAUNCHER:'1',T3CODE_CLI_PATH:launcher,T3CODE_HOME:win32.join(home,'.t3')});
  const moved=desktopLauncher(launcher,wrapper('D:\\New & Updated\\T3.exe','D:\\New & Updated\\bin.mjs'),'E:\\custom home');
  assert.equal(moved.executable,'D:\\New & Updated\\T3.exe');assert.deepEqual(moved.args,['D:\\New & Updated\\bin.mjs']);assert.equal(moved.env.T3CODE_HOME,'E:\\custom home');
});
test('an unsupported or broken launcher fails closed instead of selecting the stale executable',()=>{
  for(const text of [wrapper().replace('ELECTRON_RUN_AS_NODE=1','ELECTRON_RUN_AS_NODE=0'),wrapper().replace('%*','%* & echo unsafe'),wrapper()+`"${desktop}" "${entry}" %*`,wrapper('%TEMP%\\T3.exe'),wrapper('relative.exe'),wrapper().replace('rem Written by T3 Code:','rem Other:'),'x'.repeat(DESKTOP_LAUNCHER_MAX_BYTES+1)]){
    assert.throws(()=>desktopLauncher(launcher,text),/official T3 desktop launcher/);
  }
});

for(const component of ['operation','stream'] as const)test(`a rejected new ${component} session reports versions, revokes only its credential, and never dispatches`,async()=>{
  const root=await mkdtemp(join(tmpdir(),'t3-cli-rejected-'));
  const calls=join(root,'calls.jsonl'),script=join(root,'t3.cjs');
  const requests:string[]=[];
  const server=createServer((req,res)=>{requests.push(req.url!);assert.equal(req.headers.authorization,'Bearer PRIVATE_CREDENTIAL');res.writeHead(401);res.end('PRIVATE_SERVER_BODY');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await mkdir(join(root,'userdata'));
    await writeFile(join(root,'userdata/server-runtime.json'),JSON.stringify({origin:`http://127.0.0.1:${(server.address() as {port:number}).port}`,serverVersion:'0.1.8-nightly.4205'}));
    await writeFile(script,`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args)+'\\n');
if(args[0]==='--version')console.log('t3 v0.0.43-nightly.1811');
else if(args[2]==='issue')console.log(JSON.stringify({token:'PRIVATE_CREDENTIAL',sessionId:'11111111-1111-4111-8111-111111111111'}));
`,{mode:0o700});
    const connection={host:'local',native:true,executable:script,baseDir:root};
    const operation=()=>component==='stream'?desktopThreadAccess(connection):runDesktop(connection,['projects']);
    await assert.rejects(operation,error=>{
      assert.equal((error as {status:number}).status,401);const message=(error as Error).message;
      assert.ok(message.includes(script));assert.match(message,/CLI version: 0\.0\.43-nightly\.1811/);assert.match(message,/T3 server version: 0\.1\.8-nightly\.4205/);
      assert.doesNotMatch(message,/PRIVATE_CREDENTIAL|PRIVATE_SERVER_BODY/);return true;
    });
    assert.deepEqual(requests,['/api/orchestration/shell']);
    const commands=(await readFile(calls,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
    assert.deepEqual(commands.map(args=>args[0]==='auth'?args[2]:args[0]),['issue','--version','revoke']);
    assert.equal(commands.at(-1).at(-1),'11111111-1111-4111-8111-111111111111');
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:25});
  }
});
