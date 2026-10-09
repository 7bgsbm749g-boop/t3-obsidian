# Orchestrator v2 compatibility

The plugin uses orchestration protocol 2, as shipped in T3
`v0.0.46-nightly.20261008.2849`. The source contracts inspected for this upgrade
are in [T3's repository](https://github.com/pingdotgg/t3code/tree/v0.0.46-nightly.20261008.2849/packages/contracts/src).
Every destination must run v2. An incompatible descriptor fails before a send.

## Transport and commands

`orchestration-v2.ts` adapts T3's wire records to the plugin's existing response
model. Its historical `turnId` field now contains an **app run ID**. A provider
turn or child node cannot complete the parent response.

`t3-api.ts` is the shared desktop and direct transport boundary. Old command
names remain in durable plugin receipts so existing requests can be read. They
are converted at the boundary, and never sent to the removed HTTP dispatch API.

| Plugin operation | V2 wire operation |
| --- | --- |
| Authenticated HTTP reads | `x-t3-orchestration-protocol: 2` |
| Authenticated websocket | `orchestrationProtocol=2` |
| Thread creation | `orchestration.dispatchCommand`, `thread.create`, creation provenance |
| Send or continue | `message.dispatch`, stable message/command IDs, `deliveryIntent: auto` |
| Stop | `run.interrupt`, app run ID, `holdQueue: true` |
| Answer or approve | `runtime-request.respond`, exact runtime request ID |
| Project create/update/delete | `POST /api/projects/mutate` |
| Recent thread read | `/threads/:id/bounded` |
| Full recovery | Opaque `/threads/:id/history?cursor=...` pages |
| Embedded images | `assets.persistChatAttachments`, then stored asset metadata |

The server chooses steering or queueing against its serialized current state.
Message delivery does not override an existing thread's permissions or mode.
Image context records keep their context IDs and use the returned stored asset
IDs. Saved commands remain immutable across upload and dispatch retries.

Flat snapshots contain a projection. Event sequence numbers are outside the
domain event. `message.updated` contains the full current text, so it replaces
text instead of appending it. Unknown events still advance the cursor. Questions
and approvals join turn items to runtime request capabilities; an unavailable
or closed capability produces no active control.

Tool output omitted by T3's timeline is read with `orchestration.getTurnItem` by
exact item revision. Recent detail reads are bounded to 40 items and a
256-entry cache. A failed detail read retains the reply and reports unavailable
output rather than blocking response recovery.

## Migration and recovery

T3 preserves v1 transcript IDs but does not copy provider runs, runtime controls,
or v1 command receipts. The plugin resets the saved v1 event watermark when it
receives a v2 snapshot. Unfinished response bindings whose messages were imported
are marked interrupted; they do not resume or attach to a new app run. Saved
completed runs and their exact final message IDs remain valid. New
messages can continue the migrated thread. Old responses without a preserved
exact run association cannot be imported as a verified run.

A saved v1 send with an uncertain acknowledgement checks its preserved message
ID in the migrated transcript, including history pages, before any resend. An
existing matching message is acknowledged locally. An ID with different text
fails. New v2 retries retain their IDs and use T3's v2 command receipt.

Full history recovery keeps the initial snapshot watermark. A newer history
page cannot skip live events committed while the pages are being fetched.
Existing same-protocol protections against older snapshots remain active.

## Validation

Run `npm run build` and `npm test`. `tests/orchestration-v2.test.ts` covers the
wire boundary, full text updates, app/child lifetimes, queued runs, controls in
either arrival order, closed requests, v1 recovery, image ID mapping, opaque
history paging, protocol rejection, and tool detail caching. Existing desktop
and mobile bundle tests exercise routing, note sends, questions, approvals,
Stop, recovery, subscriptions, code views, and storage.

The bounded local server check is:

```sh
npx tsx validation/orchestration-v2-live.ts /path/outside/vault/live-api.json
```

It creates one synthetic thread in the canonical plugin project and verifies
RPC delivery, authenticated streaming, canonical HTTP reads, exact app run
binding, and a terminal reply. Its temporary CLI credential is revoked and
never written to evidence. It also verifies a real image upload, a second reply
in the same thread, and Stop against a new app run.

A release still requires a real QLO2 client reload, a bounded plugin delivery,
completed response evidence, and the release tool's `--complete-smoke` receipt.
Desktop tests of the mobile bundle are not native Android or iPhone tests.
