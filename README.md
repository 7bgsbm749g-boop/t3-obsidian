# t3-obsidian

Bring [T3 Code](https://github.com/pingdotgg/t3code) into your Obsidian notes. Send a note or selection to an agent, ask questions in the editor, and read replies as they arrive.

The plugin appears as **T3 Code** in Obsidian. This is an independent community plugin, with support for desktop and mobile.

![An agent response inside an Obsidian note](docs/images/inline-response.png)

## Get started

You need Obsidian **1.8.7 or later** and a running T3 Code installation with Orchestrator v2.

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/7bgsbm749g-boop/t3-obsidian/releases/latest). Put them in your vault’s `.obsidian/plugins/t-three-code/` folder, then enable **T3 Code** under **Settings → Community plugins**.
2. In T3 Code, sign in and enable **T3 Connect** on the computer you want to use.
3. Open **Settings → T3 Code → Connection** in Obsidian. Enter your T3 account email, choose **Send sign-in code**, then enter the code and choose **Verify and connect**. Your computers and projects appear automatically. Sign in on each device you use.

## Work from your notes

- **Send a note or selection.** Use **Send to agent** from the editor menu or command palette. Choose a new conversation or continue an existing thread.
- **Ask a question.** Use **Ask agent** to open the composer. Selected text becomes context for your question.
- **Follow the reply.** Responses stream into the note. Expand progress to see the agent’s activity, answer its questions, or stop the response. The finished reply becomes Markdown in your note.
- **Continue your work.** Later sends can reuse the note’s previous thread. Smart Send avoids sending the same automatic note context again.

![Ask an agent without leaving your note](docs/images/ask-agent.png)

## Connect notes and projects

- **Link a folder** to a T3 project from the folder menu. Notes below it use that project when you send them.
- **Import a response** from an existing T3 run into a note without sending a new message.
- **Browse project files** from Obsidian, including code, Markdown, images, and supported documents.
- **Open in T3 Code** from the note menu to return to the conversation in T3.

Use **Settings → T3 Code → Replies** to adjust reply behaviour, and **Projects** to manage folder links. **Advanced** includes manual pairing and the desktop-only local connection option.

---

Your chosen note content and attachments go to the connected T3 computer and its configured model provider. T3 and provider accounts or usage charges are separate from this free plugin. [Report an issue](https://github.com/7bgsbm749g-boop/t3-obsidian/issues) · [MIT license](LICENSE)
