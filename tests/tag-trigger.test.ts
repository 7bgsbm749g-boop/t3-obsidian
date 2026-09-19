import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {FolderLink} from '../folder-link';
import {normalizeTriggerTag, TagTriggerService, type TagReceipt, type TagTriggerHost} from '../tag-trigger';

const wait = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean) {
  for (let n = 0; n < 100 && !check(); n++) await wait(5);
  assert.ok(check(), 'event did not finish');
}
function folder(overrides: Partial<FolderLink> = {}): FolderLink {
  return {id: 'link', folderPath: 'Tasks', projectId: 'project', connectionId: 'local', projectTitle: 'Project', workspaceRoot: '/project', self: false,
    tagTrigger: {enabled: true, tag: '#ready', deviceId: 'device'}, ...overrides};
}
function fixture(links = [folder()]) {
  const notes = new Map([['Tasks/note.md', {path: 'Tasks/note.md', ctime: 1, tags: ['#ready'] as string[]}]]);
  const receipts: TagReceipt[] = [], sends: Array<{path: string; link: FolderLink; requestId: string}> = [], reports: string[] = [];
  let busy = false, stopped = false, saved = 0;
  const host: TagTriggerHost = {
    deviceId: 'device', getLinks: () => links, getReceipts: () => receipts,
    save: async () => { saved++; }, getNote: async path => notes.get(path),
    send: async (path, link, requestId) => { assert.ok(saved > 0, 'send intent must be durable first'); sends.push({path, link, requestId}); },
    isBusy: () => busy, isStopped: () => stopped, report: text => { reports.push(text); },
  };
  return {host, notes, receipts, sends, reports, links, service: new TagTriggerService(host, 5), saved: () => saved,
    setBusy: (value: boolean) => { busy = value; }, setStopped: () => { stopped = true; }};
}

test('tag configuration is canonical and rejects empty, multi-tag and invalid values', () => {
  assert.equal(normalizeTriggerTag(' Ready '), '#ready');
  assert.equal(normalizeTriggerTag('#Tasks/Ready'), '#tasks/ready');
  assert.equal(normalizeTriggerTag('équipe'), '#équipe');
  for (const value of ['', '#', '#123', '#one #two', '#a.b', '##ready', '/ready', 'ready/']) assert.throws(() => normalizeTriggerTag(value));
});

test('default off, disabled, another device, folder boundaries and missing parsed tags never send', async () => {
  for (const link of [folder({tagTrigger: undefined}), folder({tagTrigger: {enabled: false, tag: '#ready', deviceId: 'device'}}),
    folder({tagTrigger: {enabled: true, tag: '#ready', deviceId: 'other'}}), folder({folderPath: 'Task'})]) {
    const f = fixture([link]); f.service.schedule('Tasks/note.md'); await wait(); f.service.stop(); assert.equal(f.sends.length, 0);
  }
  const f = fixture(); f.notes.get('Tasks/note.md')!.tags = []; // A literal #ready in a code block is absent from Obsidian's parsed tags.
  f.service.schedule('Tasks/note.md'); await wait(); f.service.stop(); assert.equal(f.sends.length, 0);
});

test('a disabled nested folder link shields its notes from a parent trigger', async () => {
  const f = fixture([folder(), folder({id: 'nested', folderPath: 'Tasks/Inner', tagTrigger: undefined})]);
  f.notes.set('Tasks/Inner/note.md', {path: 'Tasks/Inner/note.md', ctime: 2, tags: ['#ready']});
  f.service.schedule('Tasks/Inner/note.md'); await wait(); f.service.stop(); assert.equal(f.sends.length, 0);
});

test('metadata bursts coalesce and exact case-insensitive parsed tags dispatch once', async () => {
  const f = fixture(); f.notes.get('Tasks/note.md')!.tags = ['#READY'];
  for (let n = 0; n < 5; n++) f.service.schedule('Tasks/note.md');
  await until(() => f.receipts[0]?.state === 'sent');
  assert.equal(f.sends.length, 1); assert.equal(f.sends[0].requestId, f.receipts[0].requestId);
  f.notes.get('Tasks/note.md')!.tags = []; f.service.schedule('Tasks/note.md'); await wait();
  f.notes.get('Tasks/note.md')!.tags = ['#ready']; f.service.schedule('Tasks/note.md'); await wait();
  f.service.stop();
  const restarted = new TagTriggerService(f.host, 5); restarted.schedule('Tasks/note.md'); await wait(); restarted.stop();
  assert.equal(f.sends.length, 1);
});

