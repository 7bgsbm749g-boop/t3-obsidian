import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {build} from './build-fixture';
import {runInNewContext} from './obsidian-context';
import {updateTitle,type UpdateState} from '../src/app/plugin-updates';
const compiled=build({entryPoints:['src/app/update-banner.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
async function fixture(body='Release description.\n\n## What’s Changed\n- **Fix** a saved reply.\n- [Full changelog](https://github.com/example/repo/compare/1...2)'){
 const {document}=parseHTML('<html><body><main><article>Existing note</article></main></body></html>'),module={exports:{} as any};let sanitized=0;
 runInNewContext((await compiled).outputFiles[0].text,{module,exports:module.exports,document,TextEncoder,TextDecoder,require:()=>({sanitizeHTMLToDom:(html:string)=>{sanitized++;return document.createRange().createContextualFragment(html);}})});
 const root=document.querySelector('main')!;let updates=0,dismissals=0;
 const banner=new module.exports.UpdateBanner(root,()=>{updates++;},()=>{dismissals++;});const state:UpdateState={release:{version:'0.0.451',tag:'0.0.451',body,assets:{} as any},busy:false,message:updateTitle('0.0.451')};
 return {root,banner,state,sanitized:()=>sanitized,updates:()=>updates,dismissals:()=>dismissals,buttons:()=>Array.from(root.querySelectorAll('button'))};
}
test('banner uses exact requested heading and renders GitHub prose, headings and bullets below it',async()=>{
 const f=await fixture();f.banner.render(f.state);
 assert.equal(f.root.firstElementChild!.getAttribute('aria-label'),'T3 Code update');
 assert.equal(f.root.querySelector('.t3-update-banner-title')!.textContent,'Update available for t3-obsidian (v0.0.451)');
 const notes=f.root.querySelector('.t3-update-banner-notes')!;assert.equal(notes.getAttribute('aria-label'),'Release notes');assert.equal(notes.getAttribute('tabindex'),'0');
 assert.match(notes.querySelector('p')!.textContent!,/Release description/);assert.equal(notes.querySelector('h2')!.textContent,'What’s Changed');assert.equal(notes.querySelectorAll('li').length,2);assert.equal(notes.querySelector('strong')!.textContent,'Fix');assert.equal(f.sanitized(),1);
 const link=notes.querySelector('a')!;assert.equal(link.getAttribute('href'),'https://github.com/example/repo/compare/1...2');assert.equal(link.getAttribute('rel'),'noopener noreferrer');assert.equal(link.getAttribute('target'),'_blank');
 assert.equal(f.root.querySelector('.t3-update-banner')!.children[1],notes);
 const actions=f.root.querySelector('.t3-update-banner-actions')!;assert.equal(actions.parentElement,notes.parentElement);assert.equal(notes.nextElementSibling,actions);assert.equal(f.root.querySelector('.t3-update-banner-header button'),null);
});
test('actions and status remain separate from the heading and notes during update or failure',async()=>{
 const f=await fixture();f.banner.render(f.state);f.buttons()[0].click();f.buttons()[1].click();assert.equal(f.updates(),1);assert.equal(f.dismissals(),1);
 for(const [busy,message] of [[true,'Updating…'],[false,'Update failed. Try again.']] as const){
  f.banner.render({...f.state,busy,message});assert.equal(f.root.querySelectorAll('.t3-update-banner').length,1);assert.equal(f.root.querySelector('.t3-update-banner-title')!.textContent,updateTitle('0.0.451'));assert.equal(f.root.querySelector('[role="status"]')!.textContent,message);assert.ok(f.buttons().every(button=>button.disabled===busy));assert.equal(f.root.querySelectorAll('li').length,2);
 }
 f.banner.dispose();assert.equal(f.root.textContent,'Existing note');
});
test('missing notes have a clear fallback; long release descriptions retain every item',async()=>{
 const f=await fixture('   ');f.banner.render(f.state);assert.match(f.root.textContent!,/No release notes were provided/);assert.equal(f.sanitized(),0);
 f.banner.render({...f.state,release:{...f.state.release,body:Array.from({length:200},(_,i)=>`- Change ${i+1}`).join('\n')}});assert.equal(f.root.querySelectorAll('li').length,200);assert.match(f.root.textContent!,/Change 200/);assert.equal(f.buttons().length,2);
});
test('GitHub notes cannot inject HTML handlers, scripts, unsafe links or vault embeds',async()=>{
 const f=await fixture('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[unsafe](javascript:alert%281%29)\n\n![[Private note]]');f.banner.render(f.state);
 assert.equal(f.root.querySelector('script, img, [onerror], .internal-embed'),null);assert.equal(f.root.querySelector('a')!.getAttribute('href'),'');assert.match(f.root.textContent!,/<script>/);assert.match(f.root.textContent!,/Private note/);
});
