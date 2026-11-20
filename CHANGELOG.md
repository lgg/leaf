# Leaf — fork changelog

## v1.9.0-lgg.1 — 2026-11-19

- Security maintenance (2026-11-20): escaped Markdown preview attributes and denied unsafe/obfuscated link and image URI schemes without changing the editor's storage model.

- Added a minimal responsive writing interface for mobile phones and touch tablets.
- Replaced desktop top toolbar/tabs on touch screens with a bottom tap-to-reveal dock (Docs, Preview, Save, More).
- Added touch-friendly document and action sheets with accessible labels and 44px+ controls.
- Added optional top document heading, mobile status bar and persistent bottom toolbar via settings.
- Respected iOS/Android safe areas and visual viewport height while the keyboard is open.
- Enabled per-document Markdown filename editing from settings on mobile.
- Desktop layout and core localStorage/workspace behavior remain unchanged.
- Added mobile interaction and preference regression checks.

## v1.8.0-lgg.1 — 2026-11-19

Based on the original **[uncle-jasper/leaf](https://github.com/uncle-jasper/leaf) v1.7**. Fork updates are independently versioned; the upstream release history remains intact in [README.txt](README.txt).

- Fixed missing PWA service-worker registration. Offline startup works after successful installation/cache warm-up.
- Added browser installation prompt handling on platforms supporting `beforeinstallprompt`; documented manual installation on iOS and Android.
- Previous fork improvements: reliable debounced workspace autosave, multi-tab drafts and recovery, independent browser/in-app tab titles, ZIP Markdown export, five hidden status counters, black theme, extra fonts, and responsive settings.
- Fixed mobile and desktop installation guidance and aligned the manifest and the About version with the README.

## Historical upstream releases

Refer to [README.txt](README.txt) for the original recorded upstream changelog (v1.5.4 through v1.0). Its entries and numbering have not been rewritten.

**Original by Dan:** [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf) · **updated by lgg:** [lgg/leaf](https://github.com/lgg/leaf).
