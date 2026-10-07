# Bottom activity indicator — QLO2 2.34.12

The current activity row now sits at the bottom inside the progress callout.
It shares the text size of earlier tool summaries. The plain fallback row says
**Thinking** and has a brain icon. The top **Working** status is unchanged.
Tool labels, spinners, dropdown results and retained open choices use the existing
logic. Stop also removes the plain row from its new quoted position.

Reviewed source commit: `5efa197022862c3b6446b266eddec9c37eb429c1`.
The change builds on the completed TypeScript release, 2.34.11. It includes no
additional language-view implementation.

## Validation

The final build and full suite passed: 969 TypeScript tests and 11 Python tests.
The release command repeated the build and full suite successfully. Both runs
were serialized with `taskset -c 0`. The supported release command installed the
immutable 2.34.12 archive into both vaults, preserved each installation's
`data.json` during installation, and completed a fresh official Sync scan.

The real VPS QLO2 client received a checked **Reload app without saving** and
loaded 2.34.12. Native Live Preview and Reading view tests used a small synthetic
note, without dispatching external work. Native DOM checks and screenshots show:

- The active tool row belongs to the progress callout. Its label and earlier
  tool summaries both measure 14 px under the client's current theme.
- An open tool dropdown stays open through a result update. Its live label stays
  present-tense while its completed result shows the command, exit code and output.
- The plain bottom row says **Thinking**, renders the brain SVG and spinner, and
  keeps the top **Working** header.
- The stopped fixture removes the live row. Completion closes the history and
  leaves the final answer and following note content outside the box.

The synthetic note was removed. All 19 original Markdown leaf states and the
original active leaf were restored. The 11 physical note preimages stayed
byte-identical. CLI is off, Settings is closed, and the global configuration is
byte-identical to its preimage. Unrelated user changes to response preferences,
note-thread records and codebase references were retained.

## Retained runtime evidence

The native filesystem queue stalled after reload. A bounded adapter probe
retained the pending read. After exact editor/disk comparisons, note preimage
backups and checks for pending saves and host mutations, one call to Obsidian's
built-in `app.vault.adapter.kill()` released it. The retained read then completed
with exact bytes. No native prototype was patched and no configuration file was
overwritten. This setup recovery does not establish a native queue product fix.

A final read-only mailbox `client-status` request timed out. Its pending request
result is retained in `client-final.json`. The loaded version and instance were
established after reload, and the native test context remained active through
cleanup. This timeout did not supply smoke evidence.

Evidence root:
`/home/ubuntu/backups/send-to-t3-code/indicator-layout-20261006T2343Z`.

Complete immutable smoke receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.34.12/smoke-vps-qlo2-indicator.json`.

Archived evidence:
`/home/ubuntu/backups/send-to-t3-code/releases/2.34.12/smoke-vps-qlo2-indicator-evidence.json`.

This proves the tested VPS native desktop behavior. It does not prove native
mobile or Windows rendering. The release tool's laptop reload request was
pending when packaging completed.
