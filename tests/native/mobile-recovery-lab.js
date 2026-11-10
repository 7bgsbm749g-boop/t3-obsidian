// Evaluate only through the owned Android Obsidian WebView. This exercises the
// installed product's manager, native editor, vault IO and IndexedDB. Canonical
// T3 response input is synthetic; no provider dispatch or Sync proof is claimed.
(() => {
  const app = globalThis.app;
  if (!app || app.vault.getName() !== 'T3 Mobile Lab') throw Error('The isolated mobile lab vault is required.');
  const plugin = () => {
    const value = app.plugins.plugins['t-three-code'];
    if (!value?.deviceInline) throw Error('T3 Code did not finish loading.');
    return value;
  };
  const anchor = id => `:::send-to-t3-response data-t3-response="${id}"\n\n\n\n:::/send-to-t3-response`;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const key = 't3-owned-mobile-recovery-fixture';
  let state = JSON.parse(localStorage.getItem(key) || 'null');
  const snapshot = async () => {
    if (!state) return {present: false};
    const p = plugin();
    const file = app.vault.getFileByPath(state.path);
    const view = app.workspace.getLeavesOfType('markdown').map(leaf => leaf.view).find(view => view.file?.path === state.path);
    const manager = p.deviceInline.manager();
    const runtime = manager.jobs.get(state.request.id);
    return {
      present: true, mobile: app.isMobile, platform: navigator.userAgent,
      visibility: document.visibilityState, version: p.manifest.version,
      request: state.request, fileExists: !!file,
      disk: file ? await app.vault.read(file) : null,
      editor: view?.editor?.getValue(), canonicalView: view?.getViewData(),
      status: p.deviceInline.responseStatus(state.request.id),
      health: p.deviceInline.health(),
      runtime: runtime ? {done: runtime.done, stopped: runtime.stopped, saved: runtime.saved, restoring: runtime.restoring, retainedCharacters: runtime.update?.body?.length || 0} : null,
      bodyText: document.body.innerText.slice(-2500),
    };
  };
  const receive = update => {
    const p = plugin(), manager = p.deviceInline.manager();
    const runtime = manager.jobs.get(state.request.id);
    if (!runtime) throw Error('The exact fixture response is not loaded.');
    runtime.preview.receive(update);
  };
  globalThis.__t3MobileRecovery = {
    async prepare() {
      if (state && app.vault.getFileByPath(state.path)) throw Error('Clean up the previous fixture first.');
      const p = plugin(), id = crypto.randomUUID();
      state = {path: `Mobile recovery ${id}.md`, request: {
        version: 4, localOnly: true, nativeProjection: true, responseContainer: true,
        independent: true, id, initialOwner: crypto.randomUUID(), vaultId: p.settings.vaultId,
        host: {environmentId: 'synthetic-mobile-lab', workspaceRoot: '/synthetic', directory: '.obsidian/t3-code/inline/v1'},
        notePath: `Mobile recovery ${id}.md`, threadId: crypto.randomUUID(), projectId: crypto.randomUUID(),
        messageId: crypto.randomUUID(), threadEnvironmentId: 'synthetic-mobile-lab',
        initialHash: '0'.repeat(64), createdAt: new Date().toISOString(),
      }};
      localStorage.setItem(key, JSON.stringify(state));
      const file = await app.vault.create(state.path, '# Mobile recovery fixture\n\nOrdinary text remains.\n\n' + anchor(id) + '\n');
      await app.workspace.getLeaf(false).openFile(file);
      const manager = p.deviceInline.manager();
      manager.makePreview = (_record, _access, callback) => ({receive: callback, tick() {}, update() {}, delivery() {}, reconnect() {}, suspend() {}, dispose() {}});
      await p.deviceInline.register(state.request);
      await pause(100);
      receive({request: state.request, messageId: state.request.messageId, sequence: 1, turnId: 'synthetic-mobile-turn', phase: 'running', completionVerified: false, body: 'Synthetic mobile reply is streaming.'});
      await pause(100);
      return snapshot();
    },
    async final() {
      receive({request: state.request, messageId: state.request.messageId, sequence: 2, turnId: 'synthetic-mobile-turn', phase: 'complete', completionVerified: true, body: 'Synthetic mobile reply finished.\n\nOrdinary text must remain.'});
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        const value = await snapshot();
        if (value.status.finalSaved || value.runtime.done || !value.health.saveWorkers && value.status.pendingSaveReason !== 'saving') return value;
        await pause(40);
      }
      throw Error('Final native mobile save did not settle.');
    },
    async transientMissingPane() {
      const manager = plugin().deviceInline.manager(), original = manager.io.openedNotes;
      try {
        manager.io.openedNotes = () => [{path: state.path, document: ''}];
        manager.resume();
        await pause(150);
      } finally { manager.io.openedNotes = original; }
      manager.resume();
      await pause(150);
      return snapshot();
    },
    async reopen() {
      const file = app.vault.getFileByPath(state.path);
      if (!file) throw Error('The fixture note is missing.');
      await app.workspace.getLeaf(false).openFile(file);
      plugin().deviceInline.resume();
      await pause(150);
      return snapshot();
    },
    async closeDestination() {
      const reference = state.path.replace('.md', ' reference.md');
      if (!app.vault.getFileByPath(reference)) await app.vault.create(reference, '# Synthetic mobile reference\n');
      state.reference = reference; localStorage.setItem(key, JSON.stringify(state));
      await app.workspace.getLeaf(false).openFile(app.vault.getFileByPath(reference));
      plugin().deviceInline.resume();
      await pause(100);
      return snapshot();
    },
    snapshot,
    async cleanup() {
      if (!state) return {clean: true};
      const p = plugin(), id = state.request.id, file = app.vault.getFileByPath(state.path);
      p.deviceInline.stopLocally(id);
      if (file) await app.vault.delete(file);
      if (state.reference) { const reference = app.vault.getFileByPath(state.reference); if (reference) await app.vault.delete(reference); }
      const next = Object.fromEntries(Object.entries(p.responseBindingReplica).filter(([key]) => key !== id));
      p.responseBindingReplica = next; p.settings.responseBindings = next;
      await p.save(true);
      const result = {clean: !app.vault.getFileByPath(state.path), deletedNote: state.path, testThreads: []};
      localStorage.removeItem(key); state = null;
      return result;
    },
  };
  return {installed: true, fixture: 'mobile-recovery', mobile: app.isMobile, vault: app.vault.getName()};
})();
