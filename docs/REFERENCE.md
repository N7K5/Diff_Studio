# Diff Studio detailed reference

For the guided introduction and screenshots, see the [main page](../README.md).

A VS Code extension for reviewing and editing differences across local files, SSH machines, directories and Git history. Monaco provides syntax coloring, text editing, inline differences, resizable side-by-side panes and change navigation. The activity panel makes scripted agent edits visible as they happen.

## Install and open

Install the packaged extension:

```sh
code --install-extension artifacts/diff-studio.vsix
```

Click the **Diff Studio icon in VS Code's Activity Bar** to open the studio, or run **Diff Studio: Open Comparison Studio** from the command palette. The Activity Bar view also offers branch review, current-file comparison and agent-bridge shortcuts. Alternatively, select two files in Explorer and use **Diff Studio: Compare Selected Files**. To develop it, run `npm ci && npm run build`, open this folder in VS Code, then press F5.

## Comparisons

| Mode | Sources | Editing |
| --- | --- | --- |
| Two files | Any two local or SSH paths, including different hosts | Both sides |
| Two folders | Local/local, local/SSH or SSH/SSH folders | Select a changed file; both sides |
| Revision ↔ working file | A commit, branch, tag, `HEAD`, `HEAD~1`, or `INDEX` | Working file |
| Two Git revisions | Any two commits, branches or tags; `INDEX` is also accepted | Revisions are read only |
| Changes against branch | Master, main, another branch or commit | Working files in working-tree mode |
| Agent snapshot | Arbitrary text vs a file, or any combination of file/Git/text sources | File sources |

Branch review includes additions, deletions, renames and untracked files. Choose **Working tree + staged + untracked**, **Committed changes only**, or **Staged changes only**. **Compare from common ancestor** uses the merge base, which is useful for reviewing a feature branch. An empty base field tries `origin/HEAD`, `master`, `main`, `origin/master`, then `origin/main`.

Select a repository with **Browse** to open its changed-file list. Git mode accepts relative paths, full paths and `file://` or `ssh://` paths inside the repository. Use **Browse file** or **Browse folder**, or leave **File or folder** empty to compare the whole repository. A folder selection lists changes under that folder; select a changed file to open its diff. Both chosen revisions are respected for folder comparisons. Paths outside the repository are rejected with an explanation.

**Repository files ▾** opens a searchable list of repository-relative paths from both chosen versions, including files that only exist in history. It works for local and SSH repositories. The filesystem Browse controls remain available.

The **left and right version dropdowns** list branches, tags and commits, with commit time, short SHA, subject and author. Switch **Revision order** between newest and oldest first. When a file or folder is selected, the commit list shows its history; branch review shows repository history. Dates use your local timezone. The first 200 commits load automatically; **Load older commits** extends the list, and **Refresh versions** reloads it. Sorting applies to the loaded entries. You can still type a revision manually. On the right, **Working file · editable** switches to revision-versus-working comparison; selecting a commit switches back to revision-versus-revision. **Changes against branch** uses the same dropdown for its base.

For a deleted working file, the right side is empty and writable; saving recreates it and any missing parent folders. Missing sides display a **Create** button, including for empty files. Non-Git directory comparison uses **Two folders**, omits identical files and skips `.git`, `node_modules`, and symlinks. It reports an error above 10,000 files.

## Line comments and portable sessions

Hover beside a line number on either side and click **+** to add a comment. You can also select a line and use **Comment**, the editor context menu, or **Ctrl/Cmd+Alt+M**. Comments appear in colored blocks between code lines, with Edit and × controls. They work in side-by-side, inline and focused layouts. Insertions before a commented line move the comment; a replaced/deleted anchor is flagged and retains its original line text for review.

**Save session** writes a `.diff_studio` file containing every comparison in the **Session** tab, full text for both sides, initial and saved contents, current unsaved edits, Git revisions, file paths/statuses/renames, activity, and all line comments. Folder/branch comparisons capture every listed text file, including files you have not clicked. Saving the session does not save unsaved edits into the source files. History limits/removals only affect the recent-history list.

