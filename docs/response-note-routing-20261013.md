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
