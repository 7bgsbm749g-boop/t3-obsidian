import {folderLinkForPath,type FolderLink} from './folder-link';

export interface TagReceipt {
  id: string;
  linkId: string;
  path: string;
  ctime: number;
  requestId: string;
  state: 'sending' | 'sent' | 'failed';
  detail?: string;
}

export interface TagTriggerHost {
  deviceId: string;
  getLinks(): FolderLink[];
  /** The live, device-local collection, persisted by save(). */
  getReceipts(): TagReceipt[];
  save(): Promise<void>;
  getNote(path: string): Promise<{path: string; ctime: number; tags: string[]} | undefined>;
  send(path: string, link: FolderLink, requestId: string): Promise<void>;
  isBusy(): boolean;
  isStopped(): boolean;
  report(error: string): void;
}

export function normalizeTriggerTag(value: string): string {
  const tag = value.trim().replace(/^#/, '');
  if (!/^[\p{L}\p{N}_/-]+$/u.test(tag) || !/[\p{L}_/-]/u.test(tag) || tag.split('/').some(part => !part)) {
    throw Error('Enter one tag, such as #ready or #tasks/ready.');
  }
  return `#${tag.toLowerCase()}`;
}

function requestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Optional event-driven sends; neither scans the vault nor retries failed deliveries. */
export class TagTriggerService {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private stopped = false;
  private processing = false;

  constructor(private host: TagTriggerHost, private debounceMs = 1000) {}

  schedule(path: string): void {
    if (this.inactive() || !path.toLowerCase().endsWith('.md')) return;
    clearTimeout(this.timers.get(path));
    this.timers.set(path, setTimeout(() => {
      this.timers.delete(path);
      void this.process(path).catch(error => this.host.report(`T3 tag trigger: ${String(error)}`));
    }, this.debounceMs));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const moved = (path: string) => path === oldPath || path.startsWith(`${oldPath}/`);
    for (const [path, timer] of [...this.timers]) if (moved(path)) {
      clearTimeout(timer);
      this.timers.delete(path);
      this.schedule(newPath + path.slice(oldPath.length));
    }
    let changed = false;
    for (const receipt of this.host.getReceipts()) if (moved(receipt.path)) {
      receipt.path = newPath + receipt.path.slice(oldPath.length);
      changed = true;
    }
    if (changed) await this.host.save();
    this.schedule(newPath);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private inactive() { return this.stopped || this.host.isStopped(); }

  private matchingLink(path: string, tags: string[]): FolderLink | undefined {
    // An inner folder link owns its subtree even when its trigger is disabled.
    const link = folderLinkForPath(this.host.getLinks(),path);
    const trigger = link?.tagTrigger;
    if (!trigger?.enabled || trigger.deviceId !== this.host.deviceId) return;
    let expected: string;
    try { expected = normalizeTriggerTag(trigger.tag); } catch { return; }
    if (!tags.some(tag => { try { return normalizeTriggerTag(tag) === expected; } catch { return false; } })) return;
    return link;
  }

  private async process(path: string): Promise<void> {
    if (this.inactive()) return;
    if (this.processing || this.host.isBusy()) { this.schedule(path); return; }
    this.processing = true;
    try {
      const note = await this.host.getNote(path);
      if (!note || note.path !== path || this.inactive()) return;
      const link = this.matchingLink(path, note.tags);
      if (!link || this.host.getReceipts().some(item => item.linkId === link.id && item.path === path && item.ctime === note.ctime)) return;
      if (this.host.isBusy()) { this.schedule(path); return; }
      const target = {projectId: link.projectId, connectionId: link.connectionId, tag: link.tagTrigger?.tag};
      const id = requestId();
      const receipt: TagReceipt = {id, linkId: link.id, path, ctime: note.ctime, requestId: id, state: 'sending'};
      this.host.getReceipts().push(receipt);
      try {
        // Persist intent first: an interrupted or uncertain send must never auto-retry.
        await this.host.save();
      } catch (error) {
        receipt.state = 'failed';
        receipt.detail = `Could not save the send record; no thread was started. ${String(error)}`;
        this.host.report(receipt.detail);
        return;
      }
      const latest = await this.host.getNote(path);
      const current = latest && this.matchingLink(path, latest.tags);
      if (this.inactive() || !latest || latest.ctime !== note.ctime || current?.id !== link.id
          || current.projectId !== target.projectId || current.connectionId !== target.connectionId
          || current.tagTrigger?.tag !== target.tag) {
        receipt.state = 'failed';
        receipt.detail = 'The note or folder trigger changed before sending; no thread was started.';
        await this.host.save();
        return;
      }
      try {
        await this.host.send(path, current, id);
        receipt.state = 'sent';
      } catch (error) {
        receipt.state = 'failed';
        receipt.detail = error instanceof Error ? error.message : String(error);
        this.host.report(`T3 tag trigger for ${path}: ${receipt.detail}`);
      }
      await this.host.save();
    } finally {
      this.processing = false;
    }
  }
}
