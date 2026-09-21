import {build} from 'esbuild';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';

const bundle=await build({entryPoints:['tests/workflow-menu.browser.ts'],bundle:true,write:false,format:'iife',plugins:[{name:'obsidian-icons',setup(build){build.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'fixture'}));build.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export function setIcon(el){el.innerHTML='<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="3" r="1"/><circle cx="11" cy="3" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="5" cy="13" r="1"/><circle cx="11" cy="13" r="1"/></svg>';}`}));}}]});
const css=await readFile('styles.css','utf8');
const html=`<!doctype html><html><head><meta charset="utf-8"><title>T3 workflow menu interaction tests</title><style>
:root{--text-muted:#aaa;--text-faint:#888;--font-ui-smaller:11px;--background-modifier-hover:#ffffff15;color-scheme:dark}body{font:14px system-ui;background:#1e1e1e;color:#ddd;margin:48px}#fixtures{position:absolute;top:45px;left:420px;width:340px}.nav-folder-title{padding:8px;margin-bottom:20px}.menu{background:#252525;border:1px solid #444;border-radius:6px;padding:6px;width:310px;box-shadow:0 10px 20px #0005}.menu-scroll{max-height:450px;overflow-y:auto}.menu-item{display:flex;align-items:center;padding:6px 8px;min-height:22px;cursor:default;border-radius:4px;white-space:nowrap}.menu-item:hover{background:#ffffff10}.menu-item-title{flex:1}.menu-separator{height:1px;background:#444;margin:6px}pre{font-size:11px;white-space:pre-wrap;width:340px}
${css}</style></head><body><h2>Workflow menu checks</h2><pre id="results">Running…</pre><div id="fixtures"></div><script src="/test.js"></script></body></html>`;
const server=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/test.js'?'text/javascript':'text/html');response.end(request.url==='/test.js'?bundle.outputFiles[0].text:html);});
server.listen(5187,'127.0.0.1',()=>console.log('Workflow menu fixture: http://127.0.0.1:5187'));
