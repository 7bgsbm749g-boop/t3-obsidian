# Independent QLO2 reply host and failed-send cleanup

The mobile plugin previously awaited a reply-owner registration before T3
dispatch. That owner ran inside the VPS Obsidian client. Closing the client
therefore blocked delivery even when T3 and its authenticated file API remained
available. A separate stale busy snapshot could also keep an open send window
disabled after an earlier request finished. Release 2.38.7 fixed the window,
but did not satisfy the requirement for independent reply processing.

The complete change moves QLO2 reply authority, response feeds, checked final
saves, staged reply commands, and failed-send cleanup into a Node background
service. It reuses InlineLeaseAuthority, CoordinatedHost, the existing private
generation journal, and HostedInlineWriter. Its filesystem adapter has no
Obsidian renderer or editor. It checks note identity and saved content before
an atomic write, syncs the replacement to disk, and verifies readback. Native
clients retain their existing projection and current-buffer merge behavior.

The desktop plugin yields its writer lock when the installed background-host
configuration identifies its vault. Desktop readers then use the private
mailbox rather than requiring a local renderer to dispatch its commands.
The service uses short-lived official local T3 sessions. Paired connection
credentials are supplied in a private file, outside Sync, for replies whose
T3 thread runs on another machine; managed connections can renew through the
saved T3 account. Tokens and note bodies are excluded from service startup logs.

The build compresses the standalone service into an identified payload in
main.js. The six-file immutable release package is unchanged. The supported
release command extracts those exact bytes into a versioned private runtime,
records their SHA-256, installs a user systemd unit, and enables automatic
startup and restart. The account already has systemd lingering enabled, so
closing Obsidian or the graphical session does not stop this service. The
official QLO2 Sync service remains responsible for file propagation.

Before a response boundary is inserted, a send guard records its exact vault,
note, response, thread, and message identities. Explicit failures retry checked
tag removal from that durable record. Prepared sends whose device disappears
are checked against T3 after the bounded dispatch period. An accepted message
is retained. An absent message is cleaned without dispatching a replacement.
Cleanup tombstones also remove stale or duplicated failed tags from later Sync
copies. Ordinary text, other response identities, and partial reply prose are
preserved. Missing confirmation is not treated as proof of failed delivery.

The background note-command path uses the same durable command UUID, saved
prompt, reply registration and T3 dispatch ledger. It requires the normal saved
folder route. It does not edit shared settings directly: accepted note/thread
links are published privately and adopted through the plugin's normal merged
settings save. A running desktop retains its native command interface; a
recent desktop presence record prevents simultaneous command handling.

Regression coverage uses real temporary files with no Obsidian application.
It checks final save, host restart, failed registration cleanup, stale Sync
copies, lost acknowledgement, accepted-message preservation, pre-insertion
guard failure, duplicate boundaries, and replay without a second send.
The extracted standalone bundle also starts under ordinary Node without an
Obsidian module. Release tests verify immutable extraction and installation
without changing data.json.

Production proof must retain a real T3 message and final save while the QLO2
desktop client is closed. Synthetic completion fixtures do not establish
native phone coverage; native iPhone/Android interaction remains a separate
verification boundary. Folder/event subscriptions retain their existing
desktop lifecycle and are outside this reply-host change.

## Retained production verification

Release 2.38.8 was built from commit
`6191a5d015fddd6926248c3a0a959524a10724d3`, passed 1,453 plugin tests and
16 release tests, and was installed by the supported immutable release
command. The fresh official Headless Sync scan finished. Both installations'
data.json files stayed byte-identical during installation. A guarded real
QLO2 reload reported loadedVersion 2.38.8; native screenshots show the same
send window changing from busy to available without reopening it.

With the QLO2 desktop process stopped, the normal note-command interface sent
gym/gym.md once to T3 thread `6ce8dc82-2d75-5d65-9ccd-508d98783cb7`, user
message `db6c0753-8991-5ea6-8097-ca593c832c1d`. Replaying the original command
UUID returned the same receipt; the thread retained exactly one user message
and one run. Restarting the service during that run recovered its reply state.
The gym task completed its four workout-note changes. Its optional question
remains open, so that accepted response stays tracked for a possible answer;
it is not a failed-send cleanup case. Its staged-note command also succeeded
with the desktop closed.

A separate bounded note completed in thread
`76662f38-3094-5064-a488-a53c9d423a5c` while the same desktop process remained
absent. The host verified its final save, recorded finalSaved and cleanupComplete,
and removed the response boundaries. The saved result was visible in the real
client after reopening it.

A synthetic two-destination send then failed after its first response boundary
was prepared, because the second note did not exist. No T3 thread was created.
The service was restarted before cleanup. After the 120-second preparation
grace period, its exact absent-message check removed the tags and preserved
ordinary text. Restoring the older tagged local file and restarting the host
again also removed those tags through the retained cleanup tombstone. This
last check is a stale-file replay, not a native mobile Sync test.

Temporary notes were removed, the original active note and disabled CLI setting
were restored, and QLO2 was closed again. The independent host and official
Sync service remain enabled and running. The Obsidian agent skill was updated
to document the supported background commands instead of treating a closed
VPS client as a send blocker.

Evidence is retained outside Sync under
`/home/ubuntu/backups/send-to-t3-code/send-window-busy-20261013T1909`.
The immutable release smoke receipt identifies its evidence hashes. Native
iPhone/Android interaction and the offline Windows client were not verified.
Release 2.38.8 supersedes the incomplete broader-scope 2.38.7 delivery.
