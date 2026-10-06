# Native project file bridge

The plugin owns this bridge. T3 is unchanged. Project bytes remain in the project workspace, outside the vault. Obsidian's native MarkdownView, image viewer and PDF viewer operate on virtual TFile identities through a scoped storage adapter.

## Storage boundary

`codebase-core.ts` defines workspace identities, path validation and save state. `codebase-transport.ts` uses existing authenticated T3 RPCs for directory listing, search, text reads/writes and signed previews. Reads verify the project/thread workspace against a catalog snapshot with a 15-second lifetime. Writes force a fresh catalog check. One credential owner and multiplexed socket are reused per machine; connection setup and upstream requests have bounded waits. A moved or missing workspace fails rather than silently opening a different file.

`codebase-native.ts` maintains its own TFile/TFolder objects. It wraps explicit file lookup, file read/write, resource lookup, metadata link lookup and native link opening. The physical root, global fileMap, adapter listing and vault file enumeration remain unchanged. The bridge emits no global vault create/modify events. Thus Headless Sync has no physical project bytes to scan. Native desktop core Sync enumeration is not modified, but the isolated validation does not establish native mobile or every third-party plugin's behavior.

The only synced bridge data is identity/reference/choice metadata in the plugin's shared `data.json` settings. Draft text stays in device-local storage. Signed resource URLs and credentials do not enter that metadata or note text. New response registrations use protocol v4, which older import-capable writers reject. Reload the updated plugin on other devices before sending new jobs there. Legacy jobs are still readable by the updated writer. Existing imports are retained for a separate audit; no automatic cleanup deletes or rewrites them.

## Native editing

Markdown opens in native MarkdownView with normal source, Live Preview and reading controls. Text/code uses the same view in source mode. Native autosave routes to projects.writeFile. Images and PDFs use native viewers with signed preview URLs prepared before opening. Formats unsupported by Obsidian or T3's preview API are not substituted with custom viewers. Binary modification, rename and deletion fail without touching either workspace or vault.

The save queue checks the loaded base against a fresh remote read, writes once, then reads back. An uncertain write is never blindly retried. Failed/conflicting edits remain local and can be compared through Review unsaved project edit. Restored drafts cannot auto-overwrite the remote version. T3 has no atomic compare-and-swap API: external writers can still race between checks. UTF-8 byte-inexact or truncated reads are rejected, including files above T3's text limit.

## Links and discovery

Notes keep ordinary bare wikilinks. Existing physical vault links win. The nearest linked project narrows basename matches; ambiguous matches require a chooser, and its choice is remembered per source note and link name. Worktree references retain the thread identity. Link opening searches uncached project names asynchronously before Obsidian's normal missing-link creation path. Known offline project files fail to open instead of creating vault notes.

Codebase view is a separate left sidebar tab with the code-xml icon. It lists non-self linked projects once, expands directories lazily, and provides bare wikilinks through the file context action. Visible expanded folders and clean open text files refresh every 15 seconds. Device-local caches retain folder names, worktree names and expansion state across reloads. Cached rows appear before network work and remain during offline errors. The tree reconciles native explorer rows by identity, retains scroll/focus, and limits independent requests to four. Duplicate folder requests share one promise. Clean text is cached only in memory for 15 seconds; save verification always reads fresh bytes. Shared metadata records only files opened or linked, rather than every browsed entry. A changed workspace root has a separate native identity, so an old editor cannot save into a new workspace. No new T3 event protocol or server endpoint is required.

## Verification

The isolated `validation/codebase-lab.ts` runs against external synthetic files through the production bridge. It checks native MarkdownView/code opening, native autosave, bare link routing, conflict preservation, an unchanged physical file inventory, paired native editor refresh, and cached sidebar timing. Build with `node scripts/build-native-response-lab.mjs NEW_PRIVATE_EVIDENCE_DIR --codebase`; launch the returned independent profile. Full product delivery additionally requires the immutable QLO2 release, fresh Sync scan, native client reload and retained live smoke evidence.

Native iPhone/Android coverage is not available on this VPS. The bridge uses internal Obsidian compatibility hooks; future Obsidian updates need the native regression checks. Third-party vault-wide enumeration continues to see only physical vault files; project links are resolved by this plugin.
