LEAF: A MARKDOWN EDITOR
Vibe coded by Dan (c) 2026 — https://github.com/uncle-jasper/leaf
updated by lgg — https://github.com/lgg/leaf
Version 1.9.0-lgg.1 (lgg fork; based on upstream v1.7)

================================================================================
WHAT IS LEAF?
================================================================================

Leaf is a lightweight, distraction-free writing tool that runs entirely in your
web browser as a single HTML file. There's nothing to install, no account to
create, and no internet connection required. Just open the file and write.

The fonts (iA Writer Mono, Duo, and Quattro) are embedded directly in the HTML
file, so they work offline and look identical on every machine.


================================================================================
FILES IN THIS PACKAGE
================================================================================

  editor.html               The editor itself
  leaf.webmanifest          PWA manifest (for browser installation)
  sw.js                     Service worker (for offline PWA support)
  leaf-icon-192.png         App icon (192px)
  leaf-icon-512.png         App icon (512px)

Keep all files in the same folder.


================================================================================
GETTING STARTED
================================================================================

OPTION 1 - Open directly in a browser
Double-click editor.html. Works in any modern browser.

OPTION 2 - Install as a PWA (Chrome / Edge)
Open https://lgg.github.io/leaf/editor.html (fork) in Chrome or Edge.
Original author: https://uncle-jasper.github.io/leaf/editor.html
An install button will appear in the address bar or browser menu.
Click it to install Leaf as a standalone app with its own window and icon.
Once installed, Leaf can run offline after the first successful online visit
has registered and populated the service worker cache. If you use external
Google Fonts, an offline fallback font may be displayed instead.

OPTION 3 - Install on iPhone / iPad
In Safari, open https://lgg.github.io/leaf/editor.html, use Share >
Add to Home Screen and enable Open as Web App where offered. Open the
installed Leaf app once while online before relying on offline access.

OPTION 4 - Install on Android
Open the same page in Chrome, then use the browser's Install app or
Add to Home Screen command. Open it once online to pre-cache the editor.
Some browsers offer only a shortcut rather than a standalone install.

MOBILE WRITING MODE
On phones and touch tablets (up to 1366 CSS px wide), Leaf hides the desktop
toolbar and tabs automatically. By default, only the writing surface is shown.

  - Tap the invisible area at the BOTTOM of the screen to reveal the dock.
  - The dock provides: Documents, Write/Preview, Save, and More actions.
  - After about 4 seconds with no action, the dock automatically hides.
  - Documents opens a bottom sheet for switching, creating or closing tabs.
  - More includes opening a file, exporting Markdown ZIP, settings, and About.
  - The dock stays clear of the on-screen keyboard while typing.
  - The optional top document title and mobile status bar are OFF by default.
  - Settings > Editor > Mobile display can show either of them and disable
    automatic dock hiding to keep the bottom controls visible all the time.
  - Settings > Current document includes a filename field so mobile users
    can edit the saved Markdown filename independently from document labels.

There is no account, cloud synchronization or automatic transfer between
mobile, web and desktop. Use Markdown export for durable copies of drafts.
Remote fonts can fall back to bundled/system fonts when completely offline.


================================================================================
THE INTERFACE
================================================================================

TOOLBAR (top strip)
  Filename field        Set the name of your file before saving
  save                  Downloads your file (or saves in place in Chrome)
  all .md               Exports all open, editable documents as one .zip of
                        separate Markdown (.md) files
  open                  Load an existing .txt or .md file
  write / split / prev  Switch between write, split, and preview modes
  Theme menu            Choose your color theme
  Font settings         Choose the writing font under Settings > Appearance
  Size settings         Choose the font size under Settings > Appearance
  autohide              Hides toolbar while typing; hover top of screen to show
  focus                 Fullscreen focus mode (Esc or Ctrl+Shift+F to exit)
  ...                   About Leaf

TAB BAR (below toolbar)
  Shows open files below the toolbar. Click to switch, + to open new,
  x to close. In focus mode, the tab bar is hidden.
  Double-click a tab label to rename it without changing the Markdown filename.
  Settings > Current document is the first section of the settings dialog.
  There, the in-app tab label and browser title are independent of the Markdown
  filename. Each document remembers both fields.

  In autohide mode, the toolbar hides when you click into the editor.
  Move your mouse to the top of the screen to reveal it. The tab bar
  stays visible and can be pinned (⊙) so it never fades, or unpinned
  (⦿) to let it fade after a few seconds. Pin state is remembered
  between sessions.

