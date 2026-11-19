# Leaf fork — settings and workspace audit

**Audit date:** 2026-11-19  
**Repository:** [lgg/leaf](https://github.com/lgg/leaf)  
**Scope:** settings dialog, preferences persistence, multi-document workspace, ZIP export, PWA refresh and previous requirements.

## Settings audit

| Area | Setting / behavior | Verification and result |
| --- | --- | --- |
| Dialog | **Current document** is the first section | PASS — section-order assertion: Current document → Appearance → Status bar → Editor |
| Dialog | Recovery button does not crowd the form | PASS — button has compact dedicated styling and lives in a hidden recovery row |
| Dialog | Long help text and small screens | PASS (source/structure) — wrapping, responsive widths, max-height and scrolling; manual visual browser review still recommended |
| Current document | Custom label inside Leaf | PASS — independent per-tab `label`, updated on input/double-click, included in workspace snapshot |
| Current document | Browser tab title | PASS — independent per-tab `browserTitle`, applied to `document.title`, persisted |
| Current document | Filename remains independent | PASS — `name` is tracked separately, used for save/ZIP |
| Current document | Conflict backup visibility | PASS — hidden if none; valid backups detected; malformed backups skipped; show backup count |
| Current document | Restore a backup | PASS — previous primary is preserved as a separate copy, restored backup is written to primary storage and survives reload |
| Appearance | Theme preset, including **black** | PASS — theme saved/restored; black CSS has exact `#000000` background and `rgb(200, 200, 200)` caret |
| Appearance | Custom theme pickers and manual HEX | PASS — values saved/restored; valid HEX input now triggers `saveSettings()`, invalid HEX ignored |
| Appearance | Fonts and font size | PASS — value saved/restored; Roboto Mono, Open Sans, Times New Roman and Arial included |
| Appearance | CRT, autohide, pinned tabs, scroll sync | PASS (source/serialization) — all represented in persisted settings and their UI handlers; only tab pin appears during autohide |
| Status bar | Five independent visibility switches | PASS — word, character, line, reading-time and cursor options persist |
| Status bar | Bar completely disappears with all five hidden | PASS — visibility test; hidden indicators do not reserve footer height |
| Editor | Empty-page hint | PASS — setting persists, placeholder becomes an empty string when disabled |
| Editor | Status messages / smart punctuation | PASS (source/serialization) — saved and loaded; handlers bound in editor |
| General | Settings survive closing/reopening | PASS — direct mocked-localStorage round-trip tests and all persisted keys inspected |
| General | Browser storage blocked or corrupt | PASS (source) — recoverable messages for storage errors; no crash on invalid preference record |

## Workspace, backup and export audit

- **Autosave:** debounced `350 ms` per change, maximum `2000 ms` under continuous editing; identical snapshots skipped. Flush on hidden tab and `pagehide`.
- **Workspace:** persists all open documents, active tab, contents, filename, custom labels, browser titles and dirty flags in `leaf-workspace-v1`.
- **Multiple Leaf windows:** detects external `localStorage` changes and stores divergent edits in a separate recovery entry.
- **Backup restoration:** explicit restore safeguards previous primary data by archiving a copy before changing it.
- **Markdown ZIP export:** exports each editable tab as its own UTF-8 Markdown file (one ZIP), with duplicate-safe filenames and CRC32.
- **PWA cache:** `leaf-lgg-v6`, online network-first HTML plus cache fallback, to avoid serving stale editor JavaScript indefinitely.

## Regression checks

**14 of 14 pass** in an in-process JavaScript harness executing the repo test cases in `tests/leaf.test.cjs`, including settings round-trip, all serialized preference fields, custom HEX persistence, backup availability and restoration, ZIP structure/UTF-8/CRC, tab-state recovery, autosave coalescing and PWA cache behavior.

To rerun on a machine with Node.js:

```bash
node --test tests/leaf.test.cjs
```

Additional structural checks: settings modal `37` opening / `37` closing divs, no duplicate HTML IDs, correct section ordering; embedded About/README text exactly matches `README.txt`.

## What this does **not** prove

This audit includes source inspection and JavaScript unit tests using browser API mocks, **not a complete real-browser end-to-end/visual run** across browsers, zoom levels, viewport sizes, and installed PWA states. A manual check of the published editor is still appropriate, especially small phones and offline PWA behavior.

The browser's storage may be cleared, quota-limited, or isolated by origin. Exported Markdown files are recommended as durable backups. Web fonts may need an internet connection; Arial and Times New Roman require system availability.

**Separate GitHub repository metadata:** The repository's *About → Website* field was verified after merge and currently points to `https://lgg.github.io/leaf/editor.html`. GitHub Pages is enabled. The fork README and in-app credits link to both the original author/repository and `updated by lgg`. The GitHub connector did not change repository metadata in this work.

## Mobile UI update (v1.9.0-lgg.1)

- Mobile/tablet text-only default: top toolbar and document header hidden; status bar hidden by default
- Tap bottom edge to reveal action dock, which auto-hides after 4200 ms unless disabled
- Bottom sheets for document management and additional actions, text is inserted with DOM textContent
- Mobile settings (heading, status bar, automatic toolbar hiding) use the same localStorage preferences
- Filename editing is available through Settings > Current document, not dependent on the hidden desktop toolbar
- Keyboard detection uses visualViewport and avoids dock overlap while editing; touch controls account for safe-area insets
- Existing desktop toolbar, shortcuts and tab UI stay unchanged
- Full physical-device visual, rotation, standalone PWA and offline keyboard testing is still required before claiming multi-device production certification
