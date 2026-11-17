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
It also clears selected file and skill references; select them again in the new
workspace. An open suggestion list consumes Enter while results load or when no
result is available. Escape dismisses the list before normal Enter-to-send resumes.
The composer retains its draft and switches after a recoverable send failure.

With several connected machines, choosing New project first asks for its T3
machine. Its model catalog and default
then come from that machine, and the workspace picker stays on that machine.
Project creation still waits until Send, and folder links still wait for delivery.
File search requires an existing workspace; a new project does not search the
machine's unrelated No project folder.

Confirmed quick sends and command-palette submissions still use their captured
default route. Holding the destination-selection modifier, using the explicit
choose-destination command, or opening Ask agent shows the composer. A first send
also opens it. Progress and final-answer presentation in an already running
response keep that response's existing policy.
Model, reasoning, mode and reference choices still travel with a continuation;
only the response's streaming and answer presentation stay fixed.

The model control resolves the project or thread model when the composer opens,
including the advertised default reasoning setting. It shows that model and its
provider glyph. A late catalog from another destination cannot change this one.
The answer-format control uses quotation marks for Quoted Markdown and angle
brackets for Raw Markdown. It shows the icon at rest and reveals the label on hover
or keyboard focus. Conversation status is on the thread button, without a footer.
The streaming switch shows “Stream replies into note: On/Off” on hover or keyboard
focus. This label appears above the toolbar, so it does not cover the format control.

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
The composer is centered in its note pane and capped at T3's default 46rem
content width. At narrow widths the model label shortens first; New thread
remains readable beside the send button.
The pane gutters are 12px below 640px and 48px above it, with 16px/20px bottom
spacing, matching the sidebar in PR #22. The format label expands and fades over
150ms, with 8px side padding and square left corners where it joins the icon.
Reduced motion disables that transition.

Codex `/feedback` requires an existing thread and uses T3's feedback-upload API
after explicit Send; it is never submitted merely by choosing a suggestion.
It rejects file and skill references without uploading feedback or sending an
agent message. Remove those references before submitting the report.
The T3-only usage panel is not advertised as an executable provider command.