STATUS BAR
  Shows live word count, character count, line count, and cursor position.
  When text is selected, shows the word and character count of the selection.
  Each counter can be hidden independently under Settings > Status bar.
  When all five counters are disabled, the entire status bar disappears.
  Fades out in focus mode and reappears on hover.
  Displays a random welcome message on launch.
  Shows milestone messages at 100, 250, 500, 1000, 2000, and 5000 words.
  Shows a quiet idle nudge after 3 minutes of inactivity.
  All status messages can be disabled under Settings > Editor.


================================================================================
THEMES
================================================================================

  parchment   Warm cream (default)
  paper       Cool white with a slight blue-grey tint
  dark        Near-black with cool grey text
  black       Pure black (#000000) with a grey (#c8c8c8) caret and monospace font
  moss        Dark green
  slate       Dark blue-grey
  terminal    Black with dimmed green phosphor text. Includes an optional
              CRT mode ([CRT] in toolbar) — a fun retro nod to the monochrome
              green monitors of the 80s. Rumor has it there's another color
              hiding in there somewhere.
  custom      Pick your own colors using the color picker or hex code input

Settings (theme, font, size, autohide, pin state) are remembered between
sessions.


================================================================================
FONTS
================================================================================

The iA Writer fonts are embedded in the HTML file and work offline.
JetBrains Mono, Inconsolata, Share Tech Mono, Roboto Mono and Open Sans need
an internet connection for their web fonts (with local fallback). System fonts
Arial and Times New Roman work offline when installed on the device.

  iA Writer Mono      Classic monospaced typewriter feel (default)
  iA Writer Duo       Proportional with a monospace structure
  iA Writer Quattro   Most proportional of the three, very readable
  JetBrains Mono      Clean developer monospace
  Inconsolata         Clean, neutral console font
  Share Tech Mono     Softer retro monospace
  Roboto Mono         Clean, readable monospaced font
  Open Sans           Modern proportional sans-serif
  Times New Roman     Classic system serif font
  Arial               Classic system sans-serif font


================================================================================
KEYBOARD SHORTCUTS
================================================================================

  Ctrl+S          Save file
  Ctrl+B          Bold selected text (**text**)
  Ctrl+I          Italic selected text (*text*)
  Ctrl+K          Wrap selection in link [text](url)
  Ctrl+1          Heading 1 (toggle)
  Ctrl+2          Heading 2 (toggle)
  Ctrl+3          Heading 3 (toggle)
  Ctrl+4          Heading 4 (toggle)
  Ctrl+Shift+J    Toggle Just Write mode
  Ctrl+Shift+F    Toggle focus mode
  Ctrl+Shift+P    Toggle preview mode
  Ctrl+Shift+S    Toggle split view
  Ctrl+N          New tab
  Ctrl+W          Close current tab
  Ctrl+[          Previous tab
  Ctrl+]          Next tab
  Esc             Exit focus mode / close About dialog
  Tab             Insert two spaces


================================================================================
SAVING
================================================================================

In Chrome, the first save opens a Save As dialog. Every subsequent save
writes silently to the same file with no dialog. The status bar flashes
a saved confirmation.

In Brave and other browsers, each save downloads the file. Name the file
using the filename field before saving.

Each text change schedules a browser-local save, debounced for 350 ms of
inactivity; uninterrupted typing is flushed at least once every 2 seconds.
Identical snapshots are not written again. Hiding or closing the browser tab
flushes outstanding edits synchronously. This avoids disk writes per keystroke.

All open documents, their filenames, in-app labels, browser titles, content,
dirty states and active tab are restored automatically on the same site/browser.
Older single-document autosaves can still be restored.

If independent Leaf browser windows edit the same workspace, Leaf detects
external changes and writes separate recovery copies to avoid silently
overwriting another window's work. Settings > Current document only shows the
"restore backup" action when a valid recovery copy exists. Restoring it keeps
the previous main workspace as a separate backup. The modal scrolls on small
screens, and all controls are accessible.

The page is served fresh online with a cached offline fallback. If an older
PWA version is still open, reload the page to apply updated settings controls.
LocalStorage is not a replacement for an exported file backup.

The writing hint ("Start writing… markdown is supported.") can be disabled
in Settings > Editor. Appearance and visibility preferences are saved as well.

IMPORTANT: Browser data can be erased by the user, by private/incognito mode or
by browser cleanup. Download important files as .md or .txt for durable backups.
Storage is per browser + website origin: a local file, the upstream GitHub Pages
site and your own fork's GitHub Pages site have separate localStorage.


================================================================================
JUST WRITE MODE
================================================================================

Leaf is, at its core, a writing tool. Just Write mode is a reminder of that.

Press Ctrl+Shift+J to lock your theme and font for 30 minutes, even across
sessions. The idea is simple: stop tweaking, start writing. No fiddling with
colors. No hunting for the perfect font. No excuses.

Write 500 words to earn your freedom early.


================================================================================
SETTINGS — FORK UPDATE
================================================================================

On desktop, settings open with Ctrl+, or the "settings" toolbar control.
On phones/tablets, tap the bottom edge > More > Settings.
Section order:
  1. Current document — in-app tab label, browser tab title and recovery
     action (only when a backup exists)
  2. Appearance — themes, custom colors, fonts and font size
  3. Status bar — five independent visibility toggles
  4. Editor — writing hint, status messages, smart punctuation and three
     mobile display toggles (heading, status bar, auto-hide dock)

Each setting is saved in the browser-local "leaf-editor-settings" localStorage
entry. Draft workspaces use a separate key. Browser cleanup, incognito mode,
storage quota failures, and other websites' storage cannot be controlled by Leaf.

================================================================================
CHANGELOG
================================================================================

v1.9.0-lgg.1 — lgg fork (2026-11-19)
  - Minimal phone and touch-tablet editor with no permanent top toolbar or tabs
  - Invisible bottom tap area to reveal a one-handed action dock; auto-hide
  - Touch-friendly bottom sheets for documents and additional actions
  - Keyboard-aware bottom controls and safe-area padding for iOS/Android
  - Optional document heading, status bar and auto-hide mode, all persisted
  - Editable filename in settings for mobile file export
  - Kept full desktop interface unchanged

v1.8.0-lgg.1 — lgg fork (2026-11-19)
  - Fork version now displayed consistently in About, README and changelog
  - Proper PWA service-worker registration and Android/desktop install prompt
  - Existing cache-first assets available offline after first online visit
  - iPhone / iPad home screen installation and offline use documented
  - Previous fork features: responsive settings, independent tab titles,
    350ms/2s bounded autosave, multi-document recovery, ZIP Markdown export,
    hidden status counters, black theme and four added fonts
  - Original upstream release history below is preserved as supplied

UPSTREAM BASELINE: v1.7 (uncle-jasper/leaf)
  - Historical upstream changelog entries continue below; no upstream versions
    have been renumbered in this fork.

v1.5.4
  - Theme dropdown no longer collapses the toolbar when scrolling through
    options in autohide mode
  - Milestone messages no longer fire when closing a tab and switching to
    the previous one
  - Just Write sessions now expire correctly even when you're on a different
    tab at the time
  - Active Just Write tab is now marked with italic text in the tab bar
  - About modal restored: version, changelog link, and donation link
  - README tab is now read-only

v1.5.3
  - Opening a file no longer overwrites the current tab if it has content —
    the file opens in a new tab instead
  - Milestone messages no longer fire for words already present when loading
    a document — only milestones earned during the current session fire
  - Theme selector replaced with a custom dropdown — no more white flash
    when the cursor leaves the menu on Linux and Windows
  - Just Write mode hardened: word count progress is tied to the tab where
    the session started, the original word baseline survives page reloads,
    the release message now always shows even if a milestone message is
    mid-scroll, and opening the README during a session is blocked

v1.5.2
  - Added donation link to About modal ;)

