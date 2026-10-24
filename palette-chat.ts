/**
 * The core command palette has no public extension point. Keep its instance-only
 * integration here; a normal plugin command remains available if it changes.
 */
export type PaletteChatStatus = 'active' | 'unavailable' | 'incompatible' | 'disposed';

export interface PaletteChatOptions<Context = unknown> {
  onStatus?: (status: PaletteChatStatus) => void;
  onError?: (error: unknown) => void;
  getDraft?: () => string;
  saveDraft?: (draft: string) => void;
  getSelection?: () => string;
  /** Capture the source before the core modal takes focus or clears selection. */
  captureSource?: () => {selection:string;context:Context} | undefined;
}

export interface PaletteChatController {
  readonly status: PaletteChatStatus;
  /** Reattach after the core plugin is enabled again or replaces its modal. */
  reconcile(): PaletteChatStatus;
  dispose(): void;
}

type Method = (this: PaletteModal, ...args: any[]) => any;
const methodNames = ['getSuggestions', 'renderSuggestion', 'selectSuggestion', 'onChooseSuggestion', 'onOpen'] as const;
type MethodName = typeof methodNames[number];
type PaletteModal = Record<MethodName, Method> & {
  inputEl: Pick<HTMLInputElement, 'value' | 'addEventListener' | 'removeEventListener' | 'dispatchEvent'>;
};
type ChatRow = {
  item: { id: string; name: string };
  match: { score: number; matches: number[][] };
};

function findModal(app: unknown): unknown {
  const plugins = (app as { internalPlugins?: { getPluginById?: (id: string) => unknown } } | null)?.internalPlugins;
  if (typeof plugins?.getPluginById !== 'function') return undefined;
  const plugin = plugins.getPluginById('command-palette') as { enabled?: boolean; instance?: { modal?: unknown } } | null;
  return plugin?.enabled === false ? undefined : plugin?.instance?.modal;
}

function compatible(value: unknown): value is PaletteModal {
  if (!value || typeof value !== 'object') return false;
  const modal = value as PaletteModal;
  return methodNames.every(name => typeof modal[name] === 'function') &&
    typeof modal.inputEl?.value === 'string' &&
    typeof modal.inputEl?.addEventListener === 'function' &&
    typeof modal.inputEl?.removeEventListener === 'function' &&
    typeof modal.inputEl?.dispatchEvent === 'function';
}

