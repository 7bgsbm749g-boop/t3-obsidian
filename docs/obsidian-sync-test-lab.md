# Obsidian Sync test lab on the VPS

Verified 2026-10-03. Two independent Obsidian desktop processes and two independent
local vaults exchange synthetic notes through a dedicated, real Obsidian Sync
remote vault. This capability does not depend on the Windows laptop being awake.

## What is running

| Client | Local vault | Desktop profile | Sync service |
| --- | --- | --- | --- |
| A | `/home/ubuntu/vaults/Sync Test A` | `/home/ubuntu/.local/share/obsidian-sync-test-lab/a/desktop-profile` | `obsidian-sync-test-a.service` |
| B | `/home/ubuntu/vaults/Sync Test B` | `/home/ubuntu/.local/share/obsidian-sync-test-lab/b/desktop-profile` | `obsidian-sync-test-b.service` |

Both connect to **T3 Sync Test Lab**, remote ID
`5544fc364393e1ceed52282090a87fb4`, hosted in Europe. This is a dedicated synthetic
lab using standard encryption; never copy user notes, credentials, private
attachments, or production plugin settings into it. It uses one additional remote
vault slot. Production QLO2 and its continuous Sync service remain separate.

Each client has its own Sync configuration, database, file watcher, device name,
and desktop profile. Neither vault is a symlink or a shared directory. Sync of
configuration files is disabled in both clients, allowing independent plugin
settings. The permanent `Sync Lab Overview.md` is a synthetic example note.

The transport is **official Obsidian Headless Sync 0.0.14**, behind real Obsidian
1.13.7 desktop editors. The desktop core Sync plugin is not connected. Obsidian's
published guidance says to use one Sync method per device; do not casually mix
desktop and headless Sync here. Connecting the built-in engine requires a
reviewed handoff and must account for production QLO2's headless deployment
workflow.
Credentials are provided in memory to the supported CLI from the existing local
Obsidian headless sign-in. Do not print the token or copy credentials into notes.

## Operations

Use the canonical helper from any thread:

```bash
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py status
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py start both
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py stop b
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py start b
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py smoke
```

`stop b` simulates a disconnected Sync client, not a disconnected T3 provider or
an entire offline operating system. A one-shot scan requires that client's Sync
service to be stopped:

```bash
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py stop a
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py scan a
python3 /home/ubuntu/projects/send-to-t3-code/scripts/obsidian-sync-lab.py start a
```

The services have a 512 MiB memory limit, zero swap allowance, and a 50% CPU
quota each. They are available on demand and deliberately not enabled at boot.
Do not stop `obsidian-qlo2-sync.service` for lab testing. Stop the lab services
when they are not needed; preserve the reusable lab configuration and permanent
overview note for subsequent tests.
The helper serializes mutation commands through a local advisory lock. Coordinate
native GUI experiments too: one thread should own a lab reproduction at a time.

Always delete temporary smoke-test notes and any T3 threads created for the test
after use, including failed, cancelled, and interrupted tests. Save evidence
outside the vaults first and stop active test work. Delete threads through native
T3 controls and notes through Obsidian's normal vault operations; verify note
deletion reaches both lab vaults through Sync. Archiving or closing is not
deletion. Preserve pre-existing user content and immutable evidence. Do not report
the test complete until cleanup is verified; report any blocker with the exact
remaining thread IDs and note paths.

To reopen a closed lab editor, use the Cua Driver `launch_app` operation with
`launch_path: /opt/Obsidian/obsidian` and the matching argument:

```text
--user-data-dir=/home/ubuntu/.local/share/obsidian-sync-test-lab/a/desktop-profile
--user-data-dir=/home/ubuntu/.local/share/obsidian-sync-test-lab/b/desktop-profile
```

Launch each profile separately. Discover its current PID/window ID through Cua;
recorded PIDs are not durable identities. Follow the cua-driver native snapshot,
action, and verification workflow. Preserve unrelated Obsidian windows. The lab
does not automatically install or authenticate T3 Code: prepare the
reviewed plugin build and supported connections in each test vault before a
plugin-specific reproduction. Never transplant production `data.json`, private
leases, or subscription records into a lab client.

## Proof and limits

