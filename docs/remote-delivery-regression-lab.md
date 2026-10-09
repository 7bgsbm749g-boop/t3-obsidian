# Remote delivery regression on the VPS

This regression uses the two independent desktops in
[the Sync lab](obsidian-sync-test-lab.md). The generic linked folder is
`Remote delivery regression`; it contains no production notes or settings.
The fixture creates isolated T3 projects and a two-hour CLI bearer session with
the plugin's four grants. Credentials remain outside the vault and are never
printed. Production plugin bundles run in both real desktop clients.

Client B sends to a root link hosted at client A's **different local vault path**.
This forces the authenticated file RPC path despite both clients being on the
VPS. Large synthetic historical thread records keep each settings file over
T3's real 1 MiB preview limit after normal plugin saves. Official Headless Sync
transfers the saved note between independent vaults. The observer records the
active editor and rendered text; it does not simulate T3 replies or file RPC.

## Preparation and reproduction

Preserve existing lab configuration and service states; prepare only while the
lab clients are closed. The setup refuses an existing plugin installation.

```sh
node scripts/prepare-remote-delivery-lab.mjs /path/under/the/private/backups \
  --archive release/send-to-t3-code-2.36.2.zip
```

Use a real evidence directory under `/home/ubuntu/backups/send-to-t3-code/`.
Launch each desktop with its recorded separate profile through Cua. Start the
two lab Sync services if necessary. Read `LAB.json` for the generated connection,
environment and project IDs. Use `scripts/obsidian-command.py link-folder` in
both vaults to link `Remote delivery regression` to that isolated project.

Run `validation/remote-delivery-api.ts EVIDENCE before`. It requires real read
truncation, absence of the small identity record, rejection of the old host,
and denial of a token that lacks filesystem access. First send the note with
`--no-stream` to establish a bounded synthetic previous thread. Then send with
streaming enabled both without `--thread-id` (New) and with that returned ID
(Previous). Preserve the failed command IDs and results. Both must reproduce
the host identity error before applying the fix.

Build the reviewed source, run the complete suite, then install **only in the
synthetic lab** with the same helper's `--fixed` option. Reload the lab clients
with guarded `reload-client` commands using the actual lab runtime hashes.
Repeat the file API check with `after`. Send two bounded marker prompts through
the running plugin: New followed by Previous using the New thread's exact ID.
Verify exact T3 run replies, saved note contents in A and B, and the already-open
editor contents and rendered text in B without another reload. Capture native
screenshots. Neither an accepted send nor matching files alone proves success.

Retain the linked folder and synthetic setup for future checks. End the session
with `--revoke-session`; use `--refresh-session` and reload both lab desktops to
run it again. Credentials are device-local; `data.json` contains no token.
Close only the dedicated lab clients when finished and restore prior service
states. Never change QLO2 or unrelated windows for lab preparation.

## Why these tests remain

These are enduring remote delivery contracts. Settings can grow past a file
preview limit at any version, and expired sessions, pairing changes or server
updates can remove a required grant. The tests use a generic route, not a user
project name. Migration-specific transcript compatibility tests can be retired
when that compatibility is removed; file grants and bounded identity checks
must remain.

The lab proves desktop plugin behavior over the real remote RPC and official
Headless Sync paths. It does not prove native Windows, mobile, or desktop core
Sync behavior.

## Retained reproduction

`/home/ubuntu/backups/send-to-t3-code/remote-delivery-lab-20261009` contains the
immutable 2.36.2 archive hash, folder-link acknowledgements, before/after RPC
metadata, failed New/Previous commands, successful replies and native editor
captures. Before the fix, settings were 2,465,324 bytes and the server returned
1,048,576 bytes. Both streaming choices returned the user's exact host mismatch.
