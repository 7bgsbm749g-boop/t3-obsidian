# Send to T3 Code repository guidance

## Authoritative locations

- Implement and test in the current thread's source worktree. Parallel tasks use separate worktrees.
- `/home/ubuntu/projects/send-to-t3-code` is the integration and release checkout. Integrate reviewed commits there before packaging a release.
- `/home/ubuntu/Obsidian Vault/.obsidian/plugins/send-to-t3-code` is the development-vault installation. It may contain only `main.js`, `manifest.json`, `styles.css`, and its device-local `data.json`. Never edit source there.
- `/home/ubuntu/vaults/QLO2/.obsidian/plugins/send-to-t3-code` is the QLO2 installation published by Obsidian Sync. Never edit it by hand.
- Preserve every installation's `data.json`. Release tooling must prove it remained byte-identical.

If the current working directory is an installed-plugin directory, stop and move the work to a source worktree. Do not reconstruct source from an installed bundle.

## Definition of done

- Investigation, explanation, review, and feasibility work are read-only unless the user separately asks for implementation.
- `source-only`, `prototype`, or `do not deploy` means edit and test the current source worktree without installing or releasing it.
- For an ordinary user-requested product change, “implement”, “fix”, “add”, or “build” means the full QLO2 delivery path unless the user explicitly narrows the scope:
  1. implement in the task's source worktree;
  2. run the build and complete test suite;
  3. commit the reviewed source, documentation, and test changes in that worktree;
  4. integrate the reviewed commits into the clean canonical release checkout and create a strictly newer immutable release;
  5. install runtime artifacts into the development vault;
  6. back up and install QLO2 while preserving `data.json`;
  7. force and verify a fresh Obsidian Sync scan;
  8. reload a real QLO2 Obsidian client and smoke-test the changed behavior;
  9. record immutable smoke evidence and verify deletion of all temporary smoke threads and notes.
- Do not say a product change is deployed, live, complete, or ready merely because `npm run build` passed. A release receipt with status `awaiting-live-smoke` is intentionally incomplete.

## Required commands

- Build: `npm run build` (writes `dist/main.js`, never into a vault).
- Test: `npm test`.
- Release: `npm run release:qlo2 -- --bump patch` (or `minor`/`major`). This is the only supported packaging/deployment entry point.
- Run packaging and QLO2 delivery from the canonical release checkout, one release at a time. Other source worktrees can remain active and need not be clean.
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
- Do not create or store smoke-test notes, folders, attachments, screenshots, logs, reports, or other evidence in QLO2, even temporarily. Keep test fixtures in a separate test vault and all evidence under `/home/ubuntu/backups/send-to-t3-code`, outside synced vaults.
- Preserve the user's current note and settings. Keep QLO2 verification limited to checks that create no test content. Run fixture-based checks in a separate test vault and report that distinction. Cancel before dispatching external work when delivery itself is not under test.
- Always delete every temporary T3 smoke-test thread and smoke-test note after use, including failed, cancelled, and interrupted tests. Save diagnostic evidence outside the vault first, stop any active test work, then delete the threads through native T3 controls and the notes through Obsidian's normal vault operations. Archiving a thread or closing a tab does not count as deletion. Preserve pre-existing user threads and notes, and immutable evidence.
- Track the exact test thread IDs and note paths. Verify that all are deleted before reporting the test complete or recording a completed smoke receipt. If cleanup fails, report the remaining IDs/paths and the blocker; cleanup remains required.
- For editor-menu changes, verify in the actual editor that the menu appears only for the intended selection and that the expected destination UI opens. For delivery changes, complete one bounded real delivery from the separate test vault and verify the observable T3 result.
- Capture a screenshot or equivalent durable evidence outside the vault, then record it with `--complete-smoke`. Do not fabricate or record a smoke receipt based only on unit tests.
- Reloading a client can interrupt active work. Inspect current state first, then use Obsidian's **Reload app without saving** command or a verified plugin disable/enable cycle; `Ctrl+R` alone is not acceptable reload evidence. Do not kill Obsidian blindly.

## Visual changes and evidence

- A request to strengthen an effect preserves the normal appearance between passes unless the user asks to change it. Prefer changing the effect's parameters over replacing text painting or markup.
- Text fill, clipping, opacity, filters, and compositing can change visible glyph edges even when font, colour, and dimensions match. Treat changes to those properties as rendering changes.
- Compare rendered pixels against the last accepted version with the effect outside the text, using the same document, position, theme, selection state, and custom colours. Also check that the requested effect is visibly stronger. Computed styles and layout measurements alone do not prove unchanged appearance.
- Match claims to evidence. A desktop or Chromium check does not prove native iPhone behaviour. Before explaining what changed, inspect the diff; do not claim that normal text is unchanged without a rendered comparison.

## Worktree and safety

- This repository may contain user changes. Preserve unrelated edits and inspect overlap before patching.
- A user request for the full QLO2 product-change delivery path authorizes the pre-release commit of reviewed changes for that request in its source worktree. Do not commit unrelated user edits. Do not push, reset, or discard changes unless the user explicitly requests it.
- Backups live outside synced vaults under `/home/ubuntu/backups/send-to-t3-code`.

## Real Sync testing capability

- The VPS has two independent desktop test clients and local vaults, **Sync Test A** and **Sync Test B**, connected to the dedicated **T3 Sync Test Lab** remote vault through official Obsidian Headless Sync. Use [docs/obsidian-sync-test-lab.md](docs/obsidian-sync-test-lab.md) and `scripts/obsidian-sync-lab.py` when investigating Sync races; do not substitute two windows on one local folder.
- Keep lab content synthetic and preserve production QLO2, settings, and unrelated clients. Prepare the reviewed plugin and supported connection separately before testing its behavior; never clone production private response records into the lab.
- Report real file propagation, visible editor behavior, desktop core Sync engine behavior, and native mobile coverage separately. This lab does not prove native iPhone or Android behavior. Mobile emulation feasibility and its remaining prerequisites are recorded in the runbook.
