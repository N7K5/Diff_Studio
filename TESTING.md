# Verification results

## Version 0.5.0: persistent agent file trees and review threads

The integration suite has 47 passing tests. New coverage includes concurrent/deduplicated file opens, separate baselines for the same path, persistent accumulated trees, Git project/folder publication, preservation of dirty reviewed buffers, comment reads/replies/fixes/resolution, invalid reply validation and portable discussion archives. The installed desktop suite exercises 64 checks, including manual navigation during agent updates, the Follow agent control, File set selection, user/agent replies, resolving/reopening threads, Copy review request and saved-tree restoration. Evidence: `artifacts/v050-unit.log` and `artifacts/v050-package-ui.json`. The bundled skill validates and documents the new commands. No live SSH rerun is claimed.

## Version 0.4.3: isolate unavailable files in comparison trees

All 44 integration tests and 59 desktop UI checks pass with no page errors. Mixed Git trees retain binary modifications, additions, deletions, renames and text/binary conversions without blocking readable text, across revision/revision, revision/working, branch and staged comparisons. Folder scans isolate per-file read/size failures; tests include oversized binary files and invalid UTF-8. Selecting an unavailable entry preserves the current diff. Portable archives retain unavailable paths/statuses/reasons, including all-binary groups, and restore readable snapshots without sources. Evidence: `artifacts/v043-unit.log`, `artifacts/v043-ui.json`, and installed-package report `artifacts/v043-package-ui.json`. Binary/unreadable contents are not stored as fake text snapshots. No new live SSH run is claimed.

## Version 0.4.2: complete agent handoff and comparison setup controls

All 41 integration tests and 56 real VS Code UI checks pass with no page errors. The copied handoff includes the complete validated bundled skill, installed script paths, connection context and a startup command. Tests execute that command and use fresh CLI processes to inspect, open, explain, preview, comment and save changes visibly. They verify no token is embedded, quoting of paths containing shell characters, invalidation after disconnect, absence of a stale connection banner, successful comparison setup collapse, restoration with retained inputs, and keeping failed comparisons open for correction. Evidence: `artifacts/v042-unit.log`, `artifacts/v042-ui.json`, and installed-package checks in `artifacts/v042-package-ui.json`. The UI test restores the previous clipboard contents. SSH checks in this run use the fixture transport; no new live SSH result is claimed.

## Version 0.4.1: compact tree and resizable sidebar

All 40 integration tests and 53 real VS Code UI checks pass with no page errors. New regressions verify six-pixel tree indentation, the hamburger auto-hide toggle and saved setting, hiding after clicks on files/tabs/the filter, keyboard focus navigation, dragging both the pinned sidebar and hover overlay, width persistence, keyboard resizing, and the width setting. Evidence: `artifacts/v041-unit.log`, `artifacts/v041-ui.json`; installed-package verification is recorded in `artifacts/v041-package-ui.json`. This release does not claim a new live SSH run.

## Version 0.4.0: line comments and portable session archives

The integration suite has 40 passing tests, including comments on both sides, edits/deletion, line-anchor movement, full archive round trips with unsaved buffers, snapshots of unclicked changed files, import with source access disabled, matching-repository linking, missing commits/content mismatches, containment/symlink/Git-metadata protections, schema/checksum validation, and agent comment commands.

Seven focused desktop checks exercise the hover gutter, in-code comment blocks, editing/deletion, inline/focused/side-by-side layouts, Save/Open session dialogs, offline annotations and invalid-file recovery. Evidence: `artifacts/v040-unit.log` and `artifacts/v040-focused-ui.json`. Fresh-process offline and installed-package reports are recorded separately in `artifacts/v040-reopen-ui.json` and `artifacts/v040-package-ui.json`. The reopening test moves all original fixture roots away before opening the saved archive in another extension process. The full installed-package suite passes 49 UI checks with no page errors. Four additional checks in `artifacts/v040-remote-archive.json` create a real Oracle VM comparison, archive its unsaved edits and comment, remove the source file, and reopen without SSH. The broader 0.3.0 SSH results below remain historical.


## Version 0.3.0: recent history, file tree and SSH browsing

The local/Git/agent suite has 35 passing tests. The source VS Code UI suite has 42 passing checks with no page errors, including bounded recent history, reopening and deduplication, removing entries, disabling history while retaining unsaved buffers, tab keyboard navigation, nested file trees, SSH folder/file selection, remembered VM limits/removal, failed connections and switching back to local browsing.

Deterministic SSH browser tests run the production remote Python payload against isolated local fixtures through a test-only SSH executable. They do not prove live connectivity. Live service checks on the supplied Oracle VM are recorded separately in `artifacts/v030-remote.json`; the installed-package UI report is `artifacts/v030-package-ui.json`, and marks its live checks explicitly. Unit/source evidence: `artifacts/v030-unit.log` and `artifacts/v030-ui.json`.


