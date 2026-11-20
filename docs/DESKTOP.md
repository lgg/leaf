# Leaf desktop implementation and release gates

**Fork version:** v1.10.0-lgg.1. Windows desktop source branch, not a published installer.

## Isolation and persistence

Native document text and crash-recovery drafts are persisted through a local Rust session rather than duplicated in the WebView localStorage. Desktop window-close requests are intercepted before awaiting session persistence: repeated closes cannot dismiss the WebView while a recovery save is pending, and a failed save leaves the window open so it can be retried. Older preview drafts are imported once as unbound documents (Save As required) if no native session exists. The production website and offline PWA use the original standalone editor HTML, and never load desktop-bridge.js, Rust, Tauri or a desktop bundle. The dependency-free desktop staging script copies the editor into desktop/dist, appends a desktop-only bridge and adds Save As. A generated Windows icon and the staged frontend are ignored by Git.

Desktop files can also be dropped from the OS, and the existing ZIP export uses a native destination picker. The desktop WebView intercepts external Markdown hyperlinks and opens only validated HTTP(S)/mailto targets through the OS, preventing accidental navigation away from the privileged editor. The Tauri backend permits drag/drop paths only after a genuine OS webview drop event, with a one-shot authorization registry. A frontend script cannot request an arbitrary absolute file path through the drag/drop command. The About panel can check the latest published GitHub release on demand (without downloading anything). The Tauri backend uses native OS dialogs for opening .md/.txt and saving to a user-chosen location. A SHA-256 content revision is checked before saving a previously opened file, preventing a silent overwrite after external changes. A native write mutex serializes overlapping Save commands, so two simultaneous requests cannot both overwrite the same original revision. A second revision check runs after the temporary file is flushed and immediately before replacement to catch external edits made during the save operation. Writes use a temporary file in the destination directory. OS errors leave the draft intact. Rust commands store session tab order, paths, titles and recovery drafts in the application's own per-user config. Original CRLF line endings are preserved when a file is saved from the text editor. On restart, the on-disk version is read again, and differing unsaved drafts are offered for recovery. Missing files are shown as recoverable unbound drafts, not silently recreated. If a dirty draft's previous disk revision cannot be verified or the file changed externally, recovery detaches the draft from its old path and requires Save As; merely recovering the draft never authorizes overwriting the newer disk version.

No literal paths to the user's PC are stored in this repository. A previous unsigned CI preview executable contained embedded compiler paths; Windows release builds use Cargo encoded Rust path-remapping flags and a mandatory ASCII/UTF-16 path scan before any artifact upload. When compiler macros leave exactly one private Rust source-location string in unsigned read-only PE metadata, the build can perform a same-length string redaction (never executable code or signed binaries); it then runs the *unchanged* independent scanner. This is a privacy cleanup, not a substitute for running the app and testing file I/O. An unsafe binary fails CI and is not uploaded. The GitHub Actions workflow runs on same-repository `main` and `desktop/**` pushes plus trusted manual dispatch, verifying the exact merged production commit as well as pre-merge desktop commits. It NEVER executes untrusted `pull_request` code on the owner's self-hosted machine. The historical unsafe preview artifacts were deleted; their one-time cleanup job and its privileged `actions: write` permission have been removed. Logs avoid printing Cargo output that could contain absolute local paths.

## Release acceptance

Automated checks (all must be green for the exact source commit before any preview binary is approved):
- JavaScript regression suite and isolated desktop build staging
- Native Rust unit tests for safe file types, content revision, atomic writes and JSON sessions
- Windows release-mode build on the existing self-hosted leaf-runner-ci label
- Strict PE privacy gate with fail-closed source-metadata handling and independent whole-binary verification before artifact upload
- Portable Windows ZIP using built-in PowerShell, with no installer packages downloaded
- Informational detection of Tauri CLI and NSIS availability; NSIS packaging remains disabled until all tools are verified

Real-device acceptance to complete before a public desktop release (use synthetic Markdown files only, never private documents; old unsafe Windows CI artifacts were removed):
- [ ] Download EXE/portable ZIP only from a **fully green privacy-scanned** run on the same tested commit, then launch the standalone EXE on Windows 10/11
- [ ] Open via picker and drag-drop, edit and save a real .md/.txt file in its original folder
- [ ] Export all open Markdown documents as a ZIP through the native Save dialog
- [ ] Save As creates a new file and does not alter the old one
- [ ] Cancellation / permissions / read-only errors leave unsaved changes intact
- [ ] External edits are detected and protected from silent overwrite
- [ ] Tab order, custom titles, recovery drafts and missing files survive relaunch
- [ ] When an installer has been explicitly approved and produced, verify OS file association opens the passed document; portable EXE/ZIP can be accepted separately
- [ ] Native close confirmation and recovery behave correctly
- [ ] Web and installed PWA work offline with no desktop payload
- [ ] Installer artifact verified on a clean Windows PC

Additional infrastructure before claiming signed in-app updates or macOS support:
- [ ] Secure Tauri updater signing keys and Windows code signing (never commit private secrets)
- [ ] Explicit safe update consent UI and signed feed
- [ ] macOS build runner and Apple Developer signing / notarization
- [ ] Confirm existing Tauri CLI + NSIS bundler toolchain and explicitly approve packaging. CI currently does not invoke NSIS to avoid automatic tool downloads

GitHub Releases is linked from About for manual downloads; unsigned automatic updates are intentionally not implemented.
