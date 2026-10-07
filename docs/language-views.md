# Isolated native language views

Project `.ts`, `.mts`, and `.cts` files open in a view named `typescript`. `.tsx` uses that same view with its JSX grammar. JavaScript (`.js`, `.mjs`, `.cjs`, `.jsx`), JSON, CSS, and Python (`.py`, `.pyw`, `.pyi`) use `javascript`, `json`, `css`, and `python`. Other text files use `plaintext`. Markdown and native media retain their usual views. No vault-wide extension mapping is changed. An existing extension handler remains under its current owner's control.

The language views inherit Obsidian's native editor and save lifecycle. They retain native search, undo, autosave, tabs, Reading controls, and saved workspace state. CodebaseBridge includes these named views in its checked save, clean refresh, peer update, and local draft recovery paths. Project bytes remain outside the physical vault. The checked reload guard also checks every owned code view and rechecks saved bytes after its durable acknowledgement, before dispatching Reload app without saving.

## Markdown isolation

`language-views.ts` registers factories before saved Codebase references are adopted. The native adapter loads only when a code factory runs. Bundled grammar modules initialize on their first matching file, then share a cached promise. TypeScript/TSX and JavaScript/JSX have separate cached supports. A failed initialization can retry on a later file open.

`language-native.ts` changes only the code editor instance's local extension and option methods. It does not register a global language editor extension, patch MarkdownView's prototype, change vault settings, or add a language check to ordinary Markdown edits. Highlight styles are CodeMirror-scoped. Markdown's language facet, local extension identity, and global extension array stay unchanged.

Bundled JavaScript still has a startup parse cost even when module initialization is lazy. Cold-load timing and bundle size must be measured separately from Markdown edit timing. The feature does not promise zero plugin startup cost.

## Code behavior and limits

Code views remove Markdown frontmatter, properties, list continuation, and clipboard conversion. Code copy emits plain text. Paste and drop accept `text/plain`; image-only or HTML-only input is consumed without erasing a selection or importing attachments. Enter and Tab use code indentation. Source mode is local to the code view. An explicit LF document separator retains carriage-return bytes during loading and paste.

Existing indentation is not rewritten. Source and Reading use the device's monospace font and validated native tab width (default four columns). Their font and tab rules apply only inside a named code view. Native incremental code updates use a raw UTF-16 diff; they preserve spaces, tabs, CRLF, mixed line endings, and a missing final newline through Reading/Source switches and same-view reuse.

Documents above 300,000 UTF-16 code units use a constant-time plain-text language instead of the syntax grammar. Normal code editing and checked saves continue. Shrinking the document restores its grammar. Smaller documents use CodeMirror's normal incremental, viewport-based parser; the product adapter never forces a whole-file syntax tree. Native Obsidian and other plugins can still do their own editor work.

Reading renders a generated code fence. The delimiter is longer than every backtick run in the raw code. Preview `get`, native `data`, `lastSavedData`, editor content, and project writes retain raw text, including a missing final newline. Reading fold metadata is disabled. Reading scroll, line, and search positions map over the one presentation-only opening line. Large-file Reading requests no syntax highlighter.

## Compatibility and ownership

The adapter supports the tested Obsidian 1.13.7-and-later 1.13 family and the 1.14 family, with runtime method and clipboard-facet checks. Unknown versions show an unavailable view that retains its saved state. Another plugin's view factory is never replaced; a collision blocks that code route with an error. Existing local drafts remain in CodebaseBridge's device-local recovery store.

Pending grammar results check the live view, file identity, and load generation before application. Closing or switching a tab invalidates an older result. A code view rejects Markdown and mismatched language file types.

## Verification

Unit tests cover routing and variants, version checks, lazy caches and retries, raw fences, non-text transfers, type ownership, native lifecycle races, Reading offsets, and large-file fallback. The private desktop lab adds actual native parsers, input/clipboard behavior, native saves, same-view reuse, workspace state, and 720 Markdown edit pairs with unchanged Markdown configuration. The existing Codebase lab checks real external-file saves, peer refresh, Reading refresh, links, conflicts, images, and PDFs with the named views.

