---
name: diff-studio
description: Show and explain file changes in the user's running Diff Studio VS Code extension using its agent bridge. Use when the user supplies Diff Studio connection instructions or asks to present edits or reviews in Diff Studio.
---

# Diff Studio

Use the bridge and CLI paths supplied in the connection handoff. This skill is bundled with the extension; reading it is sufficient for this session. Node.js 18+ must be available on the machine running the extension host. The loopback connection and descriptor belong to that machine, including when VS Code runs in Remote SSH, WSL or a container. Do not substitute a different machine's localhost.

## Start and choose a comparison

Run the handoff's startup command (`list`). Its JSON output is the current authority for session IDs, source paths, text, hashes, dirty state, writability, comments and activity. Reuse a relevant comparison with `reveal SESSION`; otherwise open one for the user's requested files. A connection handoff is setup context, not an additional editing task. If no task was supplied, inspect the connection and ask what the user wants to change or review.

Every command uses `node CLI_PATH --bridge DESCRIPTOR_PATH COMMAND ...`, with paths safely quoted for the shell. Use absolute paths. Read `--help` for the full CLI reference. Commands return JSON; take the session `id` from the result, not a guessed filename.

| Command and arguments | Effect |
| --- | --- |
| `list` | Read all current comparisons and their full buffers. |
| `highlights` | List named highlight groups, ranges, colors, comment IDs and changed-range flags. |
| `highlight JSON_FILE [--reveal]` | Create or update a named group of line ranges across comparisons; see Highlight specific lines below. |
| `highlight-reveal GROUP_ID [RANGE_ID]` | Explicitly navigate to the range, including while Follow agent is paused. |
| `highlight-remove GROUP_ID` | Remove that group and its colors; keep the discussion threads. |
| `groups` | List persistent file trees with session IDs and unavailable-file reasons. |
| `reset [--discard]` | Clear comparisons, trees, comments and history while keeping the bridge connected. Refuses to discard edits, comments or highlights without `--discard`. |
| `changes JSON_FILE [--replace]` | Publish a custom list: `{"label":"Review","comparisons":[{"path":"src/file.ts","left":SOURCE,"right":SOURCE}]}`. Use the source schema below. |
| `project REPO [BASE=HEAD] [TARGET=WORKING]` | Publish the project's changed-file tree. Use branches, commits, or INDEX as revisions; WORKING makes current files editable. |
| `folders LEFT RIGHT` | Publish all changed files from two local or SSH folders. |
| `comments [SESSION]` | Read all review threads (or one session), including IDs, side, line, anchor, replies, outdated and resolved state. |
| `reply SESSION COMMENT_ID "Reply"` | Append an agent reply to the original thread. |
| `resolve SESSION COMMENT_ID` | Mark an addressed thread resolved. |
| `reopen SESSION COMMENT_ID` | Mark a thread unresolved again. |
| `open LEFT RIGHT` | Show two files, local paths or `ssh://host/absolute/path`. Both existing files can be writable. |
| `git REPO FILE REF` | Compare a Git revision to its editable working file; FILE is repository-relative. |
| `revisions REPO FILE LEFT_REF RIGHT_REF` | Compare two read-only Git revisions. |
| `request JSON_FILE` | Open a custom comparison using the source schema below. |
| `reveal SESSION` | Display an existing comparison in VS Code. |
| `note SESSION "Explanation"` | Show a concise explanation in Agent & activity. |
| `edit SESSION left\|right CONTENT_FILE "Explanation"` | Replace the selected writable buffer with the full UTF-8 contents of CONTENT_FILE and display the edit. Does not save to the source file. |
| `comment SESSION left\|right LINE "Comment"` | Add an inline comment at a 1-based line on that side. |
| `comment-remove SESSION COMMENT_ID` | Remove an existing comment. |
| `save SESSION left\|right` | Write that buffer to its source file, with conflict checks. |
| `reload SESSION` | Refresh from sources; refuses to discard unsaved edits. |

## Make changes visible

When the user asks to see a **different review**, use `project REPO BASE TARGET --replace`, `folders LEFT RIGHT --replace`, or `changes JSON_FILE --replace`. This replaces Agent files and explicitly shows the new tree and first supported comparison even if Follow agent is paused. Previous comparisons, dirty buffers, and comments remain in Session; an empty replacement clears the editor and shows an empty file list. `--replace` also works with `open`, `git`, `revisions`, and `request` for a new single-file review. Do not use it on every background edit, since it intentionally changes the user's view. Without it, opening files continues to accumulate comparisons and respect paused navigation.

Use `reset` only when the user requests a fresh session. It leaves disk files, saved `.diff_studio` archives, settings and the current bridge descriptor intact, and restores Follow agent. Old comparison IDs become invalid: run `list` and use IDs from newly opened comparisons. If reset reports edits or comments, ask the user to save the session or confirm discarding them; use `--discard` only when that loss is explicitly authorized. The UI Reset session button offers Save session and reset, Reset session, and Cancel. Prefer `--replace` when the user only wants a new displayed list.

