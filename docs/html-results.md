# HTML result integration

Completed T3 `html_render` dynamic-tool items become `response.html` activities.
Their small attachment references survive bounded snapshots and binding recovery.
They are not ordinary tool history, so folding or removing intermediate output
cannot discard a page. The final note keeps a `t3-html` fenced reference. HTML
bytes, credentials and signed URLs never enter that reference or plugin settings.
No T3 backend changes or browser process per note are required.

## Verification and storage

`HtmlResultStore` first checks its device-local cache. A cache fill reads the
canonical item by exact thread, run, item and revision, requires a successful
`html_render` result with the same attachment, then calls `assets.createUrl`.
Only a current signed `/api/assets/` URL on that verified environment is accepted.
Downloads require HTML MIME, valid UTF-8, nonempty bytes and the 25 MiB page limit.
Every retained cache entry carries its source identity and a SHA-256 checksum.

Cache bytes live in the existing IndexedDB devices store, scoped to the vault.
The persistent index retains up to 64 pages and 100 MiB. Old payloads are released
when that budget is exceeded. Warm text has a separate eight-page/32-million-
character limit, and concurrent requests for one result share a fill. Unload
closes frames and object URLs and prevents late downloads from publishing bytes.
Attachment downloads do not delay final reply saves.

Offline playback means a cached, self-contained page remains interactive without
T3. It does not include uncached remote libraries, fonts, images or live APIs.
Each device must fetch a page before offline use; Obsidian Sync carries the small
note reference, not this cache. Eviction, missing bytes or unavailable connections
produce a Retry placeholder. No vault attachment directory is created.

## Native presentation

Reading mode uses a registered Markdown code-block processor. Live Preview uses
direct CodeMirror block decorations and atomic ranges. The source fence stays
visible in Source mode. Widget identities survive ordinary edits and streaming
updates; ordinary surrounding typing maps existing decorations without parsing
the whole note again. Each viewer uses its own owner document, including popouts.

The viewer loads the prepared T3 document from a local blob URL in an iframe with
`sandbox="allow-scripts allow-forms"`. It never allows same-origin access.
The parent recognizes only size, theme, bounded Escape, and HTTP(S) link messages.
Link and Escape requests must come from that exact focused frame while the host
has user activation. No plugin or Node API is exposed. A local content policy
excludes file and Obsidian protocols. The original HTML remains cached unchanged;
the render copy adds this policy and Escape handling.

T3's existing bootstrap receives the Obsidian theme before first paint through
the `t3-theme` fragment, then follows CSS changes through its normal host-context
messages. T3 role variables map to native Obsidian colors and fonts. Width and
reported content height use T3's fit/cap rule, bounded to 80–2000 CSS pixels.
The Expand action opens an Obsidian modal with zoom. Inline controls appear on
hover, focus and touch. Authored HTML, scripts, SVG, canvas and page controls stay
inside the isolated document; general assistant HTML remains escaped.

## Validation

Run `npm run build` and `npm test`. Dedicated tests cover provider result
envelopes and error flags, malformed references, literal examples, snapshot/event
deduplication, bounded recovery, result retention outside folds, frame sizing,
exact source verification, path normalization, cache corruption, concurrent fills,
offline reopen and cache retirement. The asset adapter has a focused RPC check.

Build an isolated real-client fixture outside all source and synced vaults:

```sh
node scripts/build-native-response-lab.mjs NEW_PRIVATE_EVIDENCE_DIRECTORY --html
```

Launch its returned profile using Cua Driver. The fixture verifies Live Preview,
Reading mode, Source mode, frame identity during surrounding edits, sandbox/Node
isolation, persistent bytes, and a new offline viewer with network access refused.
It saves `RESULT.json` and mode screenshots. Synthetic native evidence is under
`/home/ubuntu/backups/send-to-t3-code/html-results-20261015-lab-5/` (Obsidian 1.13.7).
Keep failed attempts for diagnosis. They are not release smoke evidence.

Release acceptance additionally requires a real HTML attachment and canonical
result reference, the installed QLO2 client after Sync and native reload, actual
page interaction, expansion, and screenshots outside the vault. Preserve the
user's original note and settings. Record the exact release using
`--complete-smoke`; a packaged release alone remains incomplete.

Native iPhone and Android behavior is not established by the Linux desktop lab.
The independent Headless Sync lab does not supply native mobile coverage.

## Upstream contracts

Compared the running nightly `v0.0.46-nightly.20261008.2849` with upstream
`42da166d131017335a1158d0b379dd68b8985796` (2026-10-15):

- `packages/shared/src/htmlRender.ts`: reference, sizing, theme and message protocol.
- `packages/shared/src/toolOutput.ts`: bounded provider-envelope recognition.
- `apps/server/src/htmlRender/HtmlRender.ts`: prepared, stored HTML attachments.
- `apps/web/src/components/chat/HtmlRenderFrame.tsx`: inline iframe and expansion.
- `apps/web/src/components/files/BrowserDocumentFrame.tsx`: sandbox and source checks.

The upstream repository is <https://github.com/pingdotgg/t3code>.
