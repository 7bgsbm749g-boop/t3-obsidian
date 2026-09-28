import assert from 'node:assert/strict';
import test from 'node:test';
import { installPaletteChat } from '../palette-chat';

function fixture() {
  const calls: { method: string; receiver: unknown; args: unknown[] }[] = [];
  const command = { item: { id: 'ordinary', name: 'Ordinary command' }, match: { score: 1 } };
  const prototype = {
    getSuggestions(...args: unknown[]) { calls.push({ method: 'get', receiver: this, args }); return args[0] === 'missing' ? [] : [command]; },
    renderSuggestion(...args: unknown[]) { calls.push({ method: 'render', receiver: this, args }); return 'rendered'; },
    selectSuggestion(this: any, ...args: unknown[]) { calls.push({ method: 'select', receiver: this, args }); this.closed++; return this.onChooseSuggestion(...args); },
    onChooseSuggestion(...args: unknown[]) { calls.push({ method: 'choose', receiver: this, args }); return 'chosen'; },
    onOpen(...args: unknown[]) { calls.push({ method: 'open', receiver: this, args }); return 'opened'; },
  };
  const modal = Object.assign(Object.create(prototype), { inputEl: Object.assign(new EventTarget(), { value: '' }), closed: 0 }) as typeof prototype & { inputEl: EventTarget & { value: string }; closed: number };
  const plugin = { enabled: true, instance: { modal } };
  const app = { internalPlugins: { getPluginById(id: string) { assert.equal(id, 'command-palette'); return plugin; } } };
  return { app, plugin, modal, prototype, calls, command };
}

test('query row survives unmatched text, preserves exact query, and does no work while typing', () => {
  const { app, modal } = fixture();
  const sent: string[] = [];
  const hook = installPaletteChat(app, query => { sent.push(query); });
  assert.equal(hook.status, 'active');
  assert.equal(suggest(modal, 'missing').length, 1);
  const query = '  Write <b>safe</b> text “yes” 🦉\n' + 'full text '.repeat(500);
  const row = suggest(modal, query)[0];
  assert.equal(row.item.name, `T3 Chat: “${query}”`);
  assert.deepEqual(sent, []);
  modal.selectSuggestion(row, { type: 'click' });
  assert.deepEqual(sent, [query]);
  assert.equal(modal.closed, 1);
  hook.dispose();
});

test('ordinary commands keep their identity, this, all arguments, and selection behavior', () => {
  const { app, modal, calls, command } = fixture();
  const hook = installPaletteChat(app, () => assert.fail('ordinary command must not submit'));
  const extra = { marker: true };
  assert.equal(suggest(modal, 'ord', extra)[1], command);
  assert.deepEqual(calls[0], { method: 'get', receiver: modal, args: ['ord', extra] });
  assert.equal(modal.renderSuggestion(command, extra, 'third'), 'rendered');
  assert.equal(modal.selectSuggestion(command, extra, 'third'), 'chosen');
  assert.deepEqual(calls.at(-1), { method: 'choose', receiver: modal, args: [command, extra, 'third'] });
  hook.dispose();
});

test('empty input has no chat row and duplicate activation submits only once per opening', () => {
  const { app, modal, command } = fixture();
  const sent: string[] = [];
  const hook = installPaletteChat(app, query => { sent.push(query); });
  assert.deepEqual(suggest(modal, ' \n\t'), [command]);
  modal.onOpen();
  const first = suggest(modal, 'first')[0];
  const alsoFirst = suggest(modal, 'first')[0];
  modal.selectSuggestion(first, {});
  modal.selectSuggestion(first, {});
  modal.selectSuggestion(alsoFirst, {});
  assert.deepEqual(sent, ['first']);
  assert.equal(modal.closed, 1);
  modal.onOpen();
  modal.selectSuggestion(first, {}); // stale row from the previous opening
  const second = suggest(modal, 'second')[0];
  modal.selectSuggestion(second, {});
  assert.deepEqual(sent, ['first', 'second']);
  hook.dispose();
});

test('IME composition neither closes the palette nor sends the partial query', () => {
  const { app, modal } = fixture();
  const sent: string[] = [];
  const hook = installPaletteChat(app, query => { sent.push(query); });
  const row = suggest(modal, '日本語')[0];
  modal.selectSuggestion(row, { isComposing: true });
  modal.inputEl.dispatchEvent(new Event('compositionstart'));
  modal.selectSuggestion(row, {});
  assert.equal(modal.closed, 0);
  assert.deepEqual(sent, []);
  modal.inputEl.dispatchEvent(new Event('compositionend'));
  modal.selectSuggestion(row, {});
  assert.deepEqual(sent, ['日本語']);
  hook.dispose();
});

test('rendering uses literal text, while other rows use their original renderer', () => {
  const { app, modal } = fixture();
  const hook = installPaletteChat(app, () => {});
  const makeElement = (): any => ({
    classList: { add() {} }, children: [], ownerDocument: { createElement: () => makeElement() },
    appendChild(child: unknown) { this.children.push(child); },
  });
  const element = makeElement();
  modal.renderSuggestion(suggest(modal, '<img onerror="bad">')[0], element);
  assert.equal(element.children[0].children[0].textContent, 'T3 Chat: “<img onerror="bad">”');
  hook.dispose();
});

