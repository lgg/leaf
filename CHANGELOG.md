# Leaf — fork changelog

## v1.11.1-lgg.1 — 2026-11-23 (Restore actual Windows UI and hide updater console)

- Fixed the Windows release publisher reading stale Portable ZIP and Setup files from a previous self-hosted job. Clean the staging directories before downloading, unpack immutable artifact IDs into the expected root, reject nested/stale files, and refuse to publish binary payloads whose SHA-256 matches any older release.
- The v1.11.0 published release mistakenly contained older v1.10.4 binaries despite source checks and CI passing. v1.11.1 is the replacement build; do not use the v1.11.0 download for testing.
- Suppressed the blue PowerShell console during update checks, download and final handoff by using the Windows CREATE_NO_WINDOW process-creation flag.
- Restored the source-of-truth About settings, complete welcome window, and original-author support link in the actual distributable EXE; added release provenance checks and regression coverage.
- Windows 10/11 only; macOS runner and packaging untouched.


## v1.11.0-lgg.1 — 2026-11-23 (Portable self-update UX test)

- Removed the coffee link from the welcome/About popup, keeping it focused on credits, versions, the repositories, downloads and Star on GitHub.
- Moved the original author’s support link alongside the original repository in Settings → About, with the clean label **buy Dan a coffee** and no icon.
- Bumped the portable/installed Windows build and secure updater tags to 1.11.0 so existing 1.10.5 Portable users can test the update flow using GitHub Releases.
- No changes to macOS runners or packaging.

## v1.10.5-lgg.1 — 2026-11-23 (About tab and welcome dialog fixes)

- Fixed the sixth Settings → About tab: both click and keyboard navigation now derive tabs from the rendered settings menu, preventing skipped new tabs.
- Restored the complete welcome/About window with version, desktop/web edition, author credits, both repository links, changelog, README, Windows downloads, Star on GitHub and coffee link. The About settings tab keeps this information too.
- Added a reversible Settings → About checkbox to show the welcome window at startup. The popup’s “Don’t show again” updates the same persisted preference; the toolbar About button always opens the popup. Windows desktop defaults to showing on launch; browser/PWA defaults to off unless enabled.
- Windows portable/Setup edition labels now update both the settings tab and the welcome window.
- macOS packaging and its runner remain untouched.

## v1.10.4-lgg.1 — 2026-11-23 (About settings and theme-aware links)

- Fixed WebView2 portable/Setup builds displaying the web-only **Install App** action: desktop staging now marks native builds and hides the PWA control, and install-prompt / service-worker handlers reject native environments. Browser/PWA install prompts remain available.

- Added Settings → About with fork/original GitHub links, Star on GitHub, readable theme-aware links, current version and launch edition for web, PWA, standalone HTML, portable Windows and installed Windows.
- The old separate About popup can be skipped permanently, with the preference saved and reversible in Settings → About.
- Moved desktop update checks, verified downloads, and apply controls into Settings → About; clicking an update notification opens that tab.
- Fixed the macOS runner-label assertion that blocked unrelated Windows CI. macOS build remains postponed.

## v1.10.3-lgg.1 — 2026-11-23 (Windows GitHub updates and tabbed settings)

- Five settings tabs replace the scrolling page: Current document, Appearance, Status bar, Editor, Mobile display.
- Focus top-bar auto-hide moves directly under Appearance, with a separate theme/colors group; editor typography moves to Editor. Interface font and pixel size are independently configurable and persist.
- Correct GitHub prerelease discovery, startup notification, release notes, and opt-in verified ZIP/Setup downloads with SHA-256 checking.
- Portable updates replace/restart the EXE after a safe exit; installed updates launch per-user Setup after closing Leaf. No forced downloads or software installs on the self-hosted runner.
- Publisher-signed Tauri updates are deferred and are not claimed for this unsigned preview.

## v1.10.2-lgg.1 — 2026-11-22 (custom desktop window titlebar)

- Replaced the white Windows-native titlebar with a frameless Leaf-themed caption that follows the chosen theme.
- Added drag-to-move, double-click maximize, minimize, maximize/restore, and native-close buttons that honor unsaved-document recovery.
- The custom titlebar hides during focus mode; only the desktop build gains this window UI. Web/PWA remains unchanged except version metadata.
- Added scoped Tauri window-control permissions, desktop staging tests, and updated signed-off Windows-only prerelease packaging safeguards.

## v1.10.1-lgg.1 — 2026-11-21 (Windows 10/11 desktop release refresh)

- Styled file picker replaces the visible default Windows/WebView file control.
- Independent saved focus-mode top-bar auto-hide preference, with hover-to-reveal for toolbar and document tabs.
- Editable positive-integer font size (1px or greater) with a styled Save button; 6–128px slider clamps visually without overwriting larger or smaller text values.
- Regression tests, matching README/About version, Windows setup/portable builds and safer bounded release artifact uploads.

## v1.10.0-lgg.1 — 2026-11-19 (desktop integration branch; not released)

- Added a separate Tauri v2 Windows desktop application with native Markdown/text file open, Save and Save As.
- Added revision-aware saves, atomic temporary writes and explicit conflict protection for externally modified files.
- Prevented obfuscated dangerous link/image URL schemes from being transformed into executable URLs when rendering Markdown.
- Added persisted desktop sessions, real file reopening, missing-file recovery and unsaved draft prompts.
- Added native-launch file handling, Windows file association metadata and GitHub Releases navigation.
- Added desktop-only asset staging and self-hosted Windows build validation; no Rust/Tauri runtime in web/PWA.
- Updated About/download links and documentation; removed the redundant README.txt.
- Bumped fork version and PWA cache generation.

## v1.9.0-lgg.1 — 2026-11-19

- Security maintenance (2026-11-20): escaped Markdown preview attributes and denied unsafe/obfuscated link and image URI schemes without changing the editor's storage model.
- Fixed a browser/PWA tab-close race: editing while asynchronous Save is pending no longer discards the newer unsaved text.

- Added a minimal responsive writing interface for mobile phones and touch tablets.
- Replaced desktop top toolbar/tabs on touch screens with a bottom tap-to-reveal dock (Docs, Preview, Save, More).
- Added touch-friendly document and action sheets with accessible labels and 44px+ controls.
- Added optional top document heading, mobile status bar and persistent bottom toolbar via settings.
- Respected iOS/Android safe areas and visual viewport height while the keyboard is open.
- Enabled per-document Markdown filename editing from settings on mobile.
- Desktop layout and core localStorage/workspace behavior remain unchanged.
- Added mobile interaction and preference regression checks.

## v1.8.0-lgg.1 — 2026-11-19

Based on the original **[uncle-jasper/leaf](https://github.com/uncle-jasper/leaf) v1.7**. Fork updates are independently versioned; the upstream release history remains intact in the upstream repository.

- Fixed missing PWA service-worker registration. Offline startup works after successful installation/cache warm-up.
- Added browser installation prompt handling on platforms supporting `beforeinstallprompt`; documented manual installation on iOS and Android.
- Previous fork improvements: reliable debounced workspace autosave, multi-tab drafts and recovery, independent browser/in-app tab titles, ZIP Markdown export, five hidden status counters, black theme, extra fonts, and responsive settings.
- Fixed mobile and desktop installation guidance and aligned the manifest and the About version with the README.

## Historical upstream releases

The full historical upstream changelog is preserved in [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf), rather than duplicating an obsolete README.txt in this fork.

**Original by Dan:** [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf) · **updated by lgg:** [lgg/leaf](https://github.com/lgg/leaf).
