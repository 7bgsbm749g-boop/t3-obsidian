import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {installDomFactories} from './dom-factories';
import {UpdateBanner} from '../src/app/update-banner';
import type {UpdateState} from '../src/app/plugin-updates';
test('banner is accessible, top mounted, actionable and removed on dismiss/dispose',()=>{
 const {document}=parseHTML('<html><body><main><article>Existing note</article></main></body></html>');installDomFactories(document);const root=document.querySelector('main')!;let updates=0,dismissals=0;
 const banner=new UpdateBanner(root,()=>{updates++;},()=>{dismissals++;});const state:UpdateState={release:{version:'0.0.451',tag:'0.0.451',assets:{} as any},busy:false,message:'T3 Code 0.0.451 is available.'};
 banner.render(state);assert.equal(root.firstElementChild!.getAttribute('aria-label'),'T3 Code update');assert.equal(root.querySelector('[role="status"]')!.textContent,state.message);
 const buttons=()=>Array.from(root.querySelectorAll('button'));buttons()[0].click();buttons()[1].click();assert.equal(updates,1);assert.equal(dismissals,1);
 banner.render({...state,busy:true,message:'Updating…'});assert.equal(root.querySelectorAll('.t3-update-banner').length,1);assert.ok(buttons().every(button=>button.disabled));
 banner.render({...state,message:'<script>unsafe</script>'});assert.equal(root.querySelector('script'),null);banner.dispose();assert.equal(root.textContent,'Existing note');
});
