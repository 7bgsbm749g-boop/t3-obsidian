import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from './build-fixture';
import {nativeInboxFixture as fixture} from './native-inbox-fixture';
test('native inbox lab uses the installed product and native vault APIs',async()=>{
 const result=await build({entryPoints:['tests/native/note-inbox-lab.ts'],bundle:true,platform:'browser',format:'cjs',write:false,external:['node:*'],define:{INBOX_LAB_REPORT:'"synthetic-report.json"',INBOX_LAB_VAULT:'"Synthetic test vault"'}});
 assert.match(result.outputFiles[0].text,/noteInboxView/);assert.match(result.outputFiles[0].text,/Finish inbox validation/);
});
test('the filter reuses native note rows and handlers and restores their native folder tree on exit',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());const row=f.rows.get('Docs/Regular.md'),icon=row.title.querySelector('.native-plugin-icon'),before=row.row.outerHTML;
 f.toggle();assert.equal(f.state().enabled,true);assert.deepEqual(f.visibleFiles(),['Docs/Pinned.md','Docs/Regular.md']);
 assert.equal(f.view.fileItems['Docs/Regular.md'].el,row.row);assert.equal(row.row.outerHTML,before,'every note is a plain, unchanged native row');assert.equal(row.title.querySelector('.native-plugin-icon'),icon);
 row.title.click();row.title.dispatchEvent(new f.window.Event('dragstart',{bubbles:true}));assert.deepEqual(f.opened,['Docs/Regular.md']);assert.deepEqual(f.dragged,['Docs/Regular.md']);
 assert.equal(f.document.querySelector('.t3-note-inbox-open,.t3-note-inbox-actions,.t3-note-inbox-detail,input'),null);
 assert.equal(row.item.file.parent.path,'Docs','the vault location is unchanged');assert.equal(row.item.parent,f.nativeRoot,'native navigation uses the filtered root');
 f.toggle();assert.equal(row.row.parentElement,f.folder.childrenEl);assert.equal(row.item.parent,f.folder);assert.equal(f.folder.collapsed,true);assert.equal(row.row.outerHTML,before);
 f.toggle();f.controller.dispose();assert.equal(f.document.querySelector('.t3-note-inbox-heading'),null);assert.equal(row.item.parent,f.folder);
});
test('T3 shelf geometry uses trailing chevrons with no regular or pinned state labels',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.toggle();
 const headers=Array.from(f.document.querySelectorAll<HTMLElement>('.t3-note-inbox-heading'));assert.deepEqual(headers.map(el=>el.dataset.t3InboxShelf),['working','snoozed','settled']);
 for(const header of headers){assert.equal(header.getAttribute('aria-expanded'),'false');assert.equal(header.lastElementChild!.className,'t3-note-inbox-chevron');assert.equal(header.children[header.children.length-2].className,'t3-note-inbox-count');}
 assert.equal(headers.some(el=>/Pinned|Inbox|Completed|Regular/.test(el.textContent!)),false);
 headers[0].click();assert.deepEqual(f.visibleFiles(),['Docs/Pinned.md','Docs/Regular.md','Docs/Working.md']);headers[1].click();headers[2].click();
 assert.deepEqual(f.visibleFiles(),['Docs/Pinned.md','Docs/Regular.md','Docs/Working.md','Docs/Snoozed.md','Docs/Settled.md']);
 assert.equal(f.rows.get('Docs/Regular.md').title.textContent,'native iconRegular');
});
test('each shelf retains its expanded and collapsed preference when the view is recreated',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.toggle();f.document.querySelector<HTMLButtonElement>('[data-t3-inbox-shelf="working"]')!.click();
 const saved=JSON.parse(JSON.stringify(f.state()));f.controller.dispose();const restored=await fixture(saved);t.after(()=>restored.controller.dispose());
 assert.equal(restored.document.querySelector('[data-t3-inbox-shelf="working"]')!.getAttribute('aria-expanded'),'true');
 assert.equal(restored.document.querySelector('[data-t3-inbox-shelf="snoozed"]')!.getAttribute('aria-expanded'),'false');
 assert.deepEqual(Array.from(restored.ui.loadInboxViewState({collapsed:['regular','pinned','settled']}).collapsed),['settled']);
});
test('native menus retain ordinary note actions and append inbox choices only in this mode',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());assert.equal(f.menu('Docs/Regular.md').length,2);f.toggle();
 const items=f.menu('Docs/Regular.md');assert.deepEqual(items.slice(0,2).map(item=>item.title),['Rename','Delete']);items.find(item=>item.title==='Settle note').click();await Promise.resolve();assert.equal(f.changes[0].note.path,'Docs/Regular.md');assert.equal(f.changes[0].action.kind,'settled');
 assert.equal(f.menu('Docs/Unbound.md').length,2);assert.equal(f.menu('Docs/Regular.md','tab-header').length,2);
 f.controller.dispose();assert.equal(f.disconnected(),1);
});
test('collapsed shelf members and unbound notes are absent from native range selection and focus',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.view.tree.selectedDoms.add(f.rows.get('Docs/Unbound.md').item);f.view.tree.focusedItem=f.rows.get('Docs/Unbound.md').item;
 f.toggle();assert.equal(f.view.tree.selectedDoms.size,0);assert.equal(f.view.tree.focusedItem,null);
 for(const header of Array.from(f.document.querySelectorAll<HTMLButtonElement>('.t3-note-inbox-heading')))header.click();
 assert.deepEqual(f.selectRange('Docs/Regular.md','Docs/Settled.md'),['Docs/Regular.md','Docs/Working.md','Docs/Snoozed.md','Docs/Settled.md']);
 f.document.querySelector<HTMLButtonElement>('[data-t3-inbox-shelf="settled"]')!.click();assert.equal(f.view.tree.selectedDoms.size,0);assert.equal(f.visibleFiles().includes('Docs/Settled.md'),false);
});
test('renames and native sorts retain the filter; repeated refreshes do not reset native rename or selection',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.toggle();const regular=f.rows.get('Docs/Regular.md').item,sorts=f.sorts();f.view.tree.selectedDoms.add(regular);f.view.fileBeingRenamed=regular.file;
 f.controller.refresh();assert.equal(f.sorts(),sorts);assert.ok(f.view.tree.selectedDoms.has(regular));assert.equal(f.view.fileBeingRenamed,regular.file);
 delete f.view.fileItems['Docs/Regular.md'];regular.file.path='Docs/Renamed.md';f.view.fileItems[regular.file.path]=regular;
 f.setNotes([{path:'Docs/Renamed.md',section:'regular'}]);f.controller.refresh();f.view.sort();await Promise.resolve();
 assert.deepEqual(f.visibleFiles(),['Docs/Renamed.md']);assert.equal(regular.parent,f.nativeRoot);assert.equal(f.view.fileItems[regular.file.path],regular);
 f.setLeaves([]);f.controller.refresh();assert.equal(regular.parent,f.folder);assert.equal(f.document.querySelector('.t3-note-inbox-toggle'),null);
});
test('empty and unsupported native trees cannot expose hidden notes as a filtered selection',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());f.setNotes([]);f.toggle();assert.deepEqual(f.projected(),[]);assert.equal(f.rows.size,6);assert.equal(f.view.tree.selectedDoms.size,0);
 assert.equal(f.native.nativeExplorerTree({fileItems:{}}),undefined);
});