Before editing, inspect the current buffers and preserve unrelated user changes. Explain the intended change with `note`, then use `edit` to show the proposed full contents in the writable pane. Every file opened by the agent accumulates in the Files tab under **Agent files**, independent of recent history. Use `project` or `folders` for a project review instead of opening and rapidly cycling through every file. The File set selector lets the user return to previous trees. Opening the same source pair reuses its buffers and comments. For a different Git baseline, use an explicit commit SHA. The user can pause **Follow agent**; choosing a file pauses it automatically. Continue editing without forcing navigation while they review. Reserve `reveal` (which explicitly switches the current file even while following is paused) for a user-requested view or a relevant final handoff, not after every edit. Add line comments when they clarify a specific change. Do not claim that the bridge displays hidden reasoning or every keystroke: it displays the edits and explanations you explicitly send.

For Git, use `git` when the requested baseline is a commit. To show only your upcoming changes, including in a non-Git file or a file with existing edits, first capture the current contents in an immutable text source and pair it with the working file. A `request` JSON file has this shape:

```json
{
  "title": "Before agent changes ↔ working file",
  "left": {"kind": "text", "label": "Before agent changes", "text": "EXACT ORIGINAL CONTENTS", "language": "typescript"},
  "right": {"kind": "file", "uri": "/absolute/path/file.ts", "allowMissing": true}
}
```

Create JSON with a serializer so source text and paths are preserved exactly. Use the existing session buffer as the baseline when it contains unsaved user edits. A file source supports SSH URIs; a Git source is `{"kind":"git","repo":"/absolute/repo or ssh://host/repo","path":"src/file.ts","ref":"HEAD"}`. `allowMissing` supports creating a new file. Binary files and text exceeding the extension's configured size limit are unsupported. Archived snapshots and Git revisions remain read-only; choose a writable working file for edits.

Save when the user's task authorizes applying the changes. If they requested a preview or review before applying, leave the buffer unsaved and explain that. For authorized implementation, save before running tests that read files from disk. Finish by revealing the relevant comparison and reporting what changed and what was verified. The user can export all comparisons and comments with Save session; the bridge does not currently provide an archive export command.

The CLI fetches the latest hash before sending an edit, and the bridge rejects races during that update. Still inspect changes made since your earlier read before replacing a whole buffer. On a stale-buffer or disk-conflict error, reread and reconcile the user changes; do not force a reload or overwrite them. If the connection stops, request a fresh handoff from Connect agent → Agent ready · Copy instructions. Do not scan for other sessions' credentials. The handoff contains a descriptor path, not the bearer token; do not print or copy that token into chat.

## Highlight specific lines

For a focused review inside an existing project diff, use `groups` / `list` to find the comparison IDs and inspect **both current buffers**. Keep the complete comparison and publish named groups into **Files → Agent highlights**. Do not create cropped text copies, guess line numbers from a different revision, or cycle through files automatically. Coordinates are 1-based and inclusive, on the specified side. Git and bundled snapshots can be highlighted without making them writable.

Write a JSON file with a serializer, then run `highlight /absolute/highlights.json`. For example:

```json
{
  "label": "Validation changes",
  "color": "#e5a84b",
  "ranges": [
    {"sessionId": "ID_FROM_LIST_FOR_FILE_A", "side": "left", "startLine": 12, "endLine": 16, "label": "Previous validation", "comment": "This branch did not check the empty value."},
    {"sessionId": "ID_FROM_LIST_FOR_FILE_B", "side": "right", "startLine": 30, "endLine": 34, "label": "New validation", "color": "#67b7ef", "comment": "The new check rejects empty values before dispatch."}
  ]
}
```

Use additional groups for separate concerns: five two-line ranges mark ten lines across five files; two ten-line ranges mark twenty lines across two other files. Group colors and optional per-range overrides must be six-digit hex values (`#RRGGBB`). Labels explain the meaning without relying on color alone. `comment` creates an ordinary agent thread at the range's first line; use `comments`, `reply`, and `resolve` to discuss or fix it. You may instead supply `commentId` to attach an existing thread on the same comparison and side. Never supply both fields.

Publishing a group does not move the user's view. Add `--reveal` only when you intend to show the first range, or later use `highlight-reveal GROUP_ID RANGE_ID`. Explicit navigation pauses Follow agent and selects the correct file, side and range. The user can revisit every range from the sidebar. Keep using the original comparison IDs for edits.

To update a group, include its returned `id` in the JSON and the complete replacement `ranges` list. Use existing `commentId` values to retain thread associations; sending `comment` again creates a new thread. Updates return fresh range IDs. Removed or replaced highlights never delete user discussions. Edits before an untouched range shift its coordinates; edits through it mark `outdated: true` and show **Changed since highlight**. Inspect and republish accurate ranges after such edits rather than presenting them as verified locations. Save session includes all groups, colors, ranges and threads and supports offline reopening. Reset clears highlights as well, so highlight-only reviews require explicit discard authorization too.

## Address review comments

When the user pastes a **Copy review request** handoff or asks you to address comments, run `comments` to read unresolved threads and `groups` / `list` to map them to the existing comparisons. Read replies and inspect the current code, especially when `outdated` is true. Apply the requested fix through the existing session, verify it, and use `reply` to explain the change or why a fix is not appropriate. Resolve a thread only after its request is addressed and verified; leave questions or blocked fixes unresolved. Never delete or replace the user's comment to simulate replying. The user can reply or reopen threads in the UI. Replies and resolution state are included in Save session archives. Comments do not automatically launch or notify a Codex session; read them when the user asks or at an agreed review checkpoint.