The real remote smoke verified create A → B, edit B → A, rename B → A with the
old path absent, B remaining stale while disconnected, B catching up after
reconnect, and deletion A → B. Temporary smoke notes were removed through Sync.
The reusable smoke command creates unique synthetic names, retains independent
CLI scan logs and byte hashes, and restores the previous service states.

Evidence:

- `/home/ubuntu/backups/send-to-t3-code/sync-test-lab/20261003T223715Z-8ed651c7/smoke.json`
- `/home/ubuntu/backups/send-to-t3-code/sync-test-lab/20261003T224356Z-20972a3b/smoke.json`
- `/home/ubuntu/backups/send-to-t3-code/sync-test-lab-20261003/gui-file-verification.json`
- `editor-a.png`, `editor-b.png`, and `setup-complete.json` in the same dated
  evidence directory, outside every synced vault.

Actual native keyboard edits were performed in A and B. Their saved Markdown
matched across both copies. Verify rendered output separately: a matching file is
not proof that an already-open editor has adopted it. The receiving desktop view
can update later than the remote file; allow bounded observation and record the
actual delay. Do not reload an editor to disguise a live-update failure.

This lab can reproduce real remote file propagation, delayed edits, rename/move
notifications, conflicting local copies, and plugin reactions to incoming file
changes. A specific streaming, conflict, or stale-write repair still requires its
own reproduction, client interaction, saved-response checks, and evidence.
The setup smoke does not prove any particular product defect is repaired.

It does **not** establish desktop core Sync engine behavior, separate physical
machine behavior, or native Android/iPhone coverage. Browser viewport resizing,
desktop mobile styling, and this lab's GUI keyboard input are not phone proof.

## Mobile emulation

An on-demand Android lab is available through `scripts/obsidian-mobile-lab.py`.
It installs checksum-pinned official Android Emulator 37.2.13, Android 15/API 35
x86_64 and Obsidian 1.15.0. KVM API 12 acceleration, native Obsidian launch,
the mobile editor, private IndexedDB and app/WebView process suspension were
verified on 2026-11-10. The test WebView reports Chromium 124.

The default private state directory is
`~/.local/share/t3-obsidian-mobile-lab`; `T3_MOBILE_LAB_ROOT` can select a dedicated
alternative. Its marker prevents adoption of an unrelated directory. The host
user needs membership in the `kvm` group; the launcher uses `sg kvm` so a T3
restart is unnecessary after an administrator grants that membership. No
production vault, plugin settings or credentials are copied into the device.
The test vault is **T3 Mobile Lab**, in Android Obsidian's private app storage.

The emulator owns console port 5580 and a separate loopback ADB server on 5041.
Both run under `t3-session`; the lab uses an operation lock to serialize runs.
The VM has 1536 MiB guest RAM and a 768 MiB explicitly provisioned data image,
with a 2300 MiB host test budget. The official `-lowram` option keeps that guest
budget explicit. This is a small functional test device, not a performance
reference. Check disk headroom before setup. The command refuses unsafe archive
paths, wrong artifact sizes and checksum mismatches.

Use a new external evidence directory for each attempt:

```sh
python3 scripts/obsidian-mobile-lab.py setup --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-setup
python3 scripts/obsidian-mobile-lab.py start --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-start
python3 scripts/obsidian-mobile-lab.py status --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-status
python3 scripts/obsidian-mobile-lab.py install-app --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-install
```

Wait for `bootCompleted: true` before installing the app. On first use, create
the synthetic **T3 Mobile Lab** vault in App storage, continue without Sync, and
exit Restricted mode through Obsidian's normal UI. Exiting Restricted mode can
automatically load previously enabled plugins; do not enable the same plugin a
second time during that load. These controls can be operated through the owned
Android accessibility tree or its WebView, without a physical phone.

Install a reviewed three-file plugin artifact directory, then restart only the
owned Android app. Never use production `data.json`:

