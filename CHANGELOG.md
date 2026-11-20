# Leaf — fork changelog

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
