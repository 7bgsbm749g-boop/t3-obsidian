# Worktree handoffs keep their response

Moving a T3 thread to a worktree interrupts its original app run and queues a
continuation in the same thread. The note previously saved that interruption
as its final response, although the T3 conversation continued.

The response now follows a verified chain of app runs. The current installed
T3 v2 API does not expose a dedicated worktree parent-run field. Its canonical
handoff tool item identifies the source run and exact continuation prompt.
The continuation has a server-reserved message ID and agent/MCP attribution.
The adapter joins these records only when the prompt SHA-256 matches, the
message falls inside the tool's recorded execution interval, and there is one
candidate. A successful scheduled handoff can add its replacement run.
If workspace detachment interrupts the handoff tool before its result is saved,
the same machine attribution, namespace and exact prompt digest can prove the
continuation. This fallback also requires the interrupted source's recorded end,
the immediately next run ordinal, its exact input message, and a run request
inside the handoff/source execution interval. The message can finish projection
after detachment. A later handoff attempt excludes an earlier attempt's match.
Explicit failed/cancelled tools or failed dispatch results cannot use this fallback.
An ordinary user message, another agent message, ambiguous matches, or an
unrelated latest run does not establish ownership.

Snapshots, paged history, and live events retain that evidence. Compact binding
checkpoints retain IDs and a digest, without copying the continuation prompt.
Omitted tool output cannot downgrade an observed result. Canonical hydration
also loads older handoff results outside the ordinary recent-tool window.
After reload, canonical history can reconstruct the same chain, including an
already completed replacement. Existing stopped, removed, and final-save guards
remain authoritative.

Before sealing an interruption, the preview checks fresh canonical history so
an interrupt event cannot win a race against its handoff result. It shows
**Moving to worktree** while the handoff or its exact replacement is pending.
The existing response anchor, start time, and earlier output stay together.
Final saving still requires the last run's exact persisted final item. A failed
handoff after the original run stops shows an error and keeps its output.
Oversized recovery reads show the existing error instead of repeatedly loading
the same oversized history.

Stop resolves the current linked run. It cancels a queued continuation through
T3's `queued-run.cancel` command, rechecks concurrent startup, and interrupts
that exact run if it has started. An unresolved continuation is reported as an
unconfirmed stop, never silently acknowledged or replaced with an unrelated run.

Unit checks cover event order, provenance and prompt mismatches, ambiguous
messages, queue/start races, failed and skipped handoffs, successful retries,
checkpoint recovery, and exact final-item verification. A bounded real test in
Sync Test A moved one conversation to a worktree, displayed the resumed progress
inside its original response, and saved `HANDOFF_STREAM_READY`. After native
reload, a fresh attachment to the original interrupted run recovered the final
replacement answer. A fresh real Sync scan delivered the saved result to Sync
Test B, where the desktop editor displayed it. Screenshots, saved response hashes,
and checks are retained outside synced vaults under
`/home/ubuntu/backups/send-to-t3-code/worktree-continuation-20261020-8f4fc5d8`.

The real test used Obsidian desktop and official Headless Sync. It did not test
the desktop core Sync engine or native iPhone/Android execution. QLO2 release
verification creates no synthetic notes or other test content.

The existing synthetic preparation helper accepts `--refresh` to install the
reviewed runtime in the prepared lab while checking that both settings files
remain unchanged. Reload the clients after refresh; `--restore` retains its
original plugin/settings restoration behavior.

For an isolated real handoff check, build a new private lab with
`node scripts/build-native-response-lab.mjs evidence/TASK --worktree`. Register
a dedicated synthetic Git project beneath that lab and put its `projectId` in
`TEST-CONFIG.json` at the lab root. Launch the returned profile through Cua.
The isolated reader discards the handoff tool's success result while preserving
the real server messages, runs and timestamps. Server records stay unchanged.
The fixture imports the original response, follows its real worktree move, and
records saved-file, editor, canonical-history and screenshot evidence. If the
desktop capture is stale, launch this test profile with `--disable-gpu` and
`--disable-renderer-backgrounding`. After
visual inspection, create `finish-test.json` at the lab root. The fixture deletes
its exact T3 thread and all test notes through the normal application APIs and
records `CLEANUP.json`. This check uses no QLO2 fixtures or Obsidian Sync.
