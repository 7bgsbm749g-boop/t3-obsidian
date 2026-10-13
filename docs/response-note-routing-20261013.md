# Response routing after a note rename

The reported chooser warning was caused by stale routing metadata, not a
response in a different note. Response `eaaff610-e91f-5fb0-a4e0-caa079a8f68f`
was saved in `coding/projects/T3 CODE x OBSIDIAN/Tracing the “Missing 3” Dialog
and Reply Binding.md`, while its private lease and route index still named
`coding/projects/T3 CODE x OBSIDIAN/Untitled 1.md`. The old file was absent.

The chooser previously compared the current note path with the retained host
path and rejected any mismatch. A rename from another device could reach the
note before the host route, making a valid conversation unavailable.

The chooser now verifies the exact response boundary in the current note,
checks the old destination for a duplicate of that response, and checks the
local note locator. Opening the chooser does not change the host record or
dispatch a prompt. An idle conversation continues in its original thread
without relocating the completed response.

For an active response, the send path repeats the location checks, verifies
the original thread and active turn, and repairs the host destination through
the existing authenticated `relocate` command before reserving steering input.
The command retains a stable identity for the observed record and path pair.
The immutable request keeps its original path. The host rejects an intervening
move or a stopped response. Removing the local response boundary or retaining
a duplicate at the old path prevents dispatch.

Regression coverage in `tests/chat-delivery.test.ts` exercises stale leases
and route indexes for active and idle threads, duplicate response boundaries,
reuse of an old filename by an unrelated note, and an empty native response
container addressed by its explicit response ID. The native test uses the
explicit response action because an empty saved container has no displayed
working header from which to infer a running target.

Build and test logs, the initial live route observations, recovery command
results, and live editor evidence are retained outside the synced vault under
`/home/ubuntu/backups/send-to-t3-code/response-note-routing-20261013`.

## Released verification

The reviewed source commit is `334dd01ed852e53797036bc95ceab2b49ff6ba2e`.
Release 2.38.2 passed the build, all 1,424 TypeScript tests and 14 Python tests,
installation into both vaults, and the fresh QLO2 Sync scan. Tests ran with
`taskset -c 0` after concurrent full-suite execution caused temporary resource
pressure. The release preserved each installation's `data.json`.

The real VPS QLO2 client loaded 2.38.2. A synthetic note was sent through the
plugin command interface and renamed from `Untitled.md` to
`T3 Routing Smoke Test Annotation.md`. Its follow-up message
`47aa09c5-9b53-5ccd-85ee-ab8b2e9608ae` stayed in the original thread
`f018340e-b2ce-52a5-9c0d-7dbd247160bd`. Both response bindings completed with
their final replies saved and cleanup complete. The final follow-up reply was
`ROUTING_SMOKE_FINAL_OK`. The initial bounded timer had expired while native
GUI control was unavailable; the later follow-up completed as a second run in
the same thread.

The native editor displayed that final reply. Opening the destination chooser
showed the original thread `f018340e` and an enabled **Continue thread** button.
The chooser was cancelled without another dispatch. The user's original note
and tab were restored, settings were preserved, and the synthetic note was
backed up outside the vault before removal. Cold stale-route and duplicate
response cases are covered by the bundled harness; the live test establishes
normal rename delivery and the actual destination chooser.

The immutable routing smoke receipt has status `complete`:
`/home/ubuntu/backups/send-to-t3-code/releases/2.38.2/smoke-vps-qlo2-routing.json`.
Its copied evidence contains hashes of the test logs, T3 message evidence,
saved note backup, and native screenshots. The installed runtime hashes match
the immutable 2.38.2 archive. This live evidence covers the VPS native client.
Windows loaded-client confirmation remains pending, and no native mobile
validation was performed.