Full delivery also requires a clean-source immutable QLO2 release, fresh Sync scan, real QLO2 reload, bounded real project save, and immutable smoke evidence. Desktop tests do not establish native iPhone or Android behavior.

### Incomplete installed smoke, 2.34.10

The installed native test found that core's incremental editor setter splits on `\r?\n` and removes carriage returns when returning from Reading. Initial load and the first real checked project save remained exact. The affected file was a unique synthetic fixture; its raw host/buffer comparison, failed smoke, retained synthetic draft, and cleanup are recorded outside the vault in `language-views-implementation-20261006/qlo2-23410-failed-live-smoke.json`. All 19 original Markdown leaf IDs and the original active note were preserved. This release has no complete smoke receipt and must not be described as complete. The source correction changes only the named code instance's setter.

### Ordered language expansion

After the corrected TypeScript release completes native QLO2 smoke, each requested programming language gets a separate reviewed source commit, newer immutable release, fresh Sync, checked reload, and complete native smoke. The selection is the latest published TIOBE index available on 2026-10-06 (September 2026): Python, C, C++, Java, C#, JavaScript, Visual Basic, SQL, R, and Rust. Source: https://www.tiobe.com/tiobe-index/ . Existing Python and JavaScript support will receive a distinct language-specific validation/integration commit and release. The user also approved all fifteen additional formats: Go, PHP, Ruby, Kotlin, Swift, Dart, Bash, PowerShell, Lua, HTML, CSS, JSON, YAML, TOML, and XML. This gives 26 named formats including TypeScript. Each addition receives its own commit and tested immutable release. The path-routing owner's pending bounded native slot follows the completed TypeScript release and precedes these language releases. GUI slots and test workloads remain serialized with the path-routing owner.

### Source validation, 2026-10-06

The canonical build and all 967 JavaScript plus 11 Python tests passed. Suites ran with CPU affinity to one core, giving Node one test worker; private desktop clients ran one at a time after the suite. This avoided overlapping high-memory work after the earlier unrelated QLO2 renderer OOM.

Real isolated Obsidian 1.13.7 and 1.14.4 clients passed every language profile, TSX/JSX, native same-type reuse, undo/redo, option updates, raw Reading with embedded backticks and no final newline, plain URL copy/paste, image-paste selection preservation, code Enter/frontmatter behavior, large-file fallback, CRLF saves, and named workspace-state restoration. Each client performed 720 Markdown insert/delete pairs with zero code transaction callbacks or grammar loads, identical Markdown language/local extensions, and an unchanged global extension count. Warm median times were 0.9–1.3 ms per edit pair; timings are local observations rather than a universal speed guarantee.

The production CodebaseBridge in an external synthetic-file lab passed named JSON/JavaScript/CSS browsing without ghost edits, Markdown/code autosaves, paired code refresh, raw code Reading refresh, typing during a pending save, checked conflict preservation and subsequent editing, native image/PDF handling, and unchanged physical vault inventory. Its path checks used programmatic native dispatch and a synthetic image URL. They do not complete the separate pending installed-code pointer/signed-image path smoke.

The unminified bundle grew from 1,342,174 to 1,570,883 bytes (+228,709). A separate nine-sample V8 compile-only check had medians of 33.3 ms before and 37.3 ms after. It did not evaluate the plugin or measure whole-app startup. Lazy grammar initialization therefore removes language work from ordinary Markdown editing, but does not remove bundle compilation cost.

Retained source/native evidence: `/home/ubuntu/backups/send-to-t3-code/language-views-implementation-20261006/source-native-evidence.json`. The three private clients were closed after verification. Production QLO2 installation and live smoke are separate release gates.

### Exact whitespace correction, 2026-10-06

