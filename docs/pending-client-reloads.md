# Pending device reloads

A device can retain a reload request while it is offline. When Obsidian opens,
receives the matching synced configuration, or returns to the foreground, it
checks its three installed plugin files. It reloads only after every SHA-256
digest matches the request and the foreground client has no active response work.
Unsaved source editors also defer the automatic reload until a save or view
change; the handler does not force-save notes. The native reload is recorded
before dispatch; a new app instance confirms the
version embedded in the running bundle and writes a result through Sync.
Requests do not expire, and no separate worker or retry timer is installed.

An already correct runtime is confirmed without reloading. A newer request
supersedes an older version, while delayed Sync cannot downgrade a newer running
version. Uncertain reloads retain their issued state rather than repeating.
An offline iPhone must open Obsidian; the feature cannot wake a suspended iOS app.
The handler must first be loaded once by clients upgrading from older versions.

## Configuration protocol

The configuration folder contains one request and result per device:

- `t-three-code-reload-request-v1-CLIENT_UUID.json`
- `t-three-code-reload-result-v1-CLIENT_UUID.json`

Each request has `version: 1`, a UUID `id`, the exact `vaultId` and `clientId`, a
numeric `0.0.BUILD` `releaseVersion`, and `runtimeSha256` entries for `main.js`,
`manifest.json` and `styles.css`. The result repeats this identity and reports
its `status`, compiled `client.loadedVersion` and `client.instanceId`, plus the
previous instance when a reload was issued. Only a matching `confirmed` result
proves completion. Request files and personal device identities remain private.

The top-level JSON files use the core plugin settings Sync category. Community
plugin files must also sync. Custom hidden directories and arbitrary files in
plugin folders are not a supported delivery route. See Obsidian's
[Sync settings](https://obsidian.md/help/sync/settings). The small journal uses synchronous Obsidian local storage so the issued marker
is saved before a native reload. It does not alter notes or user plugin settings.
