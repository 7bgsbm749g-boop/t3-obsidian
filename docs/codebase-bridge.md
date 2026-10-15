# Native project file bridge

The plugin owns this bridge. T3 is unchanged. Project bytes remain in the project workspace, outside the vault. Obsidian's native MarkdownView, image viewer and PDF viewer operate on virtual TFile identities through a scoped storage adapter.

## Storage boundary

`codebase-core.ts` defines workspace identities, path validation and save state. `codebase-transport.ts` uses existing authenticated T3 RPCs for directory listing, search, text reads/writes and signed previews. Reads verify the project/thread workspace against a catalog snapshot with a 15-second lifetime. Writes force a fresh catalog check. One credential owner and multiplexed socket are reused per machine; connection setup and upstream requests have bounded waits. A moved or missing workspace fails rather than silently opening a different file.

`codebase-native.ts` maintains its own TFile/TFolder objects. It wraps explicit file lookup, file read/write, resource lookup, metadata link lookup and native link opening. The physical root, global fileMap, adapter listing and vault file enumeration remain unchanged. The bridge emits no global vault create/modify events. Thus Headless Sync has no physical project bytes to scan. Native desktop core Sync enumeration is not modified, but the isolated validation does not establish native mobile or every third-party plugin's behavior.

The only synced bridge data is identity/reference/choice metadata in the plugin's shared `data.json` settings. Draft text stays in device-local storage. Signed resource URLs and credentials do not enter that metadata or note text. New response registrations use protocol v4, which older import-capable writers reject. Reload the updated plugin on other devices before sending new jobs there. Legacy jobs are still readable by the updated writer. Response delivery never creates attachment folders. Old imports remain until an explicit cleanup; they are not evidence of a new import.

The desktop maintenance command `archive-reply-imports` moves the old default `T3 Code Attachments` tree into an existing linked project on that desktop. Use `scripts/obsidian-command.py --vault VAULT archive-reply-imports --project-id PROJECT --environment-id ENVIRONMENT --archive-directory PROJECT_RELATIVE_DIRECTORY` with verified identities. It accepts only the old UUID-folder/hash-prefixed filename layout, refuses unrelated content, symlinks, nested vault/project roots and open attachment tabs, and never runs automatically. Every archive is created exclusively and checked byte-for-byte; an exact retry can reuse matching copies. Supported text copies are also verified through the authenticated T3 project reader. Synced `vaultAliases` metadata preserves existing links without changing note text. Only after that metadata is saved does the command recheck and remove each vault copy, then prune empty folders. Changed or unavailable copies stop cleanup. Physical vault files retain precedence while they remain. An unlinked archive fails closed instead of creating a missing vault note. Reload the updated plugin on other devices so they can resolve these aliases. The archive retains the imported historical bytes, which may differ from today's original source file.

## Native editing

Markdown opens in native MarkdownView with normal source, Live Preview and reading controls. Text/code uses separately registered native language views, with syntax rules and code options applied only to those editor instances. These views keep the native save, undo, search and Reading lifecycle; their raw code, checked save basis, peer refresh and local draft recovery participate in the same bridge. See [isolated language views](language-views.md) for file types, lazy grammars, large-file fallback and compatibility checks. Native autosave routes to projects.writeFile. Images and PDFs use native viewers with signed preview URLs prepared before opening. Formats unsupported by Obsidian or T3's preview API are not substituted with custom viewers. Binary modification, rename and deletion fail without touching either workspace or vault.

The save queue checks the loaded base against a fresh remote read, writes once, then reads back. An uncertain write is never blindly retried. Failed/conflicting edits remain local and can be compared through Review unsaved project edit. Restored drafts cannot auto-overwrite the remote version. T3 has no atomic compare-and-swap API: external writers can still race between checks. UTF-8 byte-inexact or truncated reads are rejected, including files above T3's text limit.

Unchanged native buffers do not check or write remote files and do not replace retained recovery edits. Editor save bases include the full virtual file identity, so a reused native tab cannot carry the previous file's base into a new file. A clean remote refresh and a fresh vault read also update guarded native saved-buffer fields. Each editor keeps its own loaded text independently of the shared read cache. A failed native update retains that editor basis for retry; delayed refreshes recheck the current file identity before touching a reused tab. Retained recovery text stays out of autosave on reopen. Use the review command to compare, copy, or explicitly save it.

## Links and discovery

Notes keep original Markdown links and wikilinks, including absolute agent paths. Wiki links in vault notes use Obsidian's native resolution and missing-note creation, including aliases, headings and names that also exist in a project. Native internal-link clicks pass through the document handler. Unclaimed vault links do not search projects or wait for a network connection. Explicit project Markdown paths and registered project references retain bridge routing. The nearest linked project narrows basename matches; ambiguous matches require a chooser, and its choice is remembered per source note and link name. Worktree references retain the thread identity. Links inside project files can search uncached project names asynchronously. Known offline project files fail to open instead of creating vault notes.