export function installPaletteChat<Context = unknown>(
  app: unknown,
  onSubmit: (query: string, selectedText: string, showSelector:boolean, context:Context|undefined) => void | Promise<void>,
  options: PaletteChatOptions<Context> = {},
): PaletteChatController {
  let status: PaletteChatStatus = 'unavailable';
  let disposed = false;
  let attached: { modal: PaletteModal; restore: () => void } | undefined;
  const setStatus = (next: PaletteChatStatus) => {
    if (status !== next) { status = next; options.onStatus?.(next); }
    return status;
  };

  function attach(modal: PaletteModal): () => void {
    let active = true;
    let composing = false;
    let epoch = 0;
    let submitted = false;
    let source:ReturnType<NonNullable<PaletteChatOptions<Context>['captureSource']>>;
    let sourceError:unknown;
    const rows = new WeakMap<object, { query: string; selection: string; epoch: number; context:Context|undefined; error:unknown }>();
    const originals = Object.fromEntries(methodNames.map(name => [name, modal[name]])) as Record<MethodName, Method>;
    const descriptors = new Map<MethodName, PropertyDescriptor | undefined>();
    const wrappers: Record<MethodName, Method> = {
      getSuggestions(...args) {
        // Read the field itself, so whitespace and any future core normalization
        // cannot change the user's prompt. Keep this snapshot on the row.
        const query = modal.inputEl.value;
        const suggestions: unknown = originals.getSuggestions.apply(this, args);
        if (!active || this !== modal) return suggestions;
        // Current core versions return an array. Leave a changed contract alone.
        if (!Array.isArray(suggestions)) { setStatus('incompatible'); return suggestions; }
        if (typeof args[0] !== 'string') return suggestions;
        const selection=options.captureSource?source?.selection??'':options.getSelection?.()??'';
        const name=query.trim()
          ? `${selection.trim()?'Ask T3 Code':'T3 Code'}: “${query}”`
          : selection.trim()?'Ask T3 Code':'Send to T3 Code';
        const row: ChatRow = {
          item: { id: 'send-to-t3-code:palette-query', name },
          match: { score: 0, matches: [] },
        };
        rows.set(row, { query, selection, epoch, context:source?.context, error:sourceError });
        // Insert after core filtering/sorting, before its display limit is applied.
        // The registered command is the hotkey/fallback surface. While this
        // dynamic row is available, show only one manual T3 action.
        return [row, ...suggestions.filter(suggestion=>suggestion?.item?.id!=='send-to-t3-code:send-or-ask')];
      },
      renderSuggestion(...args) {
        const row = args[0];
        if (!row || typeof row !== 'object' || !rows.has(row)) return originals.renderSuggestion.apply(this, args);
        const element = args[1] as HTMLElement;
        element.classList.add('mod-complex', 'send-to-t3-palette-suggestion');
        const content = element.ownerDocument.createElement('div');
        content.className = 'suggestion-content';
        const title = element.ownerDocument.createElement('div');
        title.className = 'suggestion-title';
        title.textContent = (row as ChatRow).item.name;
        content.appendChild(title);
        element.appendChild(content);
      },
      selectSuggestion(...args) {
        const row = args[0];
        const own = row && typeof row === 'object' ? rows.get(row) : undefined;
        if (own && (!active || own.epoch !== epoch || own.query !== modal.inputEl.value || submitted || composing || args[1]?.isComposing)) return;
        return originals.selectSuggestion.apply(this, args);
      },
      onChooseSuggestion(...args) {
        const row = args[0];
        const own = row && typeof row === 'object' ? rows.get(row) : undefined;
        if (!own) return originals.onChooseSuggestion.apply(this, args);
        if (!active || own.epoch !== epoch || own.query !== modal.inputEl.value || submitted || composing || args[1]?.isComposing) return;
        submitted = true;
        try { if(own.error)throw own.error;Promise.resolve(onSubmit(own.query,own.selection,Boolean(args[1]?.ctrlKey),own.context)).catch(error => options.onError?.(error)); }
        catch (error) { options.onError?.(error); }
      },
      onOpen(...args) {
        if (active) {
          epoch++; submitted = false; composing = false; source=undefined; sourceError=undefined;
          try{source=options.captureSource?.();}catch(error){sourceError=error;}
        }
        const result = originals.onOpen.apply(this, args);
        const draft = options.getDraft?.();
        if (active && draft && !modal.inputEl.value) {
          modal.inputEl.value = draft;
          modal.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return result;
      },
    };
    const compositionStart = () => { composing = true; };
    const compositionEnd = () => { composing = false; };
    const input = () => { if(active)options.saveDraft?.(modal.inputEl.value); };
    const restore = () => {
      active = false;
      modal.inputEl.removeEventListener('compositionstart', compositionStart);
      modal.inputEl.removeEventListener('compositionend', compositionEnd);
      modal.inputEl.removeEventListener('input', input);
      for (const [name, descriptor] of descriptors) {
        // Preserve a later plugin's wrapper. Our closed-over wrapper is now inert.
        if (modal[name] !== wrappers[name]) continue;
        if (descriptor) Object.defineProperty(modal, name, descriptor);
        else delete (modal as Partial<PaletteModal>)[name];
      }
    };
    try {
      for (const name of methodNames) {
        const descriptor = Object.getOwnPropertyDescriptor(modal, name);
        descriptors.set(name, descriptor);
        Object.defineProperty(modal, name, descriptor && 'value' in descriptor
          ? { ...descriptor, value: wrappers[name] }
          : { configurable: true, writable: true, value: wrappers[name] });
      }
      modal.inputEl.addEventListener('compositionstart', compositionStart);
      modal.inputEl.addEventListener('compositionend', compositionEnd);
      modal.inputEl.addEventListener('input', input);
    } catch (error) { restore(); throw error; }
    return restore;
  }

  const controller: PaletteChatController = {
    get status() { return status; },
    reconcile() {
      if (disposed) return status;
      let candidate: unknown;
      try { candidate = findModal(app); }
      catch { candidate = undefined; }
      if (attached?.modal === candidate) return status;
      attached?.restore();
      attached = undefined;
      if (!candidate) return setStatus('unavailable');
      if (!compatible(candidate)) return setStatus('incompatible');
      try { attached = { modal: candidate, restore: attach(candidate) }; }
      catch { return setStatus('incompatible'); }
      return setStatus('active');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      attached?.restore();
      attached = undefined;
      setStatus('disposed');
    },
  };
  controller.reconcile();
  return controller;
}
