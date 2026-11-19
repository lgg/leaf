# Leaf desktop implementation and release gates

**Fork version:** v1.10.0-lgg.1. Windows desktop source branch, not a published installer.

## Isolation and persistence

The production website and offline PWA use the original standalone editor HTML, and never load desktop-bridge.js, Rust, Tauri or a desktop bundle. The dependency-free desktop staging script copies the editor into desktop/dist, appends a desktop-only bridge and adds Save As. A generated Windows icon and the staged frontend are ignored by Git.

Desktop files can also be dropped from the OS, and the existing ZIP export uses a native destination picker. The desktop WebView intercepts external Markdown hyperlinks and opens only validated HTTP(S)/mailto targets through the OS, preventing accidental navigation away from the privileged editor. The Tauri backend permits drag/drop paths only after a genuine OS webview drop event, with a one-shot authorization registry. A frontend script cannot request an arbitrary absolute file path through the drag/drop command. The About panel can check the latest published GitHub release on demand (without downloading anything). The Tauri backend uses native OS dialogs for opening .md/.txt and saving to a user-chosen location. A SHA-256 content revision is checked before saving a previously opened file, preventing a silent overwrite after external changes. Writes use a temporary file in the destination directory. OS errors leave the draft intact. Rust commands store session tab order, paths, titles and recovery drafts in the application's own per-user config. Original CRLF line endings are preserved when a file is saved from the text editor. On restart, the on-disk version is read again, and differing unsaved drafts are offered for recovery. Missing files are shown as recoverable unbound drafts, not silently recreated.

No literal paths to the user's PC are stored in this repository. The GitHub Actions workflow is restricted to same-repository desktop/** pushes and trusted manual dispatch; it NEVER runs pull_request branches on a self-hosted machine. Logs avoid printing Cargo output that could contain absolute local paths.

## Release acceptance

Automated checks added (pending runner results):
- JavaScript regression suite and isolated desktop build staging
- Native Rust unit tests for safe file types, content revision, atomic writes and JSON sessions
- Windows release-mode build on the existing self-hosted leaf-runner-ci label
- Portable Windows ZIP using built-in PowerShell, with no installer packages downloaded
- Informational detection of Tauri CLI and NSIS availability; NSIS packaging remains disabled until all tools are verified

Real-device acceptance to complete before a public desktop release:
- [ ] Open via picker and drag-drop, edit and save a real .md/.txt file in its original folder
- [ ] Export all open Markdown documents as a ZIP through the native Save dialog
- [ ] Save As creates a new file and does not alter the old one
- [ ] Cancellation / permissions / read-only errors leave unsaved changes intact
- [ ] External edits are detected and protected from silent overwrite
- [ ] Tab order, custom titles, recovery drafts and missing files survive relaunch
- [ ] OS file association launches with passed document and installer opens
- [ ] Native close confirmation and recovery behave correctly
- [ ] Web and installed PWA work offline with no desktop payload
- [ ] Installer artifact verified on a clean Windows PC

Additional infrastructure before claiming signed in-app updates or macOS support:
- [ ] Secure Tauri updater signing keys and Windows code signing (never commit private secrets)
- [ ] Explicit safe update consent UI and signed feed
- [ ] macOS build runner and Apple Developer signing / notarization
- [ ] Confirm existing Tauri CLI + NSIS bundler toolchain and explicitly approve packaging. CI currently does not invoke NSIS to avoid automatic tool downloads

GitHub Releases is linked from About for manual downloads; unsigned automatic updates are intentionally not implemented.
