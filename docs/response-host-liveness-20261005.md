# Response authority liveness and safe historical catch-up

On October 5, the purchase response stopped at the checkpoint saved at
00:18:03.942 UTC (T3 sequence 194039). All authority replies stopped by
00:18:05.376; later checkpoints and both registration commands remained
unanswered. The command bridge still answered fresh `client-status`, the
response and command locks renewed, and native projection remained advertised.
A supported read-only `response-status` also succeeded, narrowing away from an
opening or shutdown drain as the leading live state.

The separate read-only diagnosis and patch investigation agree that one stalled
inline authority explains both symptoms. A replay of the retained inputs using
an in-memory write overlay acknowledged both registrations in 1,198 ms. The
saved inputs are valid. Historical diagnostics were disabled, and no verified
runtime inspection route was available. The initiating promise, operation and
stack remain unknown; a stuck mutation or another serialized task is still
possible. A read timeout is a recovery mechanism, not the established incident
trigger.

The patch bounds only authority reads and enumeration to two seconds and cancels
them when the host stops. Abandoned results cannot resume the old scan. Writes
and removals retain their full promises and serialization under the existing
host lock; uncertain mutations are never abandoned to admit another owner.
Fresh `client-status` now reports bounded operation metadata (operation, private
storage path, elapsed time, timeout count) and authority/opening state. It
includes no record contents, prompt, answer, note body or connection credentials,
and creates no diagnostic logs or background publication.

Exact-history recovery now retains the last applied checkpoint's session and
latest turn. New checkpoints can replay from that cursor. Older checkpoints
without this evidence still replay their original start, rather than invent an
active session. The initial recovery checkpoint and gap cursor are durably saved
before a canonical checkpoint advance or an interruptible replay. They survive
later snapshot replacements. Only actual protocol events augment historical bindings.
An oversized snapshot-only replay explicitly remains waiting, preserves the
response and never dispatches a prompt or borrows an unrelated turn.
An event replay that reaches synchronization without the required lifecycle also
remains waiting. A snapshot-head cursor retained by the initial 2.31.28 delivery
is safely rewound from the exact original start ID when its saved session belongs
to an unrelated turn. This restores the replay range without inventing evidence.

The original incident's available history (817 thread rows at 00:29:38) could
recover the original turn plus its two exact async answers, one steering that
turn and one starting a continuation. The diagnosis's synthetic reconstruction
recovers all six original and two continuation assistant messages and excludes
the later complaint. This is a reconstruction from retained metadata, not a
historical network or editor capture.

By the later authenticated probe, that range exceeded the server's 1,000-event
replay limit. Its replacement snapshot has only an unrelated latest turn, null
answer turn IDs and no old completion checkpoints for this non-Git project.
Transcript pagination does not restore those associations. The server exposes
no bounded historical event pages or per-turn lifecycle read through the current
supported API. This later limit did not cause the original freeze. Restoring the
host alone cannot prove completion of that original purchase response: it remains
an explicit upstream history prerequisite. No server changes or private database
recovery are included.

Regression coverage exercises the packaged host's lost read, acknowledgement of
the same immutable registration, exact replay, cancellation before ownership
reacquisition, late-result rejection, and retained slow mutation promises. Existing
command delivery tests retain one dispatch across retry/restart. Historical
recovery tests preserve exact bindings, session evidence, gap cursors, checked
completion and exclusion of unrelated work; snapshot fallback remains waiting.

Evidence is outside every vault:

- `/home/ubuntu/backups/send-to-t3-code/investigations/2026-10-05-newgame-stale-stream`
  contains the read-only baseline, incident timeline, verified journal metadata,
  authenticated replay limits and synthetic history reconstructions.
- `/home/ubuntu/backups/send-to-t3-code/investigations/2026-10-05-response-registration`
  contains preserved failed command bytes in private storage, allowlisted
  snapshots, read-only response status, regression logs and release/live evidence.

The failed original command is never retried by this job. Its queued registration
may be acknowledged after recovery, but registration itself does not dispatch
its saved prompt. Preserve its immutable failure result and the purchase note.
No purchase, KeePass unlock or other purchase-workflow action is authorized here.
Native mobile and desktop core Sync coverage remain separate from the VPS's
real desktop and official Headless Sync validation.

Live verification on the final 2.31.29 release acknowledged synthetic command
`d678f292-c368-43c4-8740-9609021ba3fa`, with thread
`42a35d62-854d-5e35-8b89-120dcae7d0ca`, user message
`332f6697-6822-5c7d-b6e1-b5dbe6a16914` and binding
`cbcdceb6-2491-53e1-b60a-25092d71443c`. The actual editing pane displayed BEGIN
and MIDDLE output. Its guarded mid-response `app:reload` changed the loaded
client instance, and the same response caught up and completed. Canonical history
contains one source/user message, three assistant messages and one final token.
Replaying the immutable command returned its identical result. Lease completion,
cleanup, materialization hash, saved note hash and the native Completed view agree.
The final suite passed 759 TypeScript tests and 11 Python tests. Source commits
are `9e134c9` (authority) and `8c34b1d` (durable cursor correction).

The purchase recovered all six original assistant messages but remains explicitly
waiting for two exact answer bindings. Its recovery cursor is 193710 and its note
remains the original 205 bytes and SHA-256 `4a93d9706d5568f4c8314414acfa1d4656823ef3a492aeee6550980dc4dac3bb`.
The original failed command/result bytes remain unchanged, and an authenticated
lookup confirms its proposed thread was never dispatched.

An initial synthetic preview-to-editing transition exposed a separate stale
native pane conflict. The reload guard refused to proceed; closing only that
synthetic pane followed by a guarded reload recovered its same response without
resending. This authority patch does not change native mode switching. Subsequent
stable editing-pane sends, streaming and guarded mid-response reloads passed.