test('dispose restores inherited methods and reconciliation handles replacement/disabled palette', () => {
  const { app, plugin, modal, prototype } = fixture();
  const hook = installPaletteChat(app, () => {});
  assert.notEqual(modal.getSuggestions, prototype.getSuggestions);
  const replacement = fixture().modal;
  plugin.instance.modal = replacement;
  hook.reconcile();
  assert.equal(modal.getSuggestions, prototype.getSuggestions);
  assert.equal(Object.hasOwn(modal, 'getSuggestions'), false);
  assert.equal(suggest(replacement, 'missing').length, 1);
  plugin.enabled = false;
  assert.equal(hook.reconcile(), 'unavailable');
  assert.equal(suggest(replacement, 'missing').length, 0);
  plugin.enabled = true;
  assert.equal(hook.reconcile(), 'active');
  hook.dispose();
  assert.equal(hook.reconcile(), 'disposed');
  assert.equal(suggest(replacement, 'missing').length, 0);
});

test('incompatible or frozen internals are harmless and async contract changes stay untouched', () => {
  assert.equal(installPaletteChat({}, () => {}).status, 'unavailable');
  const { app, modal } = fixture();
  Object.freeze(modal);
  assert.equal(installPaletteChat(app, () => {}).status, 'incompatible');
  const other = fixture();
  const promise = Promise.resolve([]);
  (other.modal as any).getSuggestions = () => promise;
  const hook = installPaletteChat(other.app, () => {});
  assert.equal(suggest(other.modal, 'query'), promise);
  assert.equal(hook.status, 'incompatible');
  hook.dispose();
});

test('later wrappers survive disposal and async submit failures are reported once', async () => {
  const { app, modal } = fixture();
  const errors: unknown[] = [];
  const failure = new Error('network unavailable');
  const hook = installPaletteChat(app, async () => { throw failure; }, { onError: error => errors.push(error) });
  const wrapped = modal.getSuggestions;
  const laterWrapper = function(this: typeof modal, ...args: unknown[]) { return wrapped.apply(this, args); };
  modal.getSuggestions = laterWrapper;
  const row = suggest(modal, 'hello')[0];
  modal.selectSuggestion(row, {});
  modal.selectSuggestion(row, {});
  await Promise.resolve();
  assert.deepEqual(errors, [failure]);
  hook.dispose();
  assert.equal(modal.getSuggestions, laterWrapper);
  assert.equal(suggest(modal, 'missing').length, 0);
});

function suggest(modal: ReturnType<typeof fixture>['modal'], query: string, ...args: unknown[]) {
  modal.inputEl.value = query;
  return modal.getSuggestions(query, ...args);
}

test('raw input is preserved if native suggestion arguments are normalized', () => {
  const { app, modal } = fixture();
  const sent: string[] = [];
  const hook = installPaletteChat(app, query => { sent.push(query); });
  modal.inputEl.value = '  keep leading and trailing spaces  ';
  const row = modal.getSuggestions(modal.inputEl.value.trim())[0];
  assert.equal(row.item.name, 'T3 Chat: “  keep leading and trailing spaces  ”');
  modal.selectSuggestion(row, {});
  assert.deepEqual(sent, ['  keep leading and trailing spaces  ']);
  hook.dispose();
});

test('one draft is rewritten on each input and restored on the next palette opening', () => {
  const {app,modal}=fixture();
  let draft='';
  const hook=installPaletteChat(app,()=>{}, {getDraft:()=>draft,saveDraft:value=>{draft=value;}});
  modal.onOpen();
  for(const value of ['H','He','Hel','Help']){
    modal.inputEl.value=value;
    modal.inputEl.dispatchEvent(new Event('input'));
    assert.equal(draft,value);
  }
  modal.inputEl.value='';
  modal.onOpen();
  assert.equal(modal.inputEl.value,'Help');
  modal.inputEl.value='';
  modal.inputEl.dispatchEvent(new Event('input'));
  assert.equal(draft,'');
  hook.dispose();
  modal.inputEl.value='after disposal';
  modal.inputEl.dispatchEvent(new Event('input'));
  assert.equal(draft,'');
});

test('an edit between suggestion generation and selection cannot send a stale prompt', () => {
  const { app, modal } = fixture();
  const sent: string[] = [];
  const hook = installPaletteChat(app, query => { sent.push(query); });
  const row = suggest(modal, 'old text')[0];
  modal.inputEl.value = 'new text'; // Input changed before the suggestions refreshed.
  modal.selectSuggestion(row, {});
  modal.onChooseSuggestion(row, {});
  assert.deepEqual(sent, []);
  assert.equal(modal.closed, 0);
  const currentRow = modal.getSuggestions(modal.inputEl.value)[0];
  modal.selectSuggestion(currentRow, {});
  assert.deepEqual(sent, ['new text']);
  assert.equal(modal.closed, 1);
  hook.dispose();
});
