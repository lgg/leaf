# Leaf — distraction-free Markdown editor

**Fork version: v1.10.0-lgg.1** · Based on [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf) v1.7 · Maintained by [lgg](https://github.com/lgg).

Leaf is a focused, offline-capable Markdown and plain-text editor. It runs as a lightweight, single HTML file in a browser, installs as a PWA on phones, and has an **independent Tauri v2 desktop edition** that can edit real files on disk. No account, sync server, analytics or unnecessary background process.

**[Open Leaf in your browser](https://lgg.github.io/leaf/editor.html)** · **[Desktop downloads and release notes](https://github.com/lgg/leaf/releases)** · [Source repository](https://github.com/lgg/leaf)

> Desktop release assets appear on GitHub Releases only after the Windows build and functional checks pass. The desktop source may be ahead of published release downloads.

## Web editor and mobile PWA

- **Browser:** open [editor.html](https://lgg.github.io/leaf/editor.html). The standalone `editor.html` can also be downloaded and opened locally without a build step.
- **iPhone/iPad:** Safari → Share → Add to Home Screen; select **Open as Web App** if offered.
- **Android:** Chrome → **Install app** or **Add to Home Screen**.
- **Offline:** load once with internet, let the service worker cache the editor, then reopen without internet. Web fonts may fall back to bundled/system fonts.
- **Data:** browser drafts and preferences live in that browser's own localStorage; they do not synchronize across devices. Export important Markdown files for durable backups.

### Distraction-free mobile layout

On phones and touch tablets, Leaf hides the desktop header, tabs and status bar by default. Tap the lower edge to reveal a four-action dock; it hides automatically after roughly four seconds. **Docs** switches/creates/closes documents, **View** toggles preview, **Save** exports the active document, and **More** offers Open, Export all, Settings, Focus and About. Under **Settings → Editor → Mobile display**, you may show the document heading/status bar or keep the dock visible. Safe-area padding and on-screen keyboard placement are accounted for.

The PWA has source-level automated regression tests. Final physical-device verification of iOS/Android install, offline behavior, rotation and keyboards is still a separate manual acceptance step.

## Desktop edition — Windows (Tauri v2)

Leaf desktop uses the **same editor** with a small, separate Rust/Tauri layer. The web page and PWA **do not load any Tauri scripts, Rust binaries or desktop dependencies**. Desktop builds use the OS WebView (WebView2 on Windows), not an Electron/Chromium bundle.

- **Open** existing `.md` / `.txt` files through the native OS picker; `Ctrl+O` works too.
- **Save** (`Ctrl+S`) writes **back to the original file** after checking that it has not changed outside Leaf.
- **Save As** (`Ctrl+Shift+S`) chooses a new destination with the native OS dialog.
- Native saves preserve standard Windows CRLF line endings when the original file used CRLF.
- An interrupted or failed save retains the unsaved editor text; a disk-conflict warning never silently overwrites external changes.
- File associations register Markdown and plain text with the Windows installer. File paths passed at launch can be opened on startup.
- Tabs, order, custom labels and per-document titles persist in local app settings. Unlike the web/PWA, desktop file text is not duplicated into browser localStorage; recovery drafts live in the native session. On restart, Leaf reads real files again from disk. Unsaved drafts can be recovered explicitly; missing files become recovery drafts that must be saved to a new location.
- Drag and drop existing Markdown/text files onto the desktop window; only actual OS-dropped paths are authorized. Export all documents as a native ZIP file.
- Check published GitHub releases from the desktop About panel on demand; review release notes and download manually. No forced updates.
- Web/email links in Markdown previews open in the OS default application; unsafe link schemes are rejected.
- File operations are restricted to text extensions and exposed through explicit native commands. The browser/PWA remains sandboxed.

**Limits:** The desktop edition currently targets **Windows**. A signed unattended updater, macOS signing/notarization and macOS CI require separate signing credentials / an appropriately provisioned macOS runner. No automatic download or forced update is enabled: use the GitHub Releases link to review downloads and release notes manually.

### Build with already-provisioned Windows tools

The GitHub Actions workflow uses **only** the existing self-hosted runner with label `leaf-runner-ci`; it has no system-package, Rust-toolchain, Node or Docker installation steps. The workflow checks tool availability and does not print local PC paths intentionally. It checks each `desktop/**` push and the exact merged `main` commit; it cannot run on an untrusted `pull_request` event. Previously unsafe CI artifacts were removed, and the one-time privileged cleanup job is no longer part of recurring builds.

For manual builds, with Node.js, Rust/Cargo, Microsoft C++ build tools and Windows WebView2 prerequisites already present:

```powershell
node --test tests/leaf.test.cjs tests/desktop.test.cjs
node desktop/stage.cjs
cargo test --manifest-path src-tauri/Cargo.toml
cargo build --release --manifest-path src-tauri/Cargo.toml
```

The Windows executable is produced under the Rust target output (not committed). CI remaps local Rust/Cargo source directories and rejects generated executables that still expose user or runner paths (including UTF-16). A fail-closed, length-preserving sanitizer can redact **one** unambiguous Rust `.rs` source-location string from unsigned PE read-only data; it refuses ambiguous paths, executable code sections and signed files. The independent strict binary privacy scan must still pass after this step. Treat test artifacts as unaccepted previews until the manual Windows GUI checklist is complete. CI uses built-in Windows PowerShell to produce an additional portable ZIP — no installer dependencies are downloaded. NSIS installer creation is intentionally disabled until the complete existing NSIS/Tauri toolchain is verified, because Tauri may download missing bundler components. The desktop staging directory and generated Windows icon are ignored by Git.

Builds can download normal Cargo dependency crates during compilation; the workflow never installs or upgrades system software or toolchains. Cargo may need network access for a first build.

## Editor features shared across browser, PWA and desktop

- Focused Markdown writing and preview; configurable themes, black mode, fonts and font size.
- Five independently toggleable status counters and optional empty-page hint.
- Multiple document tabs with **independent filename, tab label and window title**.
- Debounced autosave of browser drafts (350 ms / maximum 2 s while typing), local recovery copies and protection against simultaneous browser workspaces.
- Export active Markdown/text documents or a ZIP of all editable tabs.
- Keyboard shortcuts, settings persistence, focus / Just Write modes.

For deeper implementation notes, see [desktop architecture](docs/DESKTOP.md), [settings audit](docs/SETTINGS_AUDIT.md) and [changelog](CHANGELOG.md). The in-app About dialog includes links to this repository and desktop releases.

## Verification and release policy

Run `node --test tests/leaf.test.cjs tests/desktop.test.cjs` to exercise the dependency-free web regression suite and the desktop integration checks. The Windows runner separately runs Rust unit tests and an actual release-mode build. A successful compile does **not** replace manual checks of OS dialogs, disk conflicts, recovery, file associations and installer behavior. Desktop release publication remains gated on verified artifacts and the remaining signing / platform decisions.

## Credits

**Original Leaf by Dan** — [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf). **Fork updated by lgg** — [lgg/leaf](https://github.com/lgg/leaf). This is an independent fork, not the original author's deployment.
