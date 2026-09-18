export type WorkflowMode = 'trigger';

export interface FolderWorkflowLink {
  id: string;
  folderPath: string;
  connectionId: string;
  projectId: string;
  mode: WorkflowMode;
  /** Canonical tag without the leading #. Required in trigger mode. */
  tag?: string;
  enabled: boolean;
}

export type WorkflowEventKind = 'create' | 'rename' | 'modify' | 'scan';

export interface WorkflowEvent {
  kind: WorkflowEventKind;
  path: string;
  previousPath?: string;
  /** Stable for the lifetime of a note, including renames. Obsidian's ctime is suitable. */
  noteId: string;
  tags?: Iterable<string>;
}

export interface WorkflowReceipt {
  key: string;
  linkId: string;
  noteId: string;
  path: string;
  sentAt: number;
}

export interface WorkflowDecision {
  link: FolderWorkflowLink;
  receiptKey: string;
}

function cleanPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
}

export function normalizeFolderPath(value: string): string {
  const path = cleanPath(value);
  if (!path || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Choose a folder inside the vault.');
  }
  return path;
}

export function normalizeWorkflowTag(value: string): string {
  const tag = value.trim().replace(/^#+/, '').toLocaleLowerCase();
  if (!tag || /[\s#,[\]|]/u.test(tag)) throw new Error('Enter one tag, such as #ready.');
  return tag;
}

export function normalizeWorkflowLink(value: FolderWorkflowLink): FolderWorkflowLink {
  const link: FolderWorkflowLink = {
    id: value.id.trim(),
    folderPath: normalizeFolderPath(value.folderPath),
    connectionId: value.connectionId.trim(),
    projectId: value.projectId.trim(),
    mode: value.mode,
    enabled: value.enabled !== false,
  };
  if (!link.id || !link.connectionId || !link.projectId) throw new Error('The workflow link is incomplete.');
  if (link.mode !== 'trigger') throw new Error('Unknown workflow mode.');
  link.tag = normalizeWorkflowTag(value.tag ?? '');
  return link;
}

export function isPathInFolder(path: string, folderPath: string): boolean {
  const file = cleanPath(path);
  const folder = cleanPath(folderPath);
  return !!folder && file.startsWith(`${folder}/`);
}

export function workflowReceiptKey(linkId: string, noteId: string): string {
  return `${encodeURIComponent(linkId)}:${encodeURIComponent(noteId)}`;
}

function hasTag(tags: Iterable<string> | undefined, required: string | undefined): boolean {
  if (!tags || !required) return false;
  for (const value of tags) {
    try { if (normalizeWorkflowTag(value) === required) return true; } catch { /* Ignore malformed metadata. */ }
  }
  return false;
}

/**
 * Returns the links that should create a thread for one vault event. Receipts are
 * supplied by the integration and persisted only after a send has been accepted.
 */
export function evaluateWorkflowEvent(
  event: WorkflowEvent,
  links: readonly FolderWorkflowLink[],
  receiptKeys: ReadonlySet<string>,
): WorkflowDecision[] {
  if (!event.path.toLocaleLowerCase().endsWith('.md') || !event.noteId) return [];
  const decisions: WorkflowDecision[] = [];
  for (const raw of links) {
    let link: FolderWorkflowLink;
    try { link = normalizeWorkflowLink(raw); } catch { continue; }
    if (!link.enabled || !isPathInFolder(event.path, link.folderPath)) continue;
    const entered = event.kind === 'create' || event.kind === 'scan' ||
      (event.kind === 'rename' && !isPathInFolder(event.previousPath ?? '', link.folderPath));
    // New Obsidian notes are commonly created empty and populated by a modify
    // event moments later. The integration debounces those edits; the receipt
    // still ensures that only the first settled version is sent.
    if (!entered && event.kind !== 'modify') continue;
    if (link.mode === 'trigger' && !hasTag(event.tags, link.tag)) continue;
    const receiptKey = workflowReceiptKey(link.id, event.noteId);
    if (!receiptKeys.has(receiptKey)) decisions.push({link, receiptKey});
  }
  return decisions;
}

export function makeWorkflowReceipt(decision: WorkflowDecision, event: WorkflowEvent, sentAt = Date.now()): WorkflowReceipt {
  return {key: decision.receiptKey, linkId: decision.link.id, noteId: event.noteId, path: cleanPath(event.path), sentAt};
}

/** Atomically reserves a send before its first await; release the key if sending fails. */
export function claimWorkflowDecision(decision: WorkflowDecision, claimedKeys: Set<string>): boolean {
  if (claimedKeys.has(decision.receiptKey)) return false;
  claimedKeys.add(decision.receiptKey);
  return true;
}