```sh
python3 scripts/obsidian-mobile-lab.py install-plugin --plugin-dir /absolute/reviewed-artifacts --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-plugin
python3 scripts/obsidian-mobile-lab.py restart-app --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-restart
python3 scripts/obsidian-mobile-lab.py run --scenario suspension --freeze-seconds 10 --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-suspension
python3 scripts/obsidian-mobile-lab.py run --scenario pane-gap --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-pane-gap
python3 scripts/obsidian-mobile-lab.py run --scenario closed-destination --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-closed
python3 scripts/obsidian-mobile-lab.py stop --evidence /srv/t3-evidence/t3-obsidian/mobile-lab/UNIQUE-stop
```

`run` waits for plugin startup, installs the guarded native fixture, captures
the actual editor and saved bytes, and deletes its notes through Obsidian even
after a failed assertion. `recover-existing` checks an intentionally retained
old fixture after an artifact upgrade. A failure must retain its evidence and
report any unfinished cleanup; do not count it as a completed smoke.

`suspension` backgrounds Obsidian and sends `SIGSTOP` to the exact owned app and
WebView renderer processes. It checks their stopped states, stages synthetic
canonical completion while they cannot execute, then resumes the same process
identities with `SIGCONT`. A recycled PID never receives the resume signal.
`freeze` and `thaw` expose those steps separately for longer controlled tests;
always thaw in a `finally` path or stop the owned emulator. The unchanged
0.0.415 plugin passed a basic 16-second freeze/resume case. Suspension alone
was therefore not proven as the original report's trigger.

`pane-gap` controls the native manager's observation of one temporarily empty
editor while the actual saved anchor remains intact. On 0.0.415 this reproduced
an unsaved permanent retirement and a blank response after a full Android app
restart. This is fault injection into the real mobile application, not proof
that a particular iPhone/Sync event caused the original gap.

`attach` creates a fresh loopback forwarding port for the current app process.
`scripts/mobile-cdp.mjs` refuses non-loopback endpoints and checks the debugger's
`Android-Package` is `md.obsidian` before evaluating a fixture. It does not attach
to a Chrome profile. Obtain a new attachment after an app restart or ADB restart.
`capture` retains the native screenshot, accessibility tree and bounded logcat.

These tests exercise real Android mobile Obsidian and its native note IO, with
synthetic canonical T3 input. They do not claim a provider round trip or built-in
Obsidian Sync propagation. Configure the dedicated Sync test vault separately
through normal sign-in when that transport is under test; never connect QLO2.
Android suspension approximates the stopped-execution part of iOS background
freezing, but does not reproduce WKWebView, iOS storage or Apple's lifecycle.

Apple's iOS Simulator requires Xcode on macOS. It cannot run directly on this
Ubuntu VPS. Exact iOS coverage needs an appropriate Apple test environment;
the Android lab does not make the user's phone a routine test dependency.

Primary references:

- [Obsidian Headless Sync](https://help.obsidian.md/sync/headless)
- [Android Emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration)
- [Official Obsidian downloads](https://obsidian.md/download)
- [Xcode system requirements](https://developer.apple.com/xcode/system-requirements)

## Synthetic device completion fixture

`node --import tsx scripts/build-device-completion-sync-lab.mjs PRIVATE_EVIDENCE_DIRECTORY`
installs a synthetic fixture only in these two lab vaults, backs up their app and
community-plugin configuration outside Sync, and records a unique note/binding.
Use a new directory in the project's gitignored `/home/ubuntu/projects/send-to-t3-code/evidence/` folder. Launch the two
profiles separately with Cua Driver. Wait for both `a-ready.json` and
`b-ready.json`; the fixture checks native editor adoption of the original before
registration. Stop only B's Sync, then create `finish.json` in the evidence
directory. B uses the production registration, authority, device manager,
IndexedDB journal, coordinator and native note IO. Its T3 completion evidence is
synthetic; it has no provider connection or dispatch permission.

Check B's completed editor and disk bytes while A remains on the original. Then
restart B Sync and require `a-adopted.json` to report visible adoption without a
reload. Screenshots and all private proof records remain outside the vaults.
Close only these synthetic lab windows, run the builder with `--restore`, remove
only its unique temporary note through Sync, and restore previous service states.
`--rebuild` updates an already installed lab fixture for diagnostics; retain all
failed-attempt evidence and source hashes. This command never installs QLO2 or
copies production settings. The October 8 fixture used desktop Obsidian 1.14.4
and official Headless Sync; desktop core Sync and native mobile remain separate
coverage limits.
