# Changelog

## 1.2.0

- Add named agent highlight groups spanning line ranges across files, with custom colors, inline discussion threads, and a separate Files section.
- Add highlight creation, update, navigation and removal commands to the agent CLI and copied skill.
- Preserve highlights in portable session archives, track line shifts, and flag ranges changed by edits.

## 1.1.2

- Put comparison setup first, color agent connection controls, and combine Agent ready with Copy instructions.
- Add View session to Manage session, including revealing an auto-hidden sidebar.
- Show full names and control descriptions after a half-second hover.

## 1.1.1

- Group Open session, Save session, Reset session and Link repository in a keyboard-accessible Manage session menu. Keep the session comparison count visible beside it.

## 1.1.0

- Add Reset session with save-first and cancel options. Clear comparisons, comments, history and editor state while keeping the agent connected.
- Add agent `reset`, custom `changes` lists, and `--replace` to show a different review even when Follow agent is paused.
- Refresh reused clean comparisons and retain dirty buffers and comment threads. Prevent earlier in-flight captures from reappearing after reset.

## 1.0.0

- Rename the extension to **Diff Studio Pro** with package ID `diff-studio-pro`.

- Set the Marketplace publisher to `KUNU` and release version to `1.0.0`.

## 0.5.2

- Added an animated Marketplace walkthrough of folder comparison, file navigation, comparison setup visibility, and sidebar auto-hide, hover reveal, and pinning.

## 0.5.1

- Reworked the Marketplace page around agent-assisted project reviews, with a step-by-step guide and practical prompts for Git, refactoring, SSH, folders, comments, and portable sessions.
- Added four screenshots captured from the real extension with sample data.
- Set the Marketplace publisher to `N7K5` and added the listing icon, repository link, and issue tracker.
- Retained the detailed usage guide in `docs/REFERENCE.md`.

## 0.5.0

- Keep agent-opened comparisons in a persistent Agent files tree and publish full Git project or folder comparisons through the bridge.
- Select previous trees with File set and pause automatic navigation with Follow agent.
- Read, reply to, resolve, and reopen comment threads through the UI and agent CLI.
- Copy a complete review request for the agent, and preserve trees and discussions in saved sessions.

## 0.4.3

- Keep binary and unsupported files from blocking an entire tree comparison. Preserve unavailable entries and their reasons in saved sessions.

## 0.4.2

- Copy complete agent connection details and the bundled skill. Collapse comparison setup after a successful open.

## 0.4.1

- Add a resizable sidebar, compact tree indentation, and improved hover auto-hide behavior.

## 0.4.0

- Add inline comments and portable `.diff_studio` sessions with bundled file snapshots and optional repository linking.
