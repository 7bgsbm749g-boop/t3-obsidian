# Public thought groups in the Obsidian stream

The direct preview used an assistant-only prose merge as its complete display
state. This discarded public reasoning messages before the existing Thought
renderer could see them. The display now also retains bound non-assistant
messages. Prose retention, steering and final-answer verification still select
assistant messages independently.

Adjacent public summaries share one default-closed native Thought callout.
Its brain icon, count, client-local timestamp and formatted content follow the
provided reference. Prose, user input, tools, other public display items and
run changes separate groups. Canonical reasoning ordinals disambiguate tools
and thoughts with matching timestamps. The first summary identifies a group
through streamed replacements. Pointer and keyboard changes retain a separate
fold choice in each pane, including native redraws of the outer history.

Regression coverage exercises the actual direct preview, snapshot and event
updates, unrelated runs, grouping boundaries, tied timestamps and existing
completion behavior. The focused run passed all 55 tests.

Prepare the native replay with:

```sh
node scripts/build-native-response-lab.mjs NEW_PRIVATE_EVIDENCE_DIRECTORY --thoughts
```

The retained real-editor run at
`/home/ubuntu/backups/send-to-t3-code/thought-groups-20261024-native-4/`
passed all nine checks in Live Preview and Reading view. It captured closed
and open screenshots, verified the brain icon and timestamp, used pointer and
keyboard input, retained independent fold choices as the count grew, preserved
saved note text, split groups at commentary, and kept the completed final
answer outside the closed history. All changed behavior inputs match that
run's source hashes.

`CLEANUP.json` records no remaining notes and no temporary threads. Earlier
diagnostic runs also removed their fixture notes. The replay uses a separate
unsynced vault and dispatches no T3 work. No QLO2 test content was created.
These checks establish VPS desktop behavior; native iPhone and Android were
not tested. Release completion separately requires QLO2 installation, a fresh
Sync scan and the real loaded-client check through the release queue.
