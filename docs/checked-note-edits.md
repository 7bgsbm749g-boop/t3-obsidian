# Checked agent note edits

Community-library installations include the optional agent setup under
Settings → T3 Code → Agent tools, the first settings page. Connect MCP uploads the reviewed stdlib-only Python
MCP server, checked transport and skill through T3's existing file APIs. It
requires Python 3.10 or later on each connected T3 machine. No repository clone, package
download, incoming endpoint, or plugin-side program execution is involved.

Connect MCP checks every connected machine and enabled, installed agent. It
skips current setups and configures missing or outdated ones, with at most two
machines active at once. One failure does not block the other machines.
Codex uses a per-instance MCP override; Claude Code uses an extra MCP config;
Cursor loads a plugin directory; OpenCode uses an additional OPENCODE_CONFIG
layer. All share the same stdio server and skill. T3 receives a narrow
provider-instance mutation, without replacing the provider map. Explicit setup
requests settings:write and providers:manage in addition to the normal scopes.
Managed account sessions renew those permissions when needed; a restricted
manual pairing must be renewed. Background detection never changes settings. Existing options, other instances and
credential-redaction markers are preserved. Conflicting custom MCP launch
options and changed setup receipts stop installation rather than overwrite user
configuration. Source files are checked after upload and kept under immutable
content hashes in `.t3-obsidian/agent-tools/`. A prepared receipt supports an
interrupted setup; removal restores the recorded launch arguments only while
they still match. It does not delete files a running agent may use.

The agent runtime starts the stdio server in a new session. The server supplies
the maintained skill in its initialize instructions, resource, prompt and
`instructions` tool, so no separate skill installation is needed. Setup reports
configuration separately from a verified MCP initialize handshake. Existing
agent sessions need a new session to load the tools. There is no claim of a
working runtime merely because configuration was written. Other harnesses remain visible in the status details. The collapsed
Advanced → Manual setup section provides a standard server definition for each
machine, prepared by Connect MCP. Disconnect MCP removes only owned integration
settings; it keeps immutable tool files for existing sessions and does not
disconnect T3 accounts. Neither action uses ACP.

Agents exchange data with the running Obsidian plugin through the existing T3
Connect file APIs. The plugin makes outbound authenticated connections; it
opens no incoming command port and executes no local program. No T3 server
change, Obsidian CLI, or local-edit-plus-Sync fallback is used.

Each connected client registers under
`.t3-obsidian/clients/VAULT_UUID/CLIENT_UUID/` in T3's No project workspace,
outside the vault. The registration identifies the environment, workspace,
vault, device, current instance and loaded version. Its capability token is
private. Registrations refresh every ten seconds and expire after thirty. Up to sixteen
configured environments have independent command channels; at most four new
channels open at once. Offline peers do not block polling of ready clients.
The agent helper selects one exact client and never broadcasts a mutation.

Requests carry a stable UUID, exact client and instance, token and expiry. A
checksum marker uploaded last binds the complete request bytes. Payloads over
24 KB use immutable checksum-addressed chunks, up to 2 MB. The host rejects
truncation, wrong identities, stale tokens and changed input. It writes a private
execution receipt before dispatch and a result before acknowledging reload.
Interrupted execution remains ambiguous; it cannot automatically dispatch again.
Explicit retries can repeat a confirmed failure only. Completed receipts remain
for 24 hours. Never reuse request IDs for new work.

The agent-side `scripts/obsidian-command.py` helper reads and writes only this
transport workspace. It removes its exact request/result files after the host's
consumption marker. Unconfirmed files remain for inspection with the same ID.
T3's current API does not provide `projects.deleteEntry`; the plugin does not
rely on that unsupported operation. Private receipt and edit indexes have
transactional count/byte limits. Pending edits and ambiguous commands survive
normal expiry and are never evicted to make room for new work.

`prepare-note-edit` captures the current canonical note through Obsidian and
returns an edit ID, original content and checksum. An active response requires
its exact binding. `submit-note-edit` supplies that original checksum and the
complete proposed note, limited to 1 MB. All active response frames must remain
byte-identical and in the same order. Compatible ordinary user edits merge;
overlapping changes retain both versions and block the save.

For an active reply, the proposal is stored as immutable original/proposed data
on the connected T3 machine. Its reference is attached under the same native
final-save guard as the reply. The existing final writer reads and verifies it,
merges current user edits, and saves proposal plus final reply in one checked
write. Stop uses that path with frozen reply text and still sends the remote
interrupt when a local merge fails. `submitted` is not `saved`: only a verified
write marks the local edit saved. Submit before the current run finishes; do not
wait inside that run for its own final save. A different device can finish the
shared binding through the same authenticated T3 route; the originating device
may retain `submitted` until it has local proof, rather than claim a false save.

Ordinary notes use the existing native compare-and-set write immediately.
`create-note` uses `Vault.create` and refuses an existing path. `rename-note`
checks the current checksum, refuses an existing destination and uses
`FileManager.renameFile`, preserving native link updates. Parent folders must
exist. Prepare content proposals after a planned rename. No raw vault writes
or vault-wide searches are part of these operations.

Reply following, imports, response reservations, native streaming, questions,
Codebase, safe final saves and normal note Sync remain. Existing reply-following
registrations are read through T3 APIs from their prior private storage when
available, then retained in device storage. Old event notification/subscription
fields are discarded. Note/property/folder/job emissions, old attachment cleanup,
copy controls, custom link suggestions and vault-wide recovery scans are removed.
Known paths, observed renames and explicit recovery still protect active replies.
Native indexed settings require Obsidian 1.13.0; the legacy renderer is removed.

Release checks use the same connected transport for status, reload and exact
loaded-client proof. The external maintainer helper retains the old maintenance
endpoint solely to reload an older installed client during upgrade. It cannot
send notes or apply edits through that old endpoint. The laptop helper tries its
connected registration on the release machine, then its existing private remote
helper route; note Sync is not used as a command queue.

A conflicting proposal can be withdrawn with `cancel-note-edit --edit-id EDIT_ID
--hash CURRENT_HASH`. Read `note-edit-status` first to obtain the current note
checksum. This removes only the pending proposal; it does not undo saved text.
To save a retained frozen reply, use `response-recovery-info --binding-id ID`,
then `retry-response-save --binding-id ID --hash CURRENT_HASH`. The same checked
writer runs again without sending input or another remote Stop. Conflicting
text must be reviewed; these commands never force an overwrite.

If another device saved the reply while a local checked write was refused, the
local lifecycle can confirm the existing save without replacing note text. It
requires the exact binding completion receipt and its checksum-verified retained
output, present once in the same destination with no reply anchor. A missing
anchor or a completion hint alone is insufficient. Pending checked note
proposals are excluded because an output receipt does not prove their edits
were saved. Compatible surrounding user edits and durable frozen replies remain
available. Reviewed recovery uses the current note checksum and the same proof.

## Why an agent edit waits

An agent submits a checked proposal against a specific note checksum. For a
streaming reply, the proposal waits for the reply's final save, including Stop.
That save merges the proposal with compatible user edits and the completed
reply. Conflicting changes preserve both versions and block the save.

User typing goes through the editor's mapped transactions. A remote whole-note
proposal is not an editor transaction and must not overwrite a changing reply.
The **Note edit waiting for final save** status makes this delay visible without
putting the status in the note or prompt. The current API attaches a whole-note
proposal to the final save. Applying compatible edits outside the protected
reply sooner may be possible through the native editor port, with additional
race and recovery checks. Queueing is a conservative choice in the current API.