v1.5.1
  - About modal close button replaced with a quiet × in the corner
  - iOS/Safari fix: status bar no longer creeps upward while typing on-screen keyboard
  - All status messages now correctly respect the "show status messages" toggle —
    Just Write and CRT messages were bypassing it
  - Word count milestone messages now fire only once per session — no longer
    refire when word count dips below a threshold and climbs back up

v1.5
  - Just Write mode (Ctrl+Shift+J) — for when you need to stop fiddling and
    actually write. Locks your theme and font for 30 minutes, even across
    sessions. Write 500 words to earn your freedom early.
  - A secret amber CRT mode can be unlocked... Anybody up for a game of Contra?
  - Custom theme colors no longer bleed into other themes when switching
  - Custom theme colors now persist between sessions
  - 24px option added to font size selector
  - Bulleted and numbered lists now hang-indent in preview and split mode

v1.4.1
  - Bottom scroll padding added so the last line never sits flush against the status bar

v1.4
  - Word count milestone messages (100, 250, 500, 1000, 2000, 5000 words)
  - Idle nudge messages after 3 minutes of inactivity
  - All status messages controlled by a single toggle in the About modal
  - Editor padding removed top and bottom — text runs flush to toolbar and status bar
  - Scroll position now shared across all three modes (write, split, preview)
  - Split view starts at the top of the document on first entry each session
  - First-time users now correctly land on parchment theme
  - Focus mode status bar background fixed