The canonical build and complete 969 JavaScript + 11 Python suite passed. New real isolated desktop checks on core 1.13.7 and 1.14.4 passed mixed CRLF/LF code with existing spaces and literal tabs, exact incremental updates, Reading/Source round trip, and the subsequent native save. Source and Reading reported identical monospace font families and four-column tab widths. Both clients also passed the existing language/editor checks and 720 Markdown edit pairs with no code callbacks or grammar loads. Their runtime directories were separate from production, and both owned clients were closed after testing. Evidence is retained in `native-language-1137-whitespace-v2` and `native-language-1144-whitespace-v2` under the outside-vault implementation evidence root. Installed QLO2 smoke of the corrected release remains required.

### Completed TypeScript delivery, 2.34.11

Immutable 2.34.11 contains reviewed whitespace source `9f98834` and version metadata `c5f01e6`. Its clean release build and full 969 JavaScript + 11 Python suite passed. Development and QLO2 received the exact immutable runtime, deployment preserved both settings files, and the fresh Sync scan reached Fully synced.

Actual QLO2 pointer opening, native typing and checked project save passed. Source and Reading displayed existing four-space indentation and literal tabs with the same monospace font and four-column tab width. Mixed CRLF/LF and no final newline remained byte-exact after Reading, checked Reload app without saving, restored Reading, and return to Source. The final external-file SHA256 was `d64f851eed59624dca791583e6f71ba80c266a32a45f8e21d52ffdaa61b24947`. Restored Reading completed its asynchronous TypeScript highlighting. The native Markdown check passed 120 edit pairs with zero code callbacks or grammar loads and unchanged configuration.

All 19 original Markdown leaves and the original active Diagnose note were restored. Owned synthetic notes, tabs, project files, references, and drafts were removed. An unrelated user note received through Sync during the test remains preserved. Native CLI is off, the global configuration equals its byte-exact preimage, and plugin settings differ only in normal delivery metadata.

The run was interrupted before fixture creation by a kernel OOM that killed the prior renderer. After the service restarted, a stalled native file queue was released with the built-in adapter timeout after host/buffer comparison and user-note backups. That queue stalled again during cleanup; independent native and host checks verified cleanup after the asynchronous helper exceeded its CLI deadline. These interruptions are retained in the evidence and were not repaired by changing installed source. They do not establish an OOM-free startup or a native-core queue fix.

Complete receipt: `/home/ubuntu/backups/send-to-t3-code/releases/2.34.11/smoke-vps-qlo2.json`. Retained evidence: `/home/ubuntu/backups/send-to-t3-code/language-views-implementation-20261006/qlo2-23411/evidence.json` (240 hashed artifacts). Final VPS instance `30ba821d-6b51-4faa-81a8-ee174a0247b0` loaded 2.34.11 on core 1.14.4. Native Windows and mobile behavior remain unverified. At this TypeScript handoff, the separately owned path-pointer smoke remained incomplete; its subsequent slot preceded the remaining 25 format releases.

### Python integration, 2026-10-07

Python source (`.py`), windowed source (`.pyw`), and typed stubs (`.pyi`) use the same isolated Python view and cached official Python grammar. Stub files are Python syntax with a distinct extension, as defined by [PEP 484](https://peps.python.org/pep-0484/#stub-files). Reading explicitly requests the Python highlighter for each extension. Source parser tests cover typed class/function declarations, strings, numbers, and four-column block indentation while keeping raw mixed line endings. Existing raw text, spaces and tabs use the common native-view preservation path; opening a stub does not run its contents.

The separately scheduled native path slot subsequently passed on unchanged 2.34.11. Its independent complete receipt is `/home/ubuntu/backups/send-to-t3-code/releases/2.34.11/smoke-vps-qlo2-path-routing.json`. The subsequent indicator release 2.34.12 is also complete and returned a clean source/GUI handoff. Python is the next separately committed and released format.
