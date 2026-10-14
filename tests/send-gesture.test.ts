import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SendGesture} from '../send-gesture';

function windowFixture(){
  const listeners=new Map<string,Function>();
  const win={addEventListener:(name:string,handler:Function)=>listeners.set(name,handler),removeEventListener:(name:string)=>listeners.delete(name)} as unknown as Window;
  const emit=(name:string,event:Partial<KeyboardEvent>={})=>listeners.get(name)?.({ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,key:'',...event});
  return {win,emit,listeners};
}

test('command Control state is local to its window and clears on release, blur and unload',()=>{
  const a=windowFixture(),b=windowFixture(),gesture=new SendGesture(),dispose=gesture.watch(a.win);gesture.watch(b.win);
  a.emit('keydown',{key:'Control',ctrlKey:true});assert.equal(gesture.selector(a.win),true);assert.equal(gesture.selector(b.win),false);
  a.emit('keyup',{key:'Control'});assert.equal(gesture.selector(a.win),false);
  a.emit('pointerdown',{ctrlKey:true});assert.equal(gesture.selector(a.win),true);
  a.emit('blur');assert.equal(gesture.selector(a.win),false);
  a.emit('keydown',{key:'Enter',ctrlKey:true});dispose();assert.equal(gesture.selector(a.win),false);assert.equal(a.listeners.size,0);
});

test('Control required by a configured shortcut keeps normal sending, but Control+Enter opens the picker',()=>{
  const a=windowFixture(),gesture=new SendGesture();gesture.watch(a.win);
  a.emit('keydown',{key:'s',ctrlKey:true});assert.equal(gesture.selector(a.win,[{key:'S',modifiers:['Mod']}]),false);
  a.emit('keydown',{key:'Enter',ctrlKey:true});assert.equal(gesture.selector(a.win,[{key:'S',modifiers:['Mod']}]),true);
  a.emit('keydown',{key:'s',ctrlKey:true,metaKey:true});assert.equal(gesture.selector(a.win,[{key:'S',modifiers:['Mod']}],true),true);
});
