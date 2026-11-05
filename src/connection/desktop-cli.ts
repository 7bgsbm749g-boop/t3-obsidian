import {hasControlCharacters} from '../shared/values';

/** T3 rewrites its Windows launcher when the desktop app moves or updates.
 * Read that launcher again for each invocation; never cache a versioned target. */
export function selectDesktopCli(platform:string,home:string,join:(...parts:string[])=>string,exists:(path:string)=>boolean,override=''):string {
  if(override.trim())return override;
  const paths=platform==='win32'?[join(home,'.t3','bin','t3.cmd'),join(home,'.t3','bin','t3.exe'),join(home,'AppData','Local','Programs','t3-code-desktop','resources','t3.exe')]:[join(home,'.local','bin','t3'),'/usr/local/bin/t3','/opt/homebrew/bin/t3'];
  return paths.find(exists)??'t3';
}

export interface DesktopLauncher {executable:string;args:string[];env:Record<string,string>}
const launcherError=()=>Error('Cannot read the official T3 desktop launcher. Open T3 to refresh it, or select a supported T3 CLI executable in plugin settings. The old executable was not used.');
export const DESKTOP_LAUNCHER_MAX_BYTES=64*1024;
/** Decode only T3's generated launcher, not arbitrary batch programs. The
 * equivalent direct invocation preserves literal arguments without cmd.exe. */
export function desktopLauncher(path:string,source:string,inheritedHome?:string):DesktopLauncher {
  if(source.length>DESKTOP_LAUNCHER_MAX_BYTES)throw launcherError();
  const lines=source.replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!lines.some(line=>/^rem Written by T3 Code: runs the desktop app's bundled t3 CLI\.$/i.test(line))||
    !lines.some(line=>/^set "ELECTRON_RUN_AS_NODE=1"$/i.test(line))||
    !lines.some(line=>/^set "T3CODE_DESKTOP_CLI_LAUNCHER=1"$/i.test(line)))throw launcherError();
  const targets=lines.flatMap(line=>{const match=/^"([^"\r\n]+\.exe)" "([^"\r\n]+\.mjs)" %\*$/i.exec(line);return match?[match]:[];});
  const homes=lines.flatMap(line=>{const match=/^if not defined T3CODE_HOME set "T3CODE_HOME=([^"\r\n]+)"$/i.exec(line);return match?[match[1]]:[];});
  const absolute=(value:string)=>/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/i.test(value)&&!/[<>"|?*%]/.test(value)&&!hasControlCharacters(value);
  if(targets.length!==1||homes.length!==1||![targets[0][1],targets[0][2],homes[0]].every(absolute))throw launcherError();
  const cliPath=/^set "T3CODE_CLI_PATH=([^"\r\n]+)"$/i.exec(lines[3]??'')?.[1];
  if(!cliPath||!absolute(cliPath))throw launcherError();
  const expected=['@echo off',"rem Written by T3 Code: runs the desktop app's bundled t3 CLI.",'setlocal EnableExtensions DisableDelayedExpansion',
    `set "T3CODE_CLI_PATH=${cliPath}"`,`if not defined T3CODE_HOME set "T3CODE_HOME=${homes[0]}"`,
    'set "ELECTRON_RUN_AS_NODE=1"','set "T3CODE_DESKTOP_CLI_LAUNCHER=1"',`if exist "${targets[0][1]}" goto run`,
    'echo T3 Code has moved or been removed. Open the app once to update this command. 1>&2','exit /b 127',':run',
    `"${targets[0][1]}" "${targets[0][2]}" %*`,'set "t3_exit=%ERRORLEVEL%"','exit /b %t3_exit%'];
  if(lines.length!==expected.length||lines.some((line,index)=>line.toLowerCase()!==expected[index].toLowerCase()))throw launcherError();
  return {executable:targets[0][1],args:[targets[0][2]],env:{ELECTRON_RUN_AS_NODE:'1',T3CODE_DESKTOP_CLI_LAUNCHER:'1',T3CODE_CLI_PATH:path,T3CODE_HOME:inheritedHome||homes[0]}};
}