Use **Open session**, **Diff Studio: Open Saved Session**, or the Explorer context menu on a `.diff_studio` file in another extension run. Choose **Review bundled snapshots** to review all contents and comments without the original repositories, files, or SSH machines. Use Session to select a saved comparison or folder/branch group. Imported reviews are added to the current session, and bundled file snapshots are read-only; you can add/edit/delete comments and save another archive.

The opening dialog also offers **Link a local repository…**; **Link repository** remains available afterward. Select which archived repository to map if there are several. The extension verifies recorded commits and working-file contents before making matching working panes editable. Missing commits, different working contents, paths outside the chosen repository, and unresolved mappings remain detached snapshots. Linking does not apply edits or fetch Git history. A later explicit Save right/left writes a linked file with the existing conflict checks.

The format is versioned UTF-8 JSON (`format: "diff-studio/session"`, `version: 1`) with `sessions`, `groups`, and the active comparison ID. Every side includes its complete text, original source metadata, language, existence flag, initial/saved text, fixed commit when applicable, and a SHA-256 content checksum. Comments contain side, line, original anchor, text, and timestamps. Archives contain full compared file contents and source paths, with no agent credentials or SSH keys. The current archive size limit is 256 MB; text-file limits and UTF-8 requirements still apply. Invalid versions, checksums or references are rejected before importing anything.

## Explorer and recent comparisons

The sidebar has separate **Files**, **Session** and **History** tabs. Files are grouped into collapsible folders, sorted like Explorer, with change status badges and full paths on hover. Filtering keeps the matching folder structure. Arrow keys navigate and expand/collapse folders.

History remembers the last **10** distinct comparisons per workspace, newest first. Reopening an entry brings it to the front; **×** removes it without closing the editor. File, folder and branch comparisons can be reopened after restarting VS Code. Set **Recent comparisons** in Settings to any number from 0 to 100; 0 disables history. Lowering the limit immediately drops older entries. Only source locations and comparison choices are stored; text snapshots stay session-only. Unsaved buffers are listed separately so trimming or removing history does not discard edits in the running extension.

## Connecting and browsing SSH VMs

Use **SSH ▾** before the repository field, or beside either file source. Choose **Connect to SSH VM…**, enter an SSH alias or `user@host:port`, then click **Browse**. Existing OpenSSH keys/configuration are used; the VM needs Python 3. The connection is verified before it is remembered.

The browser lists remote folders and files, with **Parent folder**, **Home folder**, and **Go to path…** navigation. For repositories and folder comparisons, navigate into the desired directory and choose **Select this folder**. Files can be selected directly. Hidden folders and navigable symlinks appear in the browser. Git's **Repository files ▾** also lists paths that exist only in the selected revisions.

The connection picker remembers the last **5** successfully connected VMs and their last browsed folder. **Recent SSH VMs** in Settings changes the limit (0–100). Each remembered VM has a remove button. Choose **Local computer** to switch that source back to local browsing. Both file sources have independent connection controls, so local/remote and different-VM comparisons use the same workflow. No passwords or private keys are stored by the extension.

## Editing and settings

- **Save left / Save right** saves the corresponding writable pane. Cmd/Ctrl+S saves the pane with focus. Undo/redo and find work within each editor.
- **Side by side**, **Inline**, **Focus left**, and **Focus right** control layout. Focus mode maximizes one side without losing the other model.
- **Previous / Next** navigates changed regions. The header shows added/removed line counts, change groups, full file paths, editability, line counts, bytes and unsaved state.
- **Swap** exchanges the sources, retaining edits. **Reload** rereads them and asks before discarding unsaved edits.
- **Settings** changes font size, wrapping, whitespace comparison, unchanged-line folding, default layout/base, file limits and SSH timeout. Settings persist through VS Code.
- Drag the sidebar’s right edge to resize it, including while auto-hide is enabled. The width is remembered in **Settings → Sidebar width**. Focus the resize edge and use Left/Right arrows for keyboard resizing. Tree levels use a compact six-pixel indent to leave more room for names.
- **Auto-hide file list** in Settings collapses the internal comparison sidebar to a narrow handle. Hover over it or focus it with the keyboard to reveal the file list. After a mouse click, moving away hides it immediately. Keyboard navigation keeps it visible while you navigate the list. Click the **☰ hamburger** to toggle auto-hide on or off.
- **Collapse comparison setup** hides the header and source controls; **Choose files / revisions** restores them. **Hide bottom bar** hides the activity panel and editor footer. The compact toolbar keeps agent controls, session controls and **Settings** accessible. Opening a comparison also collapses setup after success. Manual visibility preferences persist.
- **Native editor** opens VS Code's native diff. Local files use their real paths. Remote and revision sources open as temporary text snapshots; save remote changes in Diff Studio.

