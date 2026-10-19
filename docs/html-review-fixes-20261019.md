# HTML review fixes, 2026-10-19

Base: `353c8d1`. Scope: source changes in the implementation worktree only.
The work does not change `main.ts` or the attachment store. Origin, source
identity, hash, size, MIME, UTF-8 and cache checks remain in place.

## Edit delay

`validation/html-result-edit-benchmark.ts` runs the production Live Preview
extension with real CodeMirror state transactions. The synthetic note contains
52 KiB of Markdown prose. The reference case adds one 286-character generated
HTML fence near its middle. Each location has four warmup transactions and 24
measured alternating single-character insert/delete transactions. Each
transaction checks that the expected widget remains present.

The same benchmark ran before and after the change on Linux x64, Node v22.22.1.
Times below are milliseconds per transaction.

| Edit location | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| Start | 257.66 | 3.14 | 312.21 | 29.18 |
| Before the reference | 330.25 | 5.25 | 475.43 | 16.16 |
| End | 265.71 | 0.75 | 308.12 | 4.27 |

Without a reference, median times were 0.13–0.27 ms before and 0.06–0.09 ms
after. The final after-run was taken after the full test command had ended.
These measurements cover synchronous editor state work. They do not
measure a native client's paint, iframe execution, or mobile performance.

The new index scans changed lines for candidate fences. An incremental Markdown
tree retains fence, list and HTML context. Remark checks only individual
top-level candidate fences. Unchanged references reuse their parsed values.
Differential tests compare the index with full-document Remark results through
structural edits and restoration. The production extension tests also check
widget equality and Source/Live Preview mode changes.

## Pending recovery

Both new pending-load regression tests fail against the original source. A
recovery call made while an old request is pending now waits for that request.
If it fails with an auth, connection or HTTP error, the viewer retries once.
Concurrent calls share that recovery. A failed retry remains actionable and
waits for a later host transition or manual Retry.

The tests use two mounts and the real attachment store to verify one original
access request, one retry and one download. They also check a failed retry,
successful pending loads, verification failures, disposal and loaded frames.
There are no retry timers or automatic retry loops.

## Evidence

`npm test` passed: 1,105 TypeScript tests and 19 Python tests. After the final
indentation correction, all 38 focused tests and `npm run build` passed.
`git diff --check` passed. The final correction preserves the opening fence's
indentation when checking multiline payloads near the existing reference limit.

Raw evidence is outside all vaults in the implementation worktree:
`evidence/html-review-fixes/`. It includes `before.json`, `after.json`, the
original failing tests in `pending-before.txt`, and validation command logs.
This directory is ignored by Git. The benchmark and regression tests are
committed so the results can be reproduced.
An additional run taken while the full suite was active remains in
`after-under-suite-load.json`; the table uses the later `after.json` run.

No native client fixture, real credentials, vault content, provider dispatch,
release, deployment or push was used for this work.

## Context indexing follow-up (base `499645b`)

The remaining review examples exposed different block rules in Lezer and
Remark. `[a]: /x\n<span>\n` followed by a generated fence must retain one
reference; `>\n<span>\n` followed by the same fence must retain none. A Remark
check of an isolated fence cannot repair the earlier context decision.

`HtmlResultIndex` now uses Micromark's flow grammar, as Remark does. It leaves
inline text and string tokens unexpanded. This covers all CommonMark HTML block
types without rules for individual tags. Per-fence Remark validation still
applies the generated-fence, complete closure, metadata, indentation and payload
size rules, and unchanged fences retain their parsed reference objects.

The index caches sections separated by top-level blank runs. Blanks inside
lists, code and HTML do not split sections. A blank run becomes a boundary only
after the following block is observed. A context edit reparses the affected
section, its predecessor and lookahead. The predecessor is necessary because
an indentation edit can extend an earlier list or indented code block. A suffix
is reused only when parsing confirms its old boundary after the last change.
If that boundary disappears, the parsing window grows geometrically in source
characters. This bounds repeated parsing to less than three times the final
window's length. Opening a distant unclosed fence or HTML block can require the
entire remaining note. Multiple distant changes use one enclosing window.

Ordinary edits have a separate context-preserving path. The old parse must
place the edit inside a top-level paragraph whose first character is an ASCII
letter. Each edited line must still start with an ASCII letter, and neither its
old range nor its replacement can cross a line ending. These conditions prevent
a new flow opener or completion of a pending definition. The index then maps
cached positions without scanning the paragraph or invoking a parser. This also
covers long single paragraphs. Other edits use the exact section parser.
Position mapping visits the cached boundary, paragraph and fence entries;
its work therefore grows with the number of those entries in the note.

Validation passed: `npm run build` and 44 tests across
`html-result-index.test.ts`, `html-result-view.test.ts`,
`html-result-store.test.ts` and `html-results.test.ts`. The full suite is left to
the parent task's combined validation. Tests cover both reported examples at
creation, incremental replacement and reverse edits, including the production
CodeMirror field. Differential checks include 416 combinations of definitions,
containers and HTML syntax, 240 reversible structural edits, long paragraphs,
blank runs, indentation changes and distant unclosed containers. Results are
compared with full-document `htmlResultBlocks`, including source ranges.

The unchanged 52 KiB production-extension benchmark ran before and after this
follow-up. With one reference, start/before-reference/end edit medians changed
from 1.385/0.986/0.659 ms to 0.102/0.099/0.090 ms. Corresponding p95 values changed
from 9.447/1.511/4.158 ms to 0.446/0.157/0.106 ms. Without a reference, medians
remained 0.051–0.086 ms in the final run. These are same-host observations,
not fixed latency guarantees. Initial indexing with one reference takes a full
flow pass: the final run measured 130–203 ms, compared with 49–114 ms before.
Edits that cannot use the ordinary path inside a large indivisible block still
reparse that block. Native paint and mobile performance were not measured.

All new raw evidence is outside synced vaults, under
`/home/ubuntu/backups/send-to-t3-code/html-index-499645b/`: `reproduced.txt`,
`focused.txt`, `build.txt`, `before.json` and `after.json`. Earlier exploratory
runs in that directory remain available. No test notes, native fixtures,
accounts, delivery, release, installation, deployment or push were used.
`main.ts` is unchanged.
