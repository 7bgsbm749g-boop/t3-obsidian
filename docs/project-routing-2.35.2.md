# Project routing verification: 2.35.2

New thread in an unlinked folder previously discarded the project displayed by
its send dialog and opened project creation. Continue could take the same folder
setup route, and the Vault project selector hid a remembered vault conversation
because its alias differed from the conversation's project key.

The dialog now captures one project selection for Continue, New thread, and
Existing thread. Its initial selection uses the remembered project, then the
nearest folder link, then the vault project. New project remains an explicit
selection. Checked conversation routing uses its actual project key, and the
vault alias is compared with the root project's key. Agent-command routing
requirements are unchanged.

Build and full tests passed: 1,090 TypeScript tests and 11 Python tests. Regression
coverage includes full-note and question sends, remembered vault and external
projects, reopening an unlinked note, explicit vault reselect, fresh unlinked
notes, and explicit project setup. The release command repeated these checks.

The real VPS QLO2 client loaded 2.35.2 through Obsidian's Reload app without saving
command. A synthetic unlinked note received three completed replies: New thread,
Continue after selecting Vault project again, and New thread after reopening.
The first two deliveries used thread `c6702c0d-4f41-51ea-804e-01cc5f758c85`; the
third used `4a91b9ab-05f5-5c94-9b3b-d6acf1a19593`. Both threads belong to QLO2
project `81eaa7ea-dc46-4c0c-b725-579cd2cd708f`.

Only explicit New project opened the creation UI. Cancelling created no folder
link and sent no additional message. The affected Diagnose T3 Code Issues
note displayed its remembered T3 Code project; its dialog was cancelled
without dispatch. The temporary fixture was removed, the original note restored,
and folder links were unchanged.

The release installation preserved data.json bytes and completed its fresh Sync
scan. Desktop evidence is complete; native iPhone and Android behavior is not
verified. Automatic laptop reload remains pending while that machine is offline.

Immutable receipt:
`/home/ubuntu/backups/send-to-t3-code/releases/2.35.2/smoke-vps-qlo2-desktop.json`

Immutable screenshots and delivery evidence:
`/home/ubuntu/backups/send-to-t3-code/releases/2.35.2/smoke-vps-qlo2-desktop-evidence.zip`