v1.3
  - CRT mode for terminal theme: scanlines, phosphor glow, screen flicker, vignette, pixel text rendering
  - Underscore cursor in terminal theme for authentic 80s word processor feel
  - [CRT] toggle in toolbar — only visible in terminal theme, strikethrough when disabled
  - CRT preference remembered between sessions
  - Subtle always-on phosphor glow in terminal theme even when CRT is off

v1.2.2
  - Ctrl+Shift+S toggles split view
  - Split view scroll sync: editor and preview scroll together in real time
  - Scroll sync snaps preview into position when entering split mode
  - Sync toggle button (⇅/↕) on the split divider — click to lock or free scrolling
  - Last pane scrolled determines sync position when re-enabling scroll lock
  - Scroll sync preference remembered between sessions
  - Browser title bar shortened to "Leaf: A Markdown Editor"

v1.2.1
  - Welcome message toggle persists correctly between sessions
  - Tab bar pin state remembered between sessions and across autohide toggles
  - Theme selector correctly shows saved theme on launch
  - Parchment set as default theme on first launch

v1.2
  - Random retro-style welcome message scrolls in the status bar on launch
  - Welcome message can be disabled via toggle in the About modal
  - Ctrl+Shift+P toggles preview mode
  - Ctrl+N opens a new tab
  - Ctrl+W closes the current tab
  - Ctrl+1 through Ctrl+4 insert and toggle heading levels
  - Ctrl+K wraps selection in a markdown link [text](url)
  - Tab bar pin/unpin in autohide mode (⊙/⦿)
  - Two-stage autohide reveal: mid zone shows tabs, top edge shows toolbar
  - Tab bar fades gracefully after inactivity in unpinned autohide mode
  - Pin state remembered between sessions
  - Toolbar hides only when clicking into editor (not immediately on toggle)
  - Paper theme updated to cool white with blue-grey tint
  - Parchment set as default theme on first launch
  - Tab name syncs correctly after renaming and saving
  - Tab bar surface color matches status bar
  - Placeholder text now adapts to each theme color

v1.1

  - Tabs: multiple files open simultaneously in a single window
  - Tab bar hides in focus mode, stays visible in autohide mode
  - Autosave every 30 seconds to browser storage with restore on reopen
  - Unsaved changes warning when closing the window
  - Silent save-in-place using File System Access API (Chrome/Edge)
  - Numbered list auto-continue on Enter (increments number automatically)
  - Bullet list auto-continue on Enter (adds dash); double Enter exits list
  - Numbered and bulleted lists render correctly in preview mode
  - Custom theme hex code input added alongside color picker
  - Custom theme colors now persist across sessions
  - Selection highlight color matches current theme accent
  - Editor background color fixed on mobile browsers
  - iA Writer Mono, Duo, and Quattro fonts embedded directly in the file
  - Replaced Space Mono with Inconsolata in font list
  - Dark theme changed from blue-black to neutral grey-black
  - Default font changed to iA Writer Mono
  - Default font size changed to 18px
  - Editor text wraps correctly when window is narrower than 68 characters
  - Top and bottom padding reduced to 24px
  - About popup added (... button in toolbar) with icon, version, and credit
  - Secret easter egg added

v1.0
  - Initial release
  - Markdown editor with write, split, and preview modes
  - Themes: parchment, paper, dark, moss, slate, terminal, custom
  - Font and size selection
  - Focus mode with toolbar peek on mouse-to-top
  - Autohide toolbar mode
  - Status bar with word, character, line count and cursor position
  - Selection word count
  - PWA support with offline caching
  - Windows Chrome launcher (Leaf.bat)
  - Mac Platypus launcher


================================================================================
FORK NOTES (lgg/leaf)
================================================================================

- Word count can now be hidden; hiding all counters removes the status bar.
- Black theme, grey caret and monospaced writing font.
- Optional writing hint, remembered after reload.
- All open tabs and filenames are now restored after reopening the browser.
- Settings are stored per website in localStorage.
- ZIP export of multiple Markdown files (issue #1).
- Independent internal/browser tab names per document (issue #2).
- Additional fonts: Roboto Mono, Open Sans, Times New Roman and Arial.
- Mobile full-screen writing and touch-accessible bottom controls (v1.9.0-lgg.1).
- Original: Dan / https://github.com/uncle-jasper/leaf
- updated by lgg / https://github.com/lgg/leaf

The fork is published through GitHub Pages at:
https://lgg.github.io/leaf/editor.html

================================================================================
LEAF IS A SINGLE HTML FILE. NO DATA EVER LEAVES YOUR COMPUTER.
================================================================================
