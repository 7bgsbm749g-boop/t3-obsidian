# Codebase explorer performance review

The original 2.33.0 tree cleared its DOM on each refresh, serialized folder requests, fetched the full T3 catalog and opened a socket per call, and inserted file records with a quadratic scan. The revised tree retains keyed native explorer rows. Device-local name snapshots and expansion state restore before network work; clean text and preview URLs remain memory-only. The transport pools authenticated access and RPC, coalesces catalogs, bounds waits, and verifies current roots before writes.

A separate review agent ran repeatable before/after CPU and synthetic-transport benchmarks on this VPS. Evidence is outside the vault under `/home/ubuntu/backups/send-to-t3-code/live-smoke/codebase-quality-20261006/`. The original bundle and benchmark script are retained, together with final measured results. These numbers are not end-to-end UI paint measurements.

| Workload | Before | After |
| --- | ---: | ---: |
| Register 2,000 file identities | 5,103 ms | 20–49 ms |
| Refresh 36 expanded folders, synthetic 10 ms round trip | 371 ms | 113–140 ms |
| Existing rows retained during refresh | 0 | All 36 |
| Cached 3,000-file tree refresh, p95 | No cache | 6.56–11.63 ms |
| Folder requests during cached refresh | 36 per refresh | 0 |

A read-only real local T3 test listed 124 root entries 21 times. The first authenticated connection/catalog/socket/list took 1,887 ms. The 20 subsequent network listings had a median of 46.2 ms, p95 of 159.7 ms, and maximum of 220.2 ms. Cache display does not wait for authentication. Initial remote connection speed still depends on the machine/network and is not represented by cached refresh timing.

The table includes the initial review and the repeat after native recent-file labels and the performance report were added. The final 3,000-file run remained below the 16 ms synchronous warm-render target. Measurements vary with other VPS work; no number in this table includes screen paint.

Use **T3 Code: Copy Codebase performance report** to copy current measurements. This command reads bounded memory only, without a refresh, file enumeration, logging or a new timer. It exports numeric counts and median/p95/maximum durations for fixed operation names. Render/reveal values are synchronous CPU time; transport values include the network wait. It contains no note text, file names, paths, project/machine identities, URLs, errors or credentials. Each operation retains its own bounded sample set.

Automated regression checks cover deferred/offline cached display, duplicate requests, a concurrency limit of four, oldest-snapshot eviction, late socket/cache disposal, retained row identity/scroll/focus, deep expansion restoration, native keyboard behavior, fresh save checks, two editor leaves, prior-root save blocking, and legacy draft/choice migration. The isolated real Obsidian lab checks native Markdown/code autosave, image/embed/PDF views, two-tab refresh, conflict review and a second edit after review, plus unchanged physical vault enumeration. Full QLO2 release evidence must additionally include fresh Sync, an exact-byte client reload, actual sidebar browsing, and immutable smoke records.

The implementation uses Obsidian's native explorer classes and icons, normal Markdown names, native selection and tree keyboard controls. It keeps project names in the native editor path header. Native iPhone/Android behavior remains untested on this VPS.

The native Quick Switcher keeps its original suggestion objects and open actions. A guarded render adapter replaces opaque recent-file labels with the normal filename and a project/folder detail. A registry-only native file-open adapter prepares media and opens external code in the normal Markdown source editor, preserving native view state, active/group and ephemeral flags. Neither adapter adds project files to physical vault enumeration or registers code extensions globally.
