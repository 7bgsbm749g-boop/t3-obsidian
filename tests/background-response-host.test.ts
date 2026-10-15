import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ensurePrivateStorage} from '../private-storage-desktop';
import {localInlineFiles} from '../response-storage-desktop';
import {responseAnchor} from '../native-response-projection';
import type {ResponseRequest} from '../response-model';
import {editorStream} from '../editor-stream';
import {commandId} from '../direct';
import {removeFailedResponse} from '../failed-response-cleanup';
import {initialRegion} from '../inline-thread';

test('confirmed failure cleanup removes duplicate tags and initial live controls while retaining prose',()=>{
 const id=randomUUID(),other=randomUUID(),initial=initialRegion(id).text;
 const saved=removeFailedResponse('Ordinary start\n'+initial+'User text between copies\n'+initial+'\n'+responseAnchor(other)+'Ordinary tail',id);
 assert.doesNotMatch(saved,new RegExp(id));assert.doesNotMatch(saved,/Working|spinner/);assert.match(saved,/User text between copies/);assert.ok(saved.includes(other));assert.match(saved,/Ordinary tail/);
 const single=removeFailedResponse(initial,id);assert.doesNotMatch(single,/Working|spinner|t3-inline:/);
});
