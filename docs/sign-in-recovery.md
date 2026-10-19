# Device sign-in recovery

Each Obsidian client keeps its own T3 account and environment credentials.
Markdown and response bindings can reach a second client without usable local
credentials. An expired account session must not leave that client looking signed
in, or leave a completed T3 run labelled as active work.

A typed expired-account error clears account credentials on that device only.
Shared project links, response bindings and manual pairings remain. The email and
an expired-sign-in flag remain in device-local storage. Settings offer **Refresh
authentication** with the email already filled. The text explains that each client
must authenticate separately. Network and service failures do not sign out an
otherwise valid account.

A response waiting for sign-in keeps its saved anchor and received text. Its
status and rectangular **Sign in** control are display-only. The control opens
plugin settings in the same place as the normal close and follow controls. The
response pauses rejected background reads until successful authentication starts
recovery. Reauthentication retrieves existing T3 work; it never sends the prompt
again. Safe reads can renew a rejected managed environment token once; mutations
are not retried by this recovery path.

The regression tests exercise real account-expiry handling and settings controls,
and the production response manager, subscription, canonical snapshot and final
item reader on a cold receiving device. They include an ordinary new line during
the wait and prove that the verified final save keeps it. These tests do not
establish native iPhone, Android, or Windows behavior. Release smoke evidence must
name the real client and distinguish synthetic authentication from a real account
renewal.

## Native validation, 2026-10-19

The isolated native Obsidian fixture uses the production response manager,
stream controls and settings form with synthetic account and T3 APIs. Native
clicks opened **Refresh authentication** from the rectangular response action,
reused `synthetic@example.invalid`, submitted a synthetic verification code and
resumed the completed response. The canonical final item was saved once; the
ordinary line entered during the wait remained, and the anchor and Sign in
action disappeared. No real account was signed out or renewed in this fixture.

Screenshots, all five successful checks and cleanup proof are retained outside
the vault at
`/home/ubuntu/backups/send-to-t3-code/sign-in-recovery-lab-20261019-a/`.
The three temporary fixture notes were deleted through Obsidian's file explorer.
The HTML cold-receiver fixture and its cleanup proof are retained at
`/home/ubuntu/backups/send-to-t3-code/html-phone-switch-20261019-5096443c-1/`.
Its fifteen native checks include a 64-pixel failed card and recovery with an
independent empty receiving cache. Neither fixture establishes native mobile,
Windows, or two-machine Sync behavior.

Independent review also exposed a valid manual session on a shared managed
connection being blocked by an expired account. Device-local manual sessions
now remain usable when their exact URL, environment and expiry are valid.
The account regression test covers this case. HTML pending-load and edit-cost
review fixes are described in `html-review-fixes-20261019.md`.
