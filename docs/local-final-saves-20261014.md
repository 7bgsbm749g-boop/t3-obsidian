# Local response streaming and final saves

New bindings use the Obsidian plugin as the T3 client. The saved note contains
an empty hidden response container and ID. The routing record is stored in the
plugin data.json responseBindings map; see [response binding data](response-binding-data-20261015.md). Credentials and
intermediate stream text do not enter that record. Each loaded device can
subscribe to the exact T3 message and turn. It does not register a remote writer.

After the exact completed assistant item is checked, the plugin retains a local
recovery copy and replaces the current block with the final
Markdown. It reads the latest native saved projection, retains ordinary edits,
checks all native panes, and uses the existing atomic compare-and-set write.
A missing block ends the attachment. A stale block that returns can receive the
same result again; this is idempotent recovery, not a global once-only lock.

Core Obsidian Sync must report `synced` before an automatic final save. This
uses the inspected internal `getStatus()` API. Disabled core Sync and other
file-sync transports use the local checked save; those transports have no
common freshness API. The status check does not serialize different devices.
Identical final note contents use Obsidian Sync's hash and text equality guards.
Different full-note contents still use its normal merge or conflict-file policy.

Stop saves the frozen local text as a user action and sends a bounded interrupt
for the exact T3 turn. Display completion, final note storage, and T3 interrupt
acknowledgement remain separate facts. Existing reply controls, question events,
attachments, mirrored destinations, selection consumption, and thread settling
retain their plugin paths.

Agent staging runs in the desktop plugin's existing command endpoint. It writes
an original and editable staging copy outside the vault, checks their hashes and
unchanged response identities, and publishes immutable inputs through the
existing T3 file transport. Their hashes are in the shared settings record. A completing
device merges those inputs with the latest note and commits them with the reply.
This optional feature needs that desktop command endpoint, not a new daemon.

The build no longer embeds or builds a standalone response-host runtime. The
release command disables the old installed service. Immutable old runtimes,
receipts, private response records, and user settings are retained. Loaded existing native bindings migrate from their old private routing records
to local settings records. In-flight older writes retain their compatibility path.

## Evidence

The real synthetic Headless Sync test propagated a saved reference from A to B,
then saved identical outputs independently in both clients. Both converged to
one answer. It used the actual LocalResponseManager with synthetic verified T3
completion, not a live model. Logs and the result are retained outside the vault:

`/home/ubuntu/backups/send-to-t3-code/sync-test-lab/20261014T042727Z-local-final-8b57be37/result.json`

This proves remote file propagation for that case. It does not prove desktop
core Sync runtime behavior, live editor adoption, or native iPhone/Android use.
The lab runbook is [obsidian-sync-test-lab.md](obsidian-sync-test-lab.md).

The installed desktop 1.14.4 and Headless 0.0.14 equality checks were inspected:

`/home/ubuntu/backups/send-to-t3-code/sync-identical-write-inspection-20261014T021152Z/findings.md`

Focused tests cover a fresh device, independent identical saves, Sync waiting,
closed notes, canonical verification, current ordinary edits, racing writes,
incoming final adoption without a host proof, frozen Stop output, recovery after
reload, stale block recovery, and checked agent staging.

QLO2 release and native client smoke evidence are recorded in the immutable
release receipt. Native mobile testing remains a separate verification step.

The pre-release build passed 1,467 plugin tests and 17 release tests. Existing
uncommitted user edits were backed up and excluded from the release commit.
