# Response records in plugin data

New replies save only the existing hidden native response container and its ID
in the Markdown note. The plugin's standard `data.json` has a `responseBindings`
map keyed by that ID. Streaming, canonical final verification, recovery copies,
Stop and final note writes still run in the Obsidian plugin. The separate reply
service remains disabled. No remote registration or writer grant was added.

Each record has a logical revision and device actor for deterministic merging.
Independent response IDs are retained when devices receive settings in a
different order or a whole settings file is replaced. A device-local replica
preserves records across a stale settings replacement and restart. The existing
shared-settings save and external-change paths publish the merged records.
Received stream prose, final bodies and old host checkpoints are excluded from
shared records. Initial user input, steering inputs, formatting choices and
checked staging hashes remain where needed to reproduce the same result.
Streaming events do not write shared settings.

A loaded note reconnects when its exact empty anchor and settings record are
both available. Either may arrive first. The manager caches unchanged loaded
notes and indexes records by response ID. It does not scan closed notes or
retained legacy records each tick. A stale anchor can recover using its retained
routing record. Completion does not immediately erase that routing information.

For an old `t3-response-binding` comment, the plugin stores the settings record
first. Only a valid descriptor beside its exact unique empty anchor is removed.
Failed metadata storage leaves the note unchanged. Unrelated text and literal
code examples remain intact. Legacy metadata stays hidden during migration;
the existing editor extension also hides the newer small run-import receipt.
Checked staged inputs from older notes are normalized only after hash and
anchor validation, preserving their original immutable files.

Final storage retains the native note compare-and-set and Sync gate. It also
checks that the settings record did not change while final output was prepared.
Staged-edit publication uses the same device-local note save boundary. This does
not create a global lock or an exactly-once guarantee across devices.

## Sync requirement

Every participating device must sync community-plugin data and use a shared
configuration profile. Other sync services must include this plugin's data.json.
A setup that syncs only Markdown notes cannot transfer these out-of-note records.
Arbitrary additional JSON files in the plugin directory are not synced by the
inspected desktop 1.14.4 and Headless 0.0.14 filters. No second plugin settings
file or configuration-root workaround is used.

## Verification

Tests cover independent records, concurrent saves, stale settings replacement,
reload, both note/settings arrival orders, migration storage failure, changed
metadata during final-save preparation, native final adoption, steering, and
checked staging. The synthetic real-Sync fixture transfers actual plugin
`data.json` files through two independent Headless Sync clients, replays the
actual manager, and restores the lab configuration. That fixture does not prove
native mobile behavior or live editor adoption. Real QLO2 editor evidence is
recorded separately in the immutable release smoke receipt.

Real Sync evidence: `/home/ubuntu/backups/send-to-t3-code/sync-test-lab/20261015T034008Z-binding-data-969e244629ba/result.json`.
