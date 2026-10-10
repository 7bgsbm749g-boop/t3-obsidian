# Silent T3 file connections and recovery

## Confirmed observations

The laptop send failures on 2026-10-10 occurred during response registration,
before prompt dispatch. Each file request waited 15 seconds. Failed-response
cleanup then waited about 30 seconds. The old file connection remained cached
because the browser had not reported a close or error. Reloading Obsidian created
a fresh connection, and the user confirmed that the next send succeeded.

Fresh authenticated relay reads took less than a second in the investigation.
The evidence supports a stale silent socket. It does not identify the original
network event that made that socket silent. Sleep, network changes, and relay
interruptions are possible triggers, but none was established from these logs.

The plugin answered incoming `Ping` frames but never initiated a health probe.
The T3 Effect RPC server answers a client `Ping` with `Pong`; it does not initiate
that exchange for this client. A request deadline did not invalidate the socket.
These two defects let later attempts reuse a connection that could not reply.

## Recovery behavior

`connectT3Rpc` sends `Ping` after five seconds without a valid reply and waits
three seconds for `Pong` or a matching RPC result. Silence closes the socket and
rejects pending requests with a confirmed connection error. A suspended client
checks an idle connection before sending the next file operation. All concurrent
requests share one probe. Timers and pending work are cleared on close.

The existing 15-second request deadline remains for a slow operation on a
responding transport. It first checks connection health. Such an operation gets
an ordinary request timeout; it does not close a healthy shared connection.

The response manager replaces a closed connection. Read-only file operations
can retry once on that fresh connection. Uncertain writes and prompt dispatches
are never automatically repeated. Existing immutable command and message
identities remain in use.

The desktop fallback requires confirmed failures on two distinct connections
to the same host within 60 seconds. Multiple requests failing on one connection
count as one incident. It uses the normal guarded native **Reload app without
saving** command and waits for saved Markdown/code editors, final-save recovery,
no active send or modal, and the exact running runtime files. A successful host
read cancels the pending fallback. The reload decision is saved before dispatch;
one reload is allowed per outage, with a five-minute minimum between reloads
once the host recovers. State stays device-local and is not written to synced
plugin settings. Mobile gets transport recovery without an app reload.

## Verification

Regression tests cover silent sockets, real health responses, slow healthy
requests, shared probes, concurrent reads, uncertain writes, recovery cancellation,
unsaved edits, changed runtime files, and reload limits across app instances.
Failure records include method, connection ID, elapsed time, pending count and
last-reply age, without storing prompts or credentials.

The read-only `validation/connection-health-live.ts` check uses a short-lived
scoped session against the actual relay and revokes it in a finally block. It
confirms the server responds to Ping, drops incoming frames on its test socket,
and checks confirmed closure followed by a successful fresh read.

The synthetic real-Sync lab uses the actual plugin in two independent Obsidian
desktops. Its test-only observer can leave one or every file socket OPEN while
dropping its outgoing frames. A single silent connection recovered and delivered
one bounded prompt without restarting the app. Repeated silent connections
caused a guarded native reload; the new client then recovered. The exact reply
reached both saved notes and both visible editors through official Headless Sync.
Private records and screenshots are retained outside the vault under
`/home/ubuntu/backups/send-to-t3-code/connection-recovery-20261010`.

This proves real relay RPC, desktop recovery, file propagation, and visible
editor adoption. It does not establish the desktop core Sync engine or native
Android/iPhone behavior. Windows receives the immutable release through the
existing Sync and guarded laptop reload path; the two-client fault test runs on
Linux desktop clients.