Codebase view is a separate left sidebar tab with the code-xml icon. It lists non-self linked projects once, expands directories lazily, and provides Markdown links with explicit project paths through the Copy link and Insert link file context actions. Visible expanded folders and clean open text files refresh every 15 seconds. Device-local caches retain folder names, worktree names and expansion state across reloads. Cached rows appear before network work and remain during offline errors. The tree reconciles native explorer rows by identity, retains scroll/focus, and limits independent requests to four. Duplicate folder requests share one promise. Clean text is cached only in memory for 15 seconds; save verification always reads fresh bytes. Shared metadata records only files opened or linked, rather than every browsed entry. A changed workspace root has a separate native identity, so an old editor cannot save into a new workspace. No new T3 event protocol or server endpoint is required.

Projects with the same title show a short workspace hint in the tree, native headers, recent-file suggestions, and file choosers. The full workspace root remains in the tree tooltip. Explicit links are not changed merely because another project has the same name: an archived link to an installed runtime and a current link to a source checkout remain separate projects.

Right-click a project root for **Rename project…** or **Delete project…**. These use the existing authenticated T3 project commands. Rename changes the T3 title and the titles of matching folder links. Delete requires a native confirmation that names the workspace and states that the project and its threads will be removed from T3; the workspace folder and vault notes remain. The matching folder links are removed after confirmation. Worktrees and nested directories do not expose these project actions, and a project represented by a self/vault link is excluded even if it has another ordinary link. Mutations verify the project identity and root against a fresh catalog, dispatch once, then confirm the result from another fresh catalog. Confirmed local link updates are retained for retry without repeating the remote command.

## Verification

The isolated `validation/codebase-lab.ts` runs against external synthetic files through the production bridge. It checks native MarkdownView/code opening, native autosave, bare link routing, conflict preservation, an unchanged physical file inventory, paired native editor refresh, and cached sidebar timing. Build with `node scripts/build-native-response-lab.mjs NEW_PRIVATE_EVIDENCE_DIR --codebase`; launch the returned independent profile. Full product delivery additionally requires the immutable QLO2 release, fresh Sync scan, native client reload and retained live smoke evidence.

Native iPhone/Android coverage is not available on this VPS. The bridge uses internal Obsidian compatibility hooks; future Obsidian updates need the native regression checks. Third-party vault-wide enumeration continues to see only physical vault files; project links are resolved by this plugin.

## Original project paths

Agent responses keep their original Markdown and wikilink targets. Vault wiki
links retain native Obsidian behavior. For project references, the bridge
resolves absolute workspace paths, local `file:` URLs, `sandbox:` paths, and
Obsidian's slashless form before physical vault lookup. An accidental physical
copy therefore cannot capture an exact project path. Bare vault links retain
their existing precedence. Paths must fall within a known linked workspace at
a directory boundary; traversal and invalid owned paths cannot create notes.

The source note's recorded choice, linked project and machine select the
workspace before choosing its longest matching root. Main workspaces and thread
worktrees have separate identities. Cached explorer worktrees participate in
synchronous resolution; cold absolute clicks discover worktrees once per root
within a 15-second interval. Removed or moved recorded roots retain ownership
for the unavailable state, but cannot hide a current matching workspace.

Heading fragments, PDF fragments and zero-based line/column navigation pass
through native view state. Local file-URL clicks and rendered image resources
use small native Markdown adapters; no saved link text, editor language,
physical vault inventory or project file content is changed by resolution.
Signed image URLs remain only in the rendered DOM and in memory.


The 2026-10-06 isolated desktop run retained evidence at
`/home/ubuntu/backups/send-to-t3-code/path-routing-native-20261006-g`.
Native clicks opened unchanged absolute references, file URLs and embedded
images. The native cursor reached zero-based line 6 / column 3, a heading link
reached line 4, and the native PDF toolbar selected page 2. Missing project
files created no vault notes; project autosave and conflict recovery passed.
Ten consecutive native opens had a 2 ms median (including one cold open); the
cold maximum was 117.6 ms. Forty cached sidebar reveals had a 0.6 ms p95.
These are desktop lab measurements, not network or native mobile guarantees.

Independent review retained normal-Markdown and exact-path lookup measurements
in the completion-alert implementation evidence directory. With ten projects
and 3,000 registered files, median CPU time per 100 lookups was 0.025 ms for
bare physical links, 0.035 ms for web URLs, 0.667 ms for physical folder links,
and approximately 11 ms for exact project paths. No IO occurred. These figures
were measured while other tests were running; network opens remain separate.
