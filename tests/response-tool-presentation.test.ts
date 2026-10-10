import test from 'node:test';
import assert from 'node:assert/strict';
import {presentToolGroups,canonicalToolGroup,toolDisplayOffset,restoreToolGroups,recoverToolGroups,compactToolGroups,assertCanonicalToolGroups,mountToolGroups} from '../response-tool-presentation';
import {renderResponseToolGroup,type ResponseTool,type ResponseToolGroup} from '../response-tools';
const tool=(id='one',output='exact output'):ResponseTool=>({id,turnId:'turn',key:JSON.stringify(['turn',id]),status:'completed',label:'Ran npm',activeLabel:'Running npm',icon:'terminal',action:'command',sequence:1,command:'npm test',output});
const group=(id='group',output='exact output',count=2):ResponseToolGroup=>({id,turnId:'turn',tools:Array.from({length:count},(_,i)=>tool(String(i),output))});
const html=(id='group',output='exact output',count=2)=>renderResponseToolGroup(group(id,output,count));
test('large nested generated groups leave CodeMirror while exact canonical bytes and summaries remain available',()=>{
 const original=html('large','🎯 private detail '.repeat(1500),20),canonical='Before.\n\n> '+original+'\n\nFinal prose.\n',p=presentToolGroups(canonical);
 assert.ok(canonical.length>300_000);assert.ok(p.display.length<800);assert.equal(p.canonical,canonical);assert.equal(p.groups.length,1);assert.equal(p.groups[0].ref.length,64);assert.equal(canonicalToolGroup(p,p.groups[0].ref),original);assert.equal(p.groups[0].canonicalTo-p.groups[0].canonicalFrom,original.length);assert.match(p.display,/Ran 20 commands/);assert.doesNotMatch(p.display,/private detail/);assert.equal(restoreToolGroups(p.display,p),canonical);assert.deepEqual(toolDisplayOffset(p,2),{kind:'canonical',offset:2});assert.deepEqual(toolDisplayOffset(p,p.groups[0].displayFrom+10),{kind:'tool',ref:p.groups[0].ref,from:p.groups[0].canonicalFrom,to:p.groups[0].canonicalTo});assert.deepEqual(toolDisplayOffset(p,p.display.length),{kind:'canonical',offset:canonical.length});
});
test('tool bytes are restored exactly while ordinary edits stay on both sides',()=>{
 const first=html('first','one'),second=html('second','two'),canonical='Before\n'+first+'\nBetween\n'+second+'\nAfter',p=presentToolGroups(canonical),edited=p.display.replace('Before','Edited before').replace('Between','New middle').replace('After','Edited after');
 assert.equal(restoreToolGroups(edited,p),'Edited before\n'+first+'\nNew middle\n'+second+'\nEdited after');assert.equal(p.groups.length,2);assert.deepEqual(toolDisplayOffset(p,p.groups[1].displayFrom-1),{kind:'canonical',offset:p.groups[1].canonicalFrom-1});
 assert.throws(()=>restoreToolGroups(edited.replace(p.groups[0].placeholder,''),p),/changed|removed/);assert.throws(()=>restoreToolGroups(edited+p.groups[0].placeholder,p),/duplicated/);assert.throws(()=>restoreToolGroups(''+p.groups[1].placeholder+p.groups[0].placeholder,p),/changed|removed/);assert.equal(presentToolGroups(p.display).display,p.display);
});
test('arbitrary Markdown, quoted HTML, code fences, raw literal containers and escaped tags remain byte identical',()=>{
 const original=html();
 for(const example of ['```html\n'+original+'\n```','> ~~~\n> '+original+'\n> ~~~','`'+original+'`','`` preceding\n'+original+'\nfollowing ``','    '+original,'<pre><code>'+original+'</code></pre>','<textarea>'+original+'</textarea>','<!-- '+original+' -->','\\'+original,'<details><summary>User details</summary><div>user output</div></details>',original.replace('send-to-t3-tool-group-content','user-content'),original.replace('data-t3-tool-key=','data-other-key='),original.replace('</div></details>','</div>'),original.replace('<summary>','<script>unsafe</script><summary>')]){
  const p=presentToolGroups(example);assert.equal(p.display,example);assert.equal(p.groups.length,0);
 }
 const mixed='```html\n'+original+'\n```\n\n> '+original+'\n';assert.equal(presentToolGroups(mixed).groups.length,1);
});
test('backticks, escaped closing tags and quote characters in generated output do not corrupt following groups',()=>{
 const first=html('ticks','`one` ``two`` <details> "quoted" > & </details>'),second=html('next','`unmatched'),p=presentToolGroups(first+'\n'+second);
 assert.equal(p.groups.length,2);assert.equal(canonicalToolGroup(p,p.groups[0].ref),first);assert.equal(canonicalToolGroup(p,p.groups[1].ref),second);assert.equal(restoreToolGroups(p.display,p),first+'\n'+second);
 const a=presentToolGroups(first),b=presentToolGroups(first);assert.equal(a.groups[0].ref,b.groups[0].ref);assert.notEqual(a.groups[0].ref,presentToolGroups(html('ticks','changed')).groups[0].ref);
});
test('unmatched generated summaries are rejected while literal copies remain ordinary bytes',()=>{
 const p=presentToolGroups(html()),compact=p.display,empty={canonical:'',display:'',groups:[]};
 assert.equal(compactToolGroups(compact).length,1);assert.throws(()=>assertCanonicalToolGroups(compact),/no canonical/);assert.throws(()=>restoreToolGroups(compact,empty),/copied/);
 for(const literal of ['```html\n'+compact+'\n```','> ~~~\n> '+compact+'\n> ~~~','`'+compact+'`','`` preceding\n'+compact+'\nfollowing ``','    '+compact,'<pre><code>'+compact+'</code></pre>','<textarea>'+compact+'</textarea>','<!-- '+compact+' -->','\\'+compact,'<details data-t3-tool-ref="ordinary"><summary>User details</summary></details>']){
  assert.equal(compactToolGroups(literal).length,0);assert.equal(restoreToolGroups(literal,empty),literal);assert.doesNotThrow(()=>assertCanonicalToolGroups(literal));
 }
 const literal='```html\n'+compact+'\n```\n';assert.equal(restoreToolGroups(literal+compact,p),literal+p.canonical);
 const prior=html('backtick','`unmatched'),next=prior+'\n'+compact;assert.equal(compactToolGroups(next).length,1);assert.throws(()=>assertCanonicalToolGroups(next),/no canonical/);
 const malformed=compact.replace('</div></details>','');assert.equal(compactToolGroups(malformed)[0].complete,false);assert.throws(()=>assertCanonicalToolGroups(malformed),/no canonical/);assert.throws(()=>recoverToolGroups(malformed,p),/cannot be recovered/);
 assert.doesNotThrow(()=>assertCanonicalToolGroups('```html\n'+malformed+'\n```'));
 for(const changed of [compact.replace(' data-t3-tool-ref=',' data-custom="changed" data-t3-tool-ref='),compact.replace(`data-t3-tool-ref="${p.groups[0].ref}"`,`data-t3-tool-ref='${p.groups[0].ref}'`)])assert.throws(()=>assertCanonicalToolGroups(changed),/no canonical/);
});
test('damaged known summaries recover exact backing and surrounding edits, while changed identities stay unresolved',()=>{
 const canonical='Before\n'+html('first','retained first')+'\nAfter',p=presentToolGroups(canonical),damaged=p.display.replace('Before','Incoming before').replace('After','Incoming after').replace('Open to view tool details.','Changed summary');
 assert.throws(()=>restoreToolGroups(damaged,p),/changed/);assert.equal(recoverToolGroups(damaged,p),canonical.replace('Before','Incoming before').replace('After','Incoming after'));
 for(const ref of ['', 'f'.repeat(64),'unknown']){
  const changed=damaged.replace(p.groups[0].ref,ref);assert.equal(compactToolGroups(changed).length,1);assert.throws(()=>recoverToolGroups(changed,p),/identity/);assert.throws(()=>restoreToolGroups(changed,p),/changed/);
 }
 assert.throws(()=>recoverToolGroups(damaged+p.groups[0].placeholder,p),/cannot be recovered/);
});
test('live and stopped summaries are preserved without changing lifecycle status or spinner',()=>{
 const g=group('live'),running=renderResponseToolGroup(g,{tool:g.tools[0],active:true}),p=presentToolGroups(running);
 assert.equal(p.groups.length,1);assert.match(p.display,/data-t3-live-tool="true"/);assert.match(p.display,/Running npm/);assert.match(p.display,/inline-spinner/);assert.equal(canonicalToolGroup(p,p.groups[0].ref),running);
 const stopped={...g,tools:g.tools.map(t=>({...t,status:'stopped',label:'Stopped npm'}))},s=presentToolGroups(renderResponseToolGroup(stopped));assert.match(s.display,/2 stopped or declined/);
});
class FakeElement {
 children:FakeElement[]=[];parent?:FakeElement;attrs:Record<string,string>={};events=new Map<string,Set<()=>unknown>>();open=false;isConnected=true;className='';textContent='';
 ownerDocument={createElement:()=>new FakeElement()};
 constructor(public tag='div'){}
 get childNodes(){return this.children;}
 append(...children:FakeElement[]){for(const child of children){child.parent=this;this.children.push(child);}}
 contains(el:FakeElement):boolean{return this===el||this.children.some(c=>c.contains(el));}
 getAttribute(name:string){return this.attrs[name]??null;}
 querySelectorAll(selector:string):FakeElement[]{const result:FakeElement[]=[];for(const child of this.children){if(selector==='details[data-t3-tool-ref]'&&child.tag==='details'&&child.attrs['data-t3-tool-ref'])result.push(child);result.push(...child.querySelectorAll(selector));}return result;}
 querySelector(selector:string):FakeElement|undefined{for(const child of this.children){if(selector==='.send-to-t3-tool-group-content'&&child.className==='send-to-t3-tool-group-content')return child;const found=child.querySelector(selector);if(found)return found;}}
 addEventListener(name:string,fn:()=>unknown){const listeners=this.events.get(name)??new Set();listeners.add(fn);this.events.set(name,listeners);}
 removeEventListener(name:string,fn:()=>unknown){this.events.get(name)?.delete(fn);}
 async toggle(open:boolean){this.open=open;await Promise.all([...(this.events.get('toggle')??[])].map(fn=>fn()));}
 replaceChildren(...children:FakeElement[]){this.children=[];this.append(...children);}
}
function dom(ref:string){const root=new FakeElement(),details=new FakeElement('details'),target=new FakeElement();details.attrs['data-t3-tool-ref']=ref;target.className='send-to-t3-tool-group-content';details.append(target);root.append(details);return {root,details,target};}
function renderMock(original:string,target:HTMLElement){const content=new FakeElement(),output=new FakeElement('pre');content.className='send-to-t3-tool-group-content';output.textContent=original;content.append(output);(target as unknown as FakeElement).append(content);}
test('expansion alone resolves and renders full output through the supplied safe renderer',async()=>{
 const original=html('lazy','<script>literal & private</script>'),p=presentToolGroups(original),h=dom(p.groups[0].ref);let reads=0,renders=0;
 const dispose=mountToolGroups(h.root as unknown as HTMLElement,ref=>{reads++;assert.equal(ref,p.groups[0].ref);return canonicalToolGroup(p,ref);},(body,target)=>{renders++;assert.equal(body,original);renderMock(body,target);});
 assert.equal(reads,0);assert.equal(renders,0);await h.details.toggle(true);assert.equal(reads,1);assert.equal(renders,1);assert.equal(h.target.children[0].textContent,original);await h.details.toggle(false);await h.details.toggle(true);assert.equal(reads,1);dispose();await h.details.toggle(true);assert.equal(renders,1);
});
test('closed, detached and disposed groups reject late lazy output and do not change the document',async()=>{
 for(const state of ['closed','detached','disposed']){
  const original=html(),p=presentToolGroups(original),h=dom(p.groups[0].ref);let resolve!:(body:string)=>void,renders=0;const dispose=mountToolGroups(h.root as unknown as HTMLElement,()=>new Promise<string>(r=>{resolve=r;}),(body,target)=>{renders++;renderMock(body,target);});
  const opening=h.details.toggle(true);if(state==='closed')await h.details.toggle(false);if(state==='detached')h.root.children=[];if(state==='disposed')dispose();resolve(original);await opening;assert.equal(renders,0);assert.equal(h.target.children.length,0);dispose();
 }
});
test('a connected group with a replaced reference rejects old output before resolve and during render',async()=>{
 for(const phase of ['resolve','render']){
  const original=html('original','retained original'),p=presentToolGroups(original),replacement=presentToolGroups(html('replacement')).groups[0].ref,h=dom(p.groups[0].ref);let proceed!:(value?:string)=>void,started!:()=>void,renders=0;
  const gate=new Promise<string|undefined>(resolve=>{proceed=resolve;}),renderStarted=new Promise<void>(resolve=>{started=resolve;});
  const dispose=mountToolGroups(h.root as unknown as HTMLElement,()=>phase==='resolve'?gate.then(()=>original):original,async(body,target)=>{renders++;renderMock(body,target);started();if(phase==='render')await gate;});
  const opening=h.details.toggle(true);if(phase==='render')await renderStarted;h.details.attrs['data-t3-tool-ref']=replacement;proceed();await opening;
  assert.equal(renders,phase==='render'?1:0);assert.equal(h.target.children.length,0);assert.equal(p.canonical,original);assert.equal(h.details.attrs['data-t3-tool-ref'],replacement);dispose();
 }
});
test('unknown and corrupt references fail closed before rendering',async()=>{
 const p=presentToolGroups(html()),h=dom(p.groups[0].ref),errors:unknown[]=[];let renders=0;const dispose=mountToolGroups(h.root as unknown as HTMLElement,()=>html('changed'),()=>{renders++;},error=>errors.push(error));await h.details.toggle(true);assert.equal(errors.length,1);assert.equal(renders,0);assert.equal(h.target.children.length,0);dispose();assert.equal(canonicalToolGroup(p,'unknown'),undefined);
});
