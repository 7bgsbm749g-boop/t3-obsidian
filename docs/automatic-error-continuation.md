# Automatic continuation after a failed response

An attached response that ends in an error now follows the immediately next
user run in the same T3 thread. No manual `Attach latest T3 continuation`
action is needed. The original response anchor, prompt binding and earlier
output stay together. The incoming user prompt appears in the transcript.
Repeated failed retries can continue the same response until a run completes.

The chain requires consecutive canonical run ordinals, the exact primary user
message, user attribution from the web or mobile app, and a request after the failed run ended.
Queued work waits until it starts. Missing inputs, ambiguous ordinals, agent
messages and delegated completion messages do not join. Completed, stopped,
removed and conflicting responses retain their existing boundaries. This
does not enable following all future turns after a successful response.

Compact checkpoints retain the proven run/message links. Canonical history
can reconstruct them after reload. The original note binding stays stable,
and final saving verifies the continuation's exact persisted final item.
A refresh that sees an anchor removed by an in-flight final save waits for
that save to finish before it reports success or a changed-note result.

The shared rule is in `failed-continuation.ts`; both the current native preview
and retained local response manager use it. Unit coverage includes event
ordering, repeated retries, provenance, checkpoint recovery, removal, exact
final verification and legacy local reloads.

Build the isolated native check with:

```sh
node scripts/build-native-response-lab.mjs evidence/TASK --auto-continuation
```

Launch the returned profile through Cua. This sends a bounded real T3 source
run and a real user continuation. The earlier failure is replayed only in the
isolated reader; server records are unchanged. The fixture verifies automatic
attachment, saved note text and visible editor output, and captures evidence
outside the vault. After inspecting the screenshot, create `finish-test.json`
at the lab root. Cleanup stops any remaining test work, deletes its exact T3
thread through native controls, and deletes test notes through Obsidian's
vault API. Check `CLEANUP.json` before recording smoke completion.

This test creates no QLO2 content and does not prove Sync or native mobile
behavior.
