# Isolated native language views

Project `.ts`, `.mts`, and `.cts` files open in a view named `typescript`. `.tsx` uses that same view with its JSX grammar. JavaScript (`.js`, `.mjs`, `.cjs`, `.jsx`), JSON, CSS, and Python (`.py`, `.pyw`) use `javascript`, `json`, `css`, and `python`. Other text files use `plaintext`. Markdown and native media retain their usual views. No vault-wide extension mapping is changed. An existing extension handler remains under its current owner's control.

The language views inherit Obsidian's native editor and save lifecycle. They retain native search, undo, autosave, tabs, Reading controls, and saved workspace state. CodebaseBridge includes these named views in its checked save, clean refresh, peer update, and local draft recovery paths. Project bytes remain outside the physical vault.

## Markdown isolation

`language-views.ts` registers factories before saved Codebase references are adopted. The native adapter loads only when a code factory runs. Bundled grammar modules initialize on their first matching file, then share a cached promise. TypeScript/TSX and JavaScript/JSX have separate cached supports. A failed initialization can retry on a later file open.

`language-native.ts` changes only the code editor instance's local extension and option methods. It does not register a global language editor extension, patch MarkdownView's prototype, change vault settings, or add a language check to ordinary Markdown edits. Highlight styles are CodeMirror-scoped. Markdown's language facet, local extension identity, and global extension array stay unchanged.

Bundled JavaScript still has a startup parse cost even when module initialization is lazy. Cold-load timing and bundle size must be measured separately from Markdown edit timing. The feature does not promise zero plugin startup cost.

## Code behavior and limits

Code views remove Markdown frontmatter, properties, list continuation, and clipboard conversion. Code copy emits plain text. Paste and drop accept `text/plain`; image-only or HTML-only input is consumed without erasing a selection or importing attachments. Enter and Tab use code indentation. Source mode is local to the code view. An explicit LF document separator retains carriage-return bytes during loading and paste.

Documents above 300,000 UTF-16 code units use a constant-time plain-text language instead of the syntax grammar. Normal code editing and checked saves continue. Shrinking the document restores its grammar. Smaller documents use CodeMirror's normal incremental, viewport-based parser; the product adapter never forces a whole-file syntax tree. Native Obsidian and other plugins can still do their own editor work.

Reading renders a generated code fence. The delimiter is longer than every backtick run in the raw code. Preview `get`, native `data`, `lastSavedData`, editor content, and project writes retain raw text, including a missing final newline. Reading fold metadata is disabled. Reading scroll, line, and search positions map over the one presentation-only opening line. Large-file Reading requests no syntax highlighter.

## Compatibility and ownership

The adapter supports the tested Obsidian 1.13.7-and-later 1.13 family and the 1.14 family, with runtime method and clipboard-facet checks. Unknown versions show an unavailable view that retains its saved state. Another plugin's view factory is never replaced; a collision blocks that code route with an error. Existing local drafts remain in CodebaseBridge's device-local recovery store.

Pending grammar results check the live view, file identity, and load generation before application. Closing or switching a tab invalidates an older result. A code view rejects Markdown and mismatched language file types.

## Verification

Unit tests cover routing and variants, version checks, lazy caches and retries, raw fences, non-text transfers, type ownership, native lifecycle races, Reading offsets, and large-file fallback. The private desktop lab adds actual native parsers, input/clipboard behavior, native saves, same-view reuse, workspace state, and 720 Markdown edit pairs with unchanged Markdown configuration. The existing Codebase lab checks real external-file saves, peer refresh, Reading refresh, links, conflicts, images, and PDFs with the named views.

Full delivery also requires a clean-source immutable QLO2 release, fresh Sync scan, real QLO2 reload, bounded real project save, and immutable smoke evidence. Desktop tests do not establish native iPhone or Android behavior.

### Source validation, 2026-10-06

The canonical build and all 966 JavaScript plus 11 Python tests passed. Suites ran with CPU affinity to one core, giving Node one test worker; private desktop clients ran one at a time after the suite. This avoided overlapping high-memory work after the earlier unrelated QLO2 renderer OOM.

Real isolated Obsidian 1.13.7 and 1.14.4 clients passed every language profile, TSX/JSX, native same-type reuse, undo/redo, option updates, raw Reading with embedded backticks and no final newline, plain URL copy/paste, image-paste selection preservation, code Enter/frontmatter behavior, large-file fallback, CRLF saves, and named workspace-state restoration. Each client performed 720 Markdown insert/delete pairs with zero code transaction callbacks or grammar loads, identical Markdown language/local extensions, and an unchanged global extension count. Warm median times were 0.9–1.3 ms per edit pair; timings are local observations rather than a universal speed guarantee.

The production CodebaseBridge in an external synthetic-file lab passed named JSON/JavaScript/CSS browsing without ghost edits, Markdown/code autosaves, paired code refresh, raw code Reading refresh, typing during a pending save, checked conflict preservation and subsequent editing, native image/PDF handling, and unchanged physical vault inventory. Its path checks used programmatic native dispatch and a synthetic image URL. They do not complete the separate pending installed-code pointer/signed-image path smoke.

The unminified bundle grew from 1,342,174 to 1,570,883 bytes (+228,709). A separate nine-sample V8 compile-only check had medians of 33.3 ms before and 37.3 ms after. It did not evaluate the plugin or measure whole-app startup. Lazy grammar initialization therefore removes language work from ordinary Markdown editing, but does not remove bundle compilation cost.

Retained source/native evidence: `/home/ubuntu/backups/send-to-t3-code/language-views-implementation-20261006/source-native-evidence.json`. The three private clients were closed after verification. Production QLO2 installation and live smoke are separate release gates.
