# Send composer

The note Send destination dialog and Ask agent box share one composer. The note
or highlighted passage stays captured as context while you choose a project,
model, and destination.

- Leave the question empty to send the captured note or selection.
- Type a question to ask about that context.
- Use the streaming switch to control replies in the editor for this send.
- Switch the final answer between Quoted Markdown and Raw Markdown. The
  format switch is disabled while editor streaming is off.
- The model button reads the chosen machine's provider catalog and advertised
  model options. Changes apply to this send. They do not change global settings.

The thread dropdown sits beside the arrow send button. It starts at New thread.
Choose Existing thread to open the thread picker. Selecting a thread changes the
composer's destination; it does not send. Previous thread is also available for
notes with a remembered destination. Linked notes in 1:1 mode and active-response
continuations keep their required thread.

Click the arrow or press Enter to submit. Shift+Enter adds a line. Closing a
picker keeps the draft. Changing projects clears the old thread and model choice.
The composer retains its draft and switches after a recoverable send failure.

Confirmed quick sends and command-palette submissions still use their captured
default route. Holding the destination-selection modifier, using the explicit
choose-destination command, or opening Ask agent shows the composer. A first send
also opens it. Progress and final-answer presentation in an already running
response keep that response's existing policy.

The model control resolves the project or thread model when the composer opens,
including the advertised default reasoning setting. It shows that model and its
provider glyph. A late catalog from another destination cannot change this one.
The answer-format control shows its icon at rest and reveals the label on hover
or keyboard focus. Conversation status is on the thread button, without a footer.

The prompt uses T3's file, skill and provider-command suggestions. Type `@` to
search files on the selected machine, `$` for its enabled skills, or `/` for its
advertised provider commands and skills. `/model` opens the model picker;
`/plan` and `/default` switch modes when the provider supports them. Provider commands appear at the start
of a message. Arrow keys change the highlighted result, Enter or Tab selects it,
and Escape dismisses the list. Selecting a suggestion never sends. File and
skill selections travel as structured context with the message, including retry.

Layout values and menu presentation follow T3 Code source `c52df24d28`, including
`ChatComposer.tsx`, `ComposerSurface.tsx`, `ComposerCommandMenu.tsx`,
`composerFooterLayout.ts`, and `composer-logic.ts`. The note context and thread
destination controls are specific to this plugin.
