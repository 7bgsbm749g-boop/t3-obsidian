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