test('the mode preserves normal folder folds and restores the exact native methods',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());
 const keys=['getSortedFolderItems','getNodeId','isItem'],before=keys.map(key=>Object.getOwnPropertyDescriptor(f.view,key)),save=f.view.tree.saveFolds,request=f.view.tree.requestSaveFolds;
 f.toggle();assert.deepEqual(f.folds(),{saves:1,requests:0,cancels:1});
 f.view.tree.saveFolds();f.view.tree.requestSaveFolds();f.view.tree.requestSaveFolds.run();assert.deepEqual(f.folds(),{saves:1,requests:0,cancels:1});
 f.toggle();assert.deepEqual(keys.map(key=>Object.getOwnPropertyDescriptor(f.view,key)),before);assert.equal(f.view.tree.saveFolds,save);assert.equal(f.view.tree.requestSaveFolds,request);
 f.view.tree.requestSaveFolds();assert.equal(f.folds().requests,1);
});
test('a failed native projection returns to the normal explorer with no stale selection',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());const sort=f.view.sort;let failed=false;
 f.view.sort=function(){if(!failed){failed=true;throw Error('Synthetic native failure');}sort.call(this);};
 f.view.tree.selectedDoms.add(f.rows.get('Docs/Unbound.md').item);f.toggle();
 assert.equal(f.state().enabled,false);assert.equal(f.view.tree.selectedDoms.size,0);assert.equal(f.rows.get('Docs/Regular.md').item.parent,f.folder);
 assert.equal(f.notices.length,1);assert.match(f.notices[0],/Synthetic native failure/);assert.equal(f.root.classList.contains('t3-note-inbox-mode'),false);
});

test('the inbox control is beside Codebase in the top mode row and Files restores the ordinary tree',async(t)=>{
 const f=await fixture();t.after(()=>f.controller.dispose());const button=f.document.querySelector<HTMLButtonElement>('.t3-note-inbox-toggle')!;
 assert.equal(button.parentElement,f.tabs);assert.equal(button.previousElementSibling,f.codebaseTab);assert.equal(f.root.querySelector('.t3-note-inbox-toggle'),null);
 f.toggle();assert.equal(f.state().enabled,true);f.fileTab.click();assert.equal(f.state().enabled,false);assert.equal(f.rows.get('Docs/Regular.md').item.parent,f.folder);
 f.toggle();f.codebaseTab.click();f.controller.refresh();assert.equal(button.getAttribute('aria-pressed'),'false');
 f.toggle();await Promise.resolve();assert.equal(f.state().enabled,true,'selecting Inbox from another mode keeps the filter enabled');assert.equal(button.getAttribute('aria-pressed'),'true');assert.ok(f.revealed()>0);
});