Clean file buffers refresh every three seconds. Dirty buffers retain their edits. Saving checks the source fingerprint and rejects a changed file instead of silently overwriting it. It also refuses to overwrite a file with unsaved changes in another VS Code editor. Resolve that editor or external change, then reload. The fingerprint check detects preexisting changes; it is not a distributed filesystem lock.

Open comparisons and unsaved drafts remain available while this extension host is running, including after closing and reopening the panel. Save before closing the VS Code window; drafts are not persisted across extension-host restarts.

## SSH files

Enter a URI such as:

```text
ssh://staging.example.com/tmp/example.ts
ssh://user@second-host:2222/home/user/project/example.ts
```

The extension invokes installed OpenSSH using your existing SSH config, known hosts, keys and agent. Establish normal `ssh host` access first. The remote machine needs Python 3; remote Git comparisons also need Git. Password prompts are disabled so a missing key fails visibly. No SSH passwords are collected or stored. Paths and contents are sent as JSON over SSH stdin, not interpolated into shell commands. Spaces and shell characters in paths are supported; URI-reserved characters such as `#` must be percent-encoded.

In a VS Code Remote SSH window, local paths refer to the machine running the workspace extension host. To compare your laptop with a server, open Diff Studio in a local VS Code window and use an `ssh://` URI for the server.

## Agent scripts

Click **Connect agent**, then **Copy agent instructions** in the always-visible toolbar. Paste the entire handoff into a new Codex session along with your task. It includes the current descriptor, installed CLI and skill paths, extension host/machine context, workspace paths, active comparison, a ready-to-run startup command, and the full bundled Diff Studio skill (`skills/diff-studio/SKILL.md`). No separate skill installation or project checkout is needed. The **Diff Studio: Copy Agent Instructions** command is also available while connected.

The skill explains how to inspect/reveal comparisons, preserve a before snapshot, open local/SSH/Git files, narrate changes, show buffer edits, add line comments, save, and recover from conflicts. It does not launch a model; “Agent bridge ready” means the connection is available. Disconnect hides the copy button and invalidates the connection. Copy a fresh handoff after reconnecting or reloading VS Code. Connection messages do not occupy the comparison banner.

The bridge starts only when requested, binds to loopback on a random port, requires a random bearer token, rejects browser-origin requests, and deletes its credential file when stopped. The descriptor is mode `0600`; the handoff includes its path but never embeds the token. Run the CLI on the extension host machine; a remote host's localhost cannot be reached by using the local machine's localhost. Any process with the descriptor can use the extension host's file permissions.

For manual scripting, the descriptor path is available in the Diff Studio output channel and the copied handoff. The scripts work with Codex or any other local agent; no OpenAI API key or model SDK is needed.

```sh
export DIFF_STUDIO_BRIDGE='/path/shown/by/the/extension/agent-....bridge.json'

node scripts/agent.mjs open /absolute/before.ts /absolute/current.ts
node scripts/agent.mjs git /absolute/repo src/app.ts HEAD
node scripts/agent.mjs revisions /absolute/repo src/app.ts master HEAD
node scripts/agent.mjs list

# Use a session ID returned by open, git or list:
node scripts/agent.mjs note SESSION_ID 'I will simplify this function while preserving its result.'
node scripts/agent.mjs edit SESSION_ID right /absolute/proposed-content.ts 'Replace the repeated loop with one helper.'
node scripts/agent.mjs save SESSION_ID right
```

`edit` updates the visible buffer without writing to disk; `save` is explicit. Each edit includes the hash of the buffer the script read. Concurrent user edits cause a conflict instead of being overwritten. External filesystem edits also appear automatically in clean panes.

