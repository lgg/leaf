# Leaf Windows desktop — synthetic GUI acceptance

**Status:** manual test procedure, not an approved release. This guide does not certify that Leaf works until someone runs the actual GUI checks. Track completed checks in issue #11: https://github.com/lgg/leaf/issues/11.

## Prerequisites

1. Use Node.js if it is already present on your Windows PC. Do not install new tools merely to run these fixtures.
2. Select the most recent **fully successful** Windows CI run at https://github.com/lgg/leaf/actions/workflows/desktop-windows.yml. Verify it matches the intended commit and both the native Rust tests and **Verify compiled EXE contains no private workstation paths** passed. Download the leaf-windows-portable-smoke-test artifact from that same run. Do not use old unsafe or failed-run files.
3. In a separate source checkout, run from its root:

    node desktop/acceptance-fixtures.cjs init

This creates only synthetic files under desktop/acceptance-workspace/. The directory is gitignored; the generator refuses to overwrite any existing workspace or edited fixtures. Do not use private documents or expose local filesystem paths in public logs.

## GUI acceptance scenarios

1. **Open and save:** open 01-save-in-place.md in Leaf. Change the paragraph, press Ctrl+S, reopen the same file in another editor and confirm the saved bytes are correct.
2. **CRLF:** open 02-crlf.md, edit and save. The verifier must still report crlfPreserved = PASS.
3. **Save As:** open 03-save-as-original.md, edit, choose Save As to a new filename and check the original remains unchanged.
4. **External conflict:** open 04-external-conflict.md and enter unsaved text. Then run:

    node desktop/acceptance-fixtures.cjs conflict

Try Ctrl+S in Leaf. It must refuse a stale overwrite, keep the unsaved draft and leave the externally edited file intact. Save the draft elsewhere with Save As.
5. **Clean reopen:** open 05-reopen-clean.md without unsaved edits. Then run:

    node desktop/acceptance-fixtures.cjs refresh

Use Leaf's Open dialog on that same file again. The existing clean tab must show the updated disk contents.
6. **Missing-file recovery:** open 06-missing-on-restart.md and make an unsaved edit. Then run:

    node desktop/acceptance-fixtures.cjs move

Exit Leaf using recovery confirmation and restart. The moved file must not be silently recreated; the unsaved text must be available as a separate, unbound recovery draft for Save As.
7. **Plain text and hyperlinks:** open 07-plain-text.txt and verify edit/save. In 08-links.md, HTTPS should open the OS browser and javascript: links must be blocked.
8. **Additional GUI checks:** use two or more tabs, custom titles, native drag/drop, Ctrl+O, cancellation of Save As, recovery of a read-only file, ZIP export, About and GitHub Releases links. Verify no silent installation or updater is triggered.
9. **Installer and association:** do not mark these passed unless an installer is actually produced with an explicitly approved toolchain. A portable EXE alone does not validate Windows associations or the updater.

## Local synthetic verification

After running conflict, refresh and move and completing the original/CRLF checks, run:

    node desktop/acceptance-fixtures.cjs verify

The verifier prints only Boolean fixture checks and returns nonzero until all five pass. It **cannot** verify GUI layout, native dialogs, tab behavior or session-recovery UX. Record actual results in issue #11.

To restart, manually delete only the generated desktop/acceptance-workspace/ directory after preserving any synthetic drafts you wish to keep; rerun init. Commands never intentionally overwrite an edited fixture.
