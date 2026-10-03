# Send to T3 Code repository guidance

## Authoritative locations

- The only source checkout is `/home/ubuntu/projects/send-to-t3-code`.
- `/home/ubuntu/Obsidian Vault/.obsidian/plugins/send-to-t3-code` is the development-vault installation. It may contain only `main.js`, `manifest.json`, `styles.css`, and its device-local `data.json`. Never edit source there.
- `/home/ubuntu/vaults/QLO2/.obsidian/plugins/send-to-t3-code` is the QLO2 installation published by Obsidian Sync. Never edit it by hand.
- Preserve every installation's `data.json`. Release tooling must prove it remained byte-identical.

If the current working directory is an installed-plugin directory rather than the canonical source checkout, stop and move the work to the canonical checkout. Do not reconstruct source from an installed bundle.

## Definition of done

- Investigation, explanation, review, and feasibility work are read-only unless the user separately asks for implementation.
- `source-only`, `prototype`, or `do not deploy` means edit and test the canonical checkout without installing or releasing it.
- For an ordinary user-requested product change, “implement”, “fix”, “add”, or “build” means the full QLO2 delivery path unless the user explicitly narrows the scope:
  1. implement in the canonical checkout;
  2. run the build and complete test suite;
  3. commit the reviewed source, documentation, and test changes in the canonical checkout;
  4. create a strictly newer immutable release from that clean worktree;
  5. install runtime artifacts into the development vault;
  6. back up and install QLO2 while preserving `data.json`;
  7. force and verify a fresh Obsidian Sync scan;
  8. reload a real QLO2 Obsidian client and smoke-test the changed behavior;
  9. record immutable smoke evidence.
- Do not say a product change is deployed, live, complete, or ready merely because `npm run build` passed. A release receipt with status `awaiting-live-smoke` is intentionally incomplete.

## Required commands

- Build: `npm run build` (writes `dist/main.js`, never into a vault).
- Test: `npm test`.
- Release: `npm run release:qlo2 -- --bump patch` (or `minor`/`major`). This is the only supported packaging/deployment entry point.
- If packaging succeeded but installation or Sync failed, retry the exact immutable bytes with `npm run release:qlo2 -- --resume VERSION`; never delete/rebuild that version with different bytes.
- Commit the reviewed release changes before running the release command. Do not include unrelated user edits in that commit. The release command refuses a dirty worktree by default; `--allow-dirty` remains an exceptional path only when the user explicitly requests deployment of reviewed dirty bytes.
- After a real client reload and smoke test, record evidence with:
  `npm run release:qlo2 -- --complete-smoke VERSION --device DEVICE --evidence PATH --notes "WHAT WAS VERIFIED"`.

The retired `scripts/deploy-qlo2.py` must continue to refuse direct use. Never hand-copy files into either vault and never overwrite an existing versioned archive or receipt.

## Release invariants

- Every deployment uses a version strictly newer than the version installed in QLO2.
- Version alignment includes `package.json`, the root and package entry in `package-lock.json`, `manifest.json`, and `versions.json`.
- Archives under `release/` and receipts under `/home/ubuntu/backups/send-to-t3-code/releases/` are immutable. If a release attempt has created one, do not reuse that version for different bytes.
- The package contains exactly `main.js`, `manifest.json`, `versions.json`, `styles.css`, `README.md`, and `LICENSE` beneath `send-to-t3-code/`.
- Installation is atomic per file. QLO2 deployment must stop the continuous Sync service, install, run a fresh one-shot scan, require `Fully synced`, and restart the service in a `finally` path.
- Keep deployment on the VPS. Do not route QLO2 installation through the Windows laptop.

## Live smoke testing

- Smoke-test on a real QLO2 client after it has received Sync and reloaded the plugin. Use the local VPS Obsidian client by default; test another affected device when the change is platform-specific.
- Preserve the user's current note and settings. Prefer a uniquely named temporary note, cancel before dispatching external work when delivery itself is not under test, then remove the temporary note.
- For editor-menu changes, verify in the actual editor that the menu appears only for the intended selection and that the expected destination UI opens. For delivery changes, complete one bounded real delivery and verify the observable T3 result.
- Capture a screenshot or equivalent durable evidence outside the vault, then record it with `--complete-smoke`. Do not fabricate or record a smoke receipt based only on unit tests.
- Reloading a client can interrupt active work. Inspect current state first, then use Obsidian's **Reload app without saving** command or a verified plugin disable/enable cycle; `Ctrl+R` alone is not acceptable reload evidence. Do not kill Obsidian blindly.

## Worktree and safety

- This repository may contain user changes. Preserve unrelated edits and inspect overlap before patching.
- A user request for the full QLO2 product-change delivery path authorizes the pre-release commit of reviewed changes for that request. Do not commit unrelated user edits. Do not push, reset, or discard changes unless the user explicitly requests it.
- Backups live outside synced vaults under `/home/ubuntu/backups/send-to-t3-code`.

## Real Sync testing capability

- The VPS has two independent desktop test clients and local vaults, **Sync Test A** and **Sync Test B**, connected to the dedicated **T3 Sync Test Lab** remote vault through official Obsidian Headless Sync. Use [docs/obsidian-sync-test-lab.md](docs/obsidian-sync-test-lab.md) and `scripts/obsidian-sync-lab.py` when investigating Sync races; do not substitute two windows on one local folder.
- Keep lab content synthetic and preserve production QLO2, settings, and unrelated clients. Prepare the reviewed plugin and supported connection separately before testing its behavior; never clone production private response records into the lab.
- Report real file propagation, visible editor behavior, desktop core Sync engine behavior, and native mobile coverage separately. This lab does not prove native iPhone or Android behavior. Mobile emulation feasibility and its remaining prerequisites are recorded in the runbook.
