# Leaf — distraction-free Markdown editor

**Fork version: v1.11.2-lgg.1** · Based on [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf) v1.7 · Maintained by [lgg](https://github.com/lgg).

Leaf is a focused, offline-capable Markdown and plain-text editor. It runs as a lightweight, single HTML file in a browser, installs as a PWA on phones, and has an **independent Tauri v2 desktop edition** that can edit real files on disk. No account, sync server, analytics or unnecessary background process.

**[Open Leaf in your browser](https://lgg.github.io/leaf/editor.html)** · **[Desktop downloads and release notes](https://github.com/lgg/leaf/releases)** · [Source repository](https://github.com/lgg/leaf)

> **Windows 10/11 x64 early-access release candidate:** Windows portable ZIP and user-scoped Setup EXE are published after successful automated Windows checks. Manual GUI acceptance is tracked separately; the downloads are unsigned prerelease builds.

## Web editor and mobile PWA

- **Browser:** open [editor.html](https://lgg.github.io/leaf/editor.html). The standalone `editor.html` can also be downloaded and opened locally without a build step.
- **iPhone/iPad:** Safari → Share → Add to Home Screen; select **Open as Web App** if offered.
- **Android:** Chrome → **Install app** or **Add to Home Screen**.
- **Offline:** load once with internet, let the service worker cache the editor, then reopen without internet. Web fonts may fall back to bundled/system fonts.
- **Data:** browser drafts and preferences live in that browser's own localStorage; they do not synchronize across devices. Export important Markdown files for durable backups.

### Distraction-free mobile layout

On phones and touch tablets, Leaf hides the desktop header, tabs and status bar by default. Tap the lower edge to reveal a four-action dock; it hides automatically after roughly four seconds. **Docs** switches/creates/closes documents, **View** toggles preview, **Save** exports the active document, and **More** offers Open, Export all, Settings, Focus and About. Under **Settings → Editor → Mobile display**, you may show the document heading/status bar or keep the dock visible. Safe-area padding and on-screen keyboard placement are accounted for.

The PWA has source-level automated regression tests. Final physical-device verification of iOS/Android install, offline behavior, rotation and keyboards is still a separate manual acceptance step.

## Settings: six tabs and separate typography

Settings contains **Current document**, **Appearance**, **Status bar**, **Editor**, **Mobile display**, and **About** tabs. The About tab has a saved checkbox to control whether the welcome window appears at startup; automatic welcome is opt-in on all editions. The toolbar About button always remains available. Appearance begins with the independent focus-mode top-bar auto-hide preference, then themes/colors and separate **interface font/size**. The **editor font/size** controls live in Editor. Both have an exact positive-integer pixel input, styled Save button and 6–128px slider; typing a larger value keeps it exactly while the slider clamps visually. Settings survive restarts without mixing editor and UI fonts.

## Desktop edition — Windows (Tauri v2)

- **Themed frameless titlebar:** desktop-only window frame uses Leaf's selected background/text colors with its app icon and native **minimize**, **maximize/restore**, and **close** controls. Drag the header to move the window, or double-click to toggle maximize. The **Close** button follows the existing unsaved-draft/session-recovery protection. Focus mode hides this caption; Escape restores it. The standalone web editor and PWA retain their original page layout.

Leaf desktop uses the **same editor** with a small, separate Rust/Tauri layer. The web page and PWA **do not load any Tauri scripts, Rust binaries or desktop dependencies**. Desktop builds use the OS WebView (WebView2 on Windows), not an Electron/Chromium bundle.

- **Open** existing `.md` / `.txt` files through the native OS picker; `Ctrl+O` works too.
- **Save** (`Ctrl+S`) writes **back to the original file** after checking that it has not changed outside Leaf.
- **Save As** (`Ctrl+Shift+S`) chooses a new destination with the native OS dialog.
- Native saves preserve standard Windows CRLF line endings when the original file used CRLF.
- An interrupted or failed save retains the unsaved editor text; a disk-conflict warning never silently overwrites external changes.
- The early-access Windows setup adds a Start menu shortcut and an Apps & features uninstall entry. It does not change default `.md` / `.txt` file associations; File associations and Explorer Open with integration are intentionally out of scope; use the native in-app Open dialog or drag and drop.
- Tabs, order, custom labels and per-document titles persist in local app settings. Unlike the web/PWA, desktop file text is not duplicated into browser localStorage; recovery drafts live in the native session. On restart, Leaf reads real files again from disk. Unsaved drafts can be recovered explicitly; missing files become recovery drafts that must be saved to a new location.
- Drag and drop existing Markdown/text files onto the desktop window; only actual OS-dropped paths are authorized. Export all documents as a native ZIP file.
- **Opt-in Windows updates (portable and installed):** Leaf checks official GitHub Releases, including prereleases, once at startup and on request in Settings → About. New versions show release notes and a download button. Only on separate user approvals does the bundled Windows helper download the official ZIP/Setup, verify SHA-256 and asset size, save recovery drafts, then replace/restart portable Leaf or launch per-user Setup after exiting. No silent downloads or forced installation.
- Web/email links in Markdown previews open in the OS default application; unsafe link schemes are rejected.
- File operations are restricted to text extensions and exposed through explicit native commands. The browser/PWA remains sandboxed.

**Limits:** The desktop edition currently targets **Windows**. Preview updates are verified through official GitHub HTTPS and the asset's SHA-256, not a separate publisher's digital signature. A separate signed Tauri updater is not planned; the current explicit user-approved GitHub Releases updater is the supported Windows update flow. The current per-user Setup is unsigned. The updater uses built-in Windows PowerShell/.NET; no tools are installed on the Windows build runner.

### Build with already-provisioned Windows tools

The GitHub Actions workflow uses **only** the existing self-hosted runner with label `leaf-runner-ci`; it has no system-package, Rust-toolchain, Node or Docker installation steps. The workflow checks tool availability and does not print local PC paths intentionally.

For manual builds, with Node.js, Rust/Cargo, Microsoft C++ build tools and Windows WebView2 prerequisites already present:

```powershell
node --test tests/leaf.test.cjs tests/desktop.test.cjs
node desktop/stage.cjs
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --release --manifest-path src-tauri/Cargo.toml
```

The Windows executable is produced under the Rust target output (not committed). CI remaps local Rust/Cargo source directories and rejects generated executables that still expose user or runner paths (including UTF-16). A fail-closed, length-preserving sanitizer can redact **one** unambiguous Rust `.rs` source-location string from unsigned PE read-only data; it refuses ambiguous paths, executable code sections and signed files. The independent strict binary privacy scan must still pass after this step. Treat test artifacts as unaccepted previews until the manual Windows GUI checklist is complete. CI uses built-in Windows PowerShell to produce a portable ZIP and a separate unsigned graphical installer compiled with the already-present .NET Framework C# compiler. The installer verifies an embedded SHA-256 fingerprint before copying the app into the user's local application data, adding a Start menu shortcut and registering user-scoped uninstall. Neither new system tools nor an administrative installation are required. Optional NSIS packaging remains blocked until the complete existing NSIS/Tauri toolchain is verified. The desktop staging directory and generated Windows icon are ignored by Git.

Builds can download normal Cargo dependency crates during compilation; the workflow never installs or upgrades system software or toolchains. Cargo may need network access for a first build.

## Editor features shared across browser, PWA and desktop

- Focused Markdown writing and preview; configurable themes, black mode, fonts and exact positive-integer pixel sizes (from 1px upward), with a separate visually clamped slider from 6–128px.
- Styled Choose File button without the native file-picker input showing in the toolbar.
- Independent persistent focus-mode setting for auto-hiding the whole top bar, with top-edge hover reveal.
- Five independently toggleable status counters and optional empty-page hint.
- Multiple document tabs with **independent filename, tab label and window title**.
- Debounced autosave of browser drafts (350 ms / maximum 2 s while typing), local recovery copies and protection against simultaneous browser workspaces.
- Export active Markdown/text documents or a ZIP of all editable tabs.
- Keyboard shortcuts, settings persistence, focus / Just Write modes.

For deeper implementation notes, see [desktop architecture](docs/DESKTOP.md), [settings audit](docs/SETTINGS_AUDIT.md) and [changelog](CHANGELOG.md). Settings → About includes both repositories, a Star on GitHub action, Windows updates and an opt-in startup welcome-window toggle. The welcome window also retains credits, repositories, version and downloads. The window can always be opened manually using ··· About.

## Verification and release policy

Run `node --test tests/leaf.test.cjs tests/desktop.test.cjs` to exercise the dependency-free web regression suite and the desktop integration checks. The Windows runner separately runs Rust unit tests and an actual release-mode build. A successful compile does **not** replace manual checks of OS dialogs, disk conflicts, recovery, file associations and installer behavior. Desktop release publication remains gated on verified artifacts and the remaining signing / platform decisions.

## Credits

**Original Leaf by Dan** — [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf). **Fork updated by lgg** — [lgg/leaf](https://github.com/lgg/leaf). This is an independent fork, not the original author's deployment.