For a snapshot comparison, put this in a JSON file and run `node scripts/agent.mjs request request.json`:

```json
{
  "title": "Agent proposal",
  "left": { "kind": "text", "label": "Before.ts", "text": "const n = 1;\n" },
  "right": { "kind": "file", "uri": "/absolute/current.ts" }
}
```

The underlying JSON API provides `GET /sessions` and `POST /open`, `/note`, `/edit`, `/save`, `/reload`, `/reveal`. `/edit` requires `id`, `side`, `text`, and `expectedHash`. `/reload` refuses dirty buffers unless `discard: true` is explicit. Use `/note` for the intended change before editing.

## Verification

```sh
npm test                 # Typecheck, bundle, local/Git/bridge tests
npm run test:vscode      # Real VS Code extension host and UI clicks
npm run test:remote      # Real SSH reads, edits, conflicts and Git checks
npm run package          # Build artifacts/diff-studio.vsix
```

UI tests use an isolated VS Code profile in `.test-vscode`, fixtures in `.test-data`, and a debugging port on localhost. Override `VSCODE_EXECUTABLE` and `DIFF_STUDIO_DEBUG_PORT` if needed. Set `DIFF_STUDIO_SSH_HOST` to your own test machine before running remote tests. They create a unique `/tmp/diff-studio-test-*` directory on the server and remove it after testing. JSON test results and screenshots are written to `artifacts/`.

This is a text diff tool: supported files are UTF-8 (including BOM, CRLF, Unicode and empty files), up to 10 MB by default. Binary files and other encodings receive explicit errors. It is a two-way comparator, not a three-way merge resolver, image diff, or semantic AST comparison tool. Monaco includes many language colorizers and built-in JavaScript/TypeScript/JSON language support; arbitrary VS Code language extensions do not run inside its webview.

Implementation references: [Monaco diff editor options](https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IDiffEditorBaseOptions.html), [VS Code webviews](https://code.visualstudio.com/api/extension-guides/webview).

Opening a comparison with **Open comparison** collapses comparison setup after success, leaving more room for the diff. **Choose files / revisions** restores it with your previous values. Failed comparisons keep the setup visible for correction. Agent controls, session controls and settings remain available when setup is collapsed.

Mixed text/binary tree comparisons keep every changed path visible. A file whose contents cannot be captured is marked **Unavailable**; selecting it explains the reason and leaves the current diff intact. Supported text files still open and remain editable where applicable. Session archives preserve unavailable paths, statuses and reasons, but do not bundle their binary or unreadable contents. Compare again after correcting an encoding/read issue to refresh the tree.

Agent comparisons remain in **Files → File set → Agent files**, independently of the recent-history limit. The tree grows as the agent opens files; reopening the same source pair reuses the existing comparison and preserves unsaved edits/comments. Different baselines remain separate entries. **File set** also selects previously opened folder/branch/project trees. **Follow agent** controls automatic navigation: choosing a file or file set while connected pauses following, so background edits do not pull you away. Turn it back on to follow subsequent agent operations; an explicit agent `reveal` command still selects its requested file. Save session preserves the trees across extension runs.

The CLI now supports `project REPO [BASE=HEAD] [TARGET=WORKING]`, `folders LEFT RIGHT`, and `groups`. Project commands publish the complete changed-file hierarchy (including unavailable binary entries), without cycling the editor through every file. All supported compared files are retained in the session. Use explicit commit SHAs when requesting a new fixed Git baseline.

Inline comments have **Reply**, **Resolve**, and **Reopen** controls. Agent replies are labeled **Agent**; your replies are labeled **You**. The agent can use `comments [SESSION]`, `reply SESSION COMMENT_ID "text"`, `resolve SESSION COMMENT_ID`, and `reopen SESSION COMMENT_ID`; ordinary edit/save commands implement fixes. Replies and resolution states survive `.diff_studio` export/import. **Copy review request** in Files copies the current connection, full skill and a request to read and address unresolved comments. Paste it into your agent session; adding a comment alone does not start or notify an AI agent.