test('replacing a note at the same path with a new creation time permits a new send', async () => {
  const f = fixture(); f.service.schedule('Tasks/note.md'); await until(() => f.sends.length === 1);
  f.notes.get('Tasks/note.md')!.ctime = 2; f.service.schedule('Tasks/note.md'); await until(() => f.sends.length === 2);
  f.service.stop(); assert.equal(f.receipts.length, 2);
});

test('renaming a sent note within its linked folder preserves duplicate protection', async () => {
  const f = fixture(); f.service.schedule('Tasks/note.md'); await until(() => f.receipts[0]?.state === 'sent');
  const note = f.notes.get('Tasks/note.md')!; f.notes.delete(note.path);
  f.notes.set('Tasks/renamed.md', {...note, path: 'Tasks/renamed.md'});
  await f.service.rename(note.path, 'Tasks/renamed.md'); await wait(); f.service.stop();
  assert.equal(f.sends.length, 1); assert.equal(f.receipts[0].path, 'Tasks/renamed.md');
});

test('failure remains recorded and later note events or restart never retry automatically', async () => {
  const f = fixture(); let attempts = 0;
  f.host.send = async () => { attempts++; throw Error('Connection unavailable'); };
  f.service.schedule('Tasks/note.md'); await until(() => f.receipts[0]?.state === 'failed');
  f.service.schedule('Tasks/note.md'); await wait(); f.service.stop();
  const restarted = new TagTriggerService(f.host, 5); restarted.schedule('Tasks/note.md'); await wait(); restarted.stop();
  assert.equal(attempts, 1); assert.match(f.reports[0], /Connection unavailable/);
});

test('an uncertain sending receipt blocks duplicate dispatch after restart', async () => {
  const f = fixture(); f.receipts.push({id: 'previous', requestId: 'previous', path: 'Tasks/note.md', ctime: 1, linkId: 'link', state: 'sending'});
  f.service.schedule('Tasks/note.md'); await wait(); f.service.stop(); assert.equal(f.sends.length, 0);
});

test('saving the intent must succeed before delivery', async () => {
  const f = fixture(); f.host.save = async () => { throw Error('Disk full'); };
  f.service.schedule('Tasks/note.md'); await until(() => f.receipts[0]?.state === 'failed');
  f.service.schedule('Tasks/note.md'); await wait(); f.service.stop();
  assert.equal(f.sends.length, 0); assert.match(f.reports[0], /no thread was started/);
});

test('disable, unlink, delete or stop during debounce cancels delivery', async () => {
  for (const change of ['disable', 'unlink', 'delete', 'stop']) {
    const f = fixture(); f.service.schedule('Tasks/note.md');
    if (change === 'disable') f.links[0].tagTrigger!.enabled = false;
    if (change === 'unlink') f.links.splice(0);
    if (change === 'delete') f.notes.clear();
    if (change === 'stop') f.service.stop();
    await wait(); f.service.stop(); assert.equal(f.sends.length, 0);
  }
});

test('a setting changed while persisting intent is rechecked before sending', async () => {
  const f = fixture(); let release!: () => void;
  f.host.save = () => new Promise<void>(resolve => { release = resolve; });
  f.service.schedule('Tasks/note.md'); await until(() => Boolean(release));
  f.links[0].tagTrigger!.enabled = false; f.host.save = async () => {}; release();
  await until(() => f.receipts[0]?.state === 'failed'); f.service.stop(); assert.equal(f.sends.length, 0);
});

test('brief busy periods debounce in memory and shutdown drops the pending event', async () => {
  const f = fixture(); f.setBusy(true); f.service.schedule('Tasks/note.md'); await wait();
  assert.equal(f.receipts.length, 0); f.setBusy(false); await until(() => f.sends.length === 1); f.service.stop();
  const g = fixture(); g.setBusy(true); g.service.schedule('Tasks/note.md'); await wait();
  g.setStopped(); g.setBusy(false); await wait(); g.service.stop(); assert.equal(g.sends.length, 0);
});
