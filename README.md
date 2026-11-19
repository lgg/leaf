# Leaf — distraction-free Markdown editor

Lightweight, single-file writing tool with multiple documents, focus mode, themes, offline support and local draft recovery.

**Original by [Dan](https://github.com/uncle-jasper)** — [uncle-jasper/leaf](https://github.com/uncle-jasper/leaf).  
**updated by [lgg](https://github.com/lgg)** — [lgg/leaf](https://github.com/lgg/leaf).

## Open editor

[Open the lgg fork online](https://lgg.github.io/leaf/editor.html) *(GitHub Pages must be enabled for the `main` branch)* · [Original author's editor](https://uncle-jasper.github.io/leaf/editor.html)

You can also download `editor.html` and open it in a browser; no build tools or account are required.

## Features in the fork

- **Quiet writing:** toggle word, character, line, reading-time and cursor counters separately; the footer vanishes when all are hidden; optionally hide the empty-page hint.
- **Black theme:** pure black background with a grey caret; monospaced by default.
- **Fonts:** iA Writer, JetBrains Mono, Inconsolata, Share Tech Mono, Roboto Mono, Open Sans, Times New Roman and Arial.
- **Autosave:** debounced at 350 ms after changes, flushed at most every 2 s during continuous typing; unchanged snapshots are skipped. Saves also flush on tab hide/close. Drafts, document labels, browser titles and preferences survive browser restarts.
- **Concurrent editor safety:** when another Leaf window changes the same workspace, edits are stored in a separate recovery copy instead of silently overwriting it.
- **Multiple documents:** internal tab labels and browser-tab titles can be named independently from Markdown filenames. Double-click an in-app tab to rename it.
- **Export all:** the `all .md` toolbar button produces a ZIP containing one Markdown file per open editable document, including non-ASCII text and unique filenames.

**Back up important writing:** Browser `localStorage` is convenient but can be cleared by the browser or user. Export files for durable storage. Browser storage is scoped to each website, so drafts made on the upstream author's URL are not shared with this fork's URL.

For the full shortcut list and upstream details see [README.txt](README.txt). Run the zero-dependency regression suite with `node --test tests/leaf.test.cjs`.

## Attribution

Leaf remains credited to its original author, Dan. This fork is an independent set of updates by lgg, and is not the original author's deployment.