## Version 0.2.0: revision browsing and configurable panels

The local/Git/agent suite has 30 passing tests, including dated commit metadata, branches and tags, pagination, path-filtered history and input validation. The VS Code UI suite has 33 passing checks with no page errors. New checks exercise the Activity Bar icon, repository-relative file picker, both revision dropdowns, newest/oldest ordering, working-file switching, the branch-mode dropdown, sidebar reveal by hover and keyboard focus, top/bottom hide and restore controls, and persistent visibility settings. Evidence: `artifacts/v020-unit.log` and `artifacts/v020-ui.json`. Prior version results below are historical; this update does not claim a new live SSH pass.

## Version 0.1.1: Git path and folder regression fix

The original tests missed submitting a repository with no file path and actually accepting picker selections. The regression suite now covers full local paths and file URIs, blank paths, full repository paths, subfolders, paths outside the repository, two explicit folder revisions, index comparisons, and SSH path normalization. It contains 28 local/Git/agent tests. The real VS Code UI suite has 25 checks, including accepting file, folder and repository selections (not just cancelling the dialogs). Current reports are `artifacts/path-fix-unit.log` and `artifacts/vscode-test.json`.

The SSH suite now includes remote repository URI selection, full SSH file selection and file enumeration for the remote picker. The 0.1.1 live rerun was blocked because `phoenix773679.private1.oaceng02phx.oraclevcn.com` could not be resolved, including on a separate SSH connectivity retry. No remote fixture was created in that attempt. `artifacts/remote-test.json` is the earlier successful 0.1.0 result, not evidence of a fresh 0.1.1 remote pass. SSH path normalization is covered by the local regression tests. The reports below describe the original 0.1.0 baseline.

## Version 0.1.0 baseline

Verified on 1 October 2026 (India time), using VS Code 1.131.0 on macOS arm64.

| Suite | Result | Evidence |
| --- | --- | --- |
| TypeScript validation and production bundle | Passed | `artifacts/unit-test.log` |
| Local, Git, filesystem and agent integration | 21 passed, 0 failed | `artifacts/unit-test.log` |
| Real VS Code UI, including live SSH files | 20 checks passed; no page errors | `artifacts/vscode-source-test.json` |
| UI loaded from the installed VSIX | 19 checks passed; no page errors | `artifacts/vscode-package-test.json` |
| Live SSH service integration | 7 checks passed | `artifacts/remote-test.json` |
| Dependency audit | 0 reported vulnerabilities | `artifacts/dependency-audit.json` |
| VSIX installation | Passed in an isolated profile | `artifacts/verification.json` |

The SSH tests used `phoenix773679.private1.oaceng02phx.oraclevcn.com`. They created temporary files, compared local/remote and remote/remote content, edited both remote panes, saved and read back their contents, detected external-write conflicts, compared directories, and compared remote Git history with the working tree. Temporary remote fixtures were removed afterward. The remote UI screenshot is `artifacts/vscode-remote.png`.

Git fixtures include a `master` branch, a feature branch, two commits, a rename with spaces in its name, a deletion, a new file, staged content, unstaged content and an untracked file. Tests cover base auto-detection, explicit base revisions, merge-base comparison, index content, committed-only review and working-tree review.

UI coverage includes source modes, comparison opening, settings and persistence, all four layouts, previous/next, syntax-language selection, real keyboard edits and both save buttons, swap, reload, activity collapse/expand, folder filtering, changed-file selection, history selection, session switching, native diff opening, browse-dialog invocation/cancellation, agent connect/disconnect and recovery after a missing-file error. Unicode, UTF-8 BOM and CRLF were checked through actual editor changes and saved-file readback.

The agent CLI was executed against a live authenticated bridge. Tests verify buffer updates before saving, explicit saves, intent messages, stale-hash rejection, browser-origin rejection, bearer authentication and credential-file cleanup. Filesystem tests cover concurrent saves from two sessions, symlink preservation, file modes, empty/missing files, parent-folder creation, external updates and dirty-buffer preservation.

This is a finite regression matrix for the supported UTF-8 two-way comparison workflows. It does not establish correctness for every operating system, SSH configuration or file format. Only the supplied remote host was available; two separate remote hosts were not independently exercised. Browse dialogs were opened and cancelled by automation. Binary files and invalid UTF-8 are deliberately rejected, and three-way merges are outside this extension's scope. See `README.md` for operational limits and commands to rerun the suites.

The packaged bundle is `artifacts/diff-studio.vsix`; its SHA-256 and combined results are recorded in `artifacts/verification.json`.
