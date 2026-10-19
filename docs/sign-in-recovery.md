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
