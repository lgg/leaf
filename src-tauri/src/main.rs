#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct DesktopState {
    // Only user-selected or restored Markdown/text files can be saved in place.
    authorized: Mutex<HashMap<String, String>>,
    // Paths are authorized for drag/drop only by a genuine OS webview event.
    dropped: Mutex<HashSet<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    path: String,
    name: String,
    content: String,
    revision: String,
    line_ending: String,
}

// Saving does not need to send the entire document back over WebView IPC.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveReceipt {
    path: String,
    name: String,
    revision: String,
    line_ending: String,
}

impl From<Document> for SaveReceipt {
    fn from(doc: Document) -> Self {
        Self {
            path: doc.path,
            name: doc.name,
            revision: doc.revision,
            line_ending: doc.line_ending,
        }
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionTab {
    path: Option<String>,
    name: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    browser_title: String,
    #[serde(default)]
    dirty: bool,
    #[serde(default)]
    draft: Option<String>,
    #[serde(default)]
    revision: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    #[serde(default)]
    active_index: usize,
    #[serde(default)]
    tabs: Vec<SessionTab>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoredTab {
    saved: SessionTab,
    disk: Option<Document>,
    error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Restored {
    active_index: usize,
    tabs: Vec<RestoredTab>,
    launch_files: Vec<Document>,
}

fn is_text(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|x| x.to_str()).map(|s| s.to_ascii_lowercase()).as_deref(),
        Some("md") | Some("txt")
    )
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn read_document(path: &Path) -> Result<Document, String> {
    if !is_text(path) {
        return Err("Only .md and .txt files are supported.".into());
    }
    let canonical = fs::canonicalize(path).map_err(|_| "File was moved, removed or cannot be accessed.".to_string())?;
    let bytes = fs::read(&canonical).map_err(|_| "File cannot be read (permission denied or unavailable).".to_string())?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("Document exceeds the 32 MB safety limit.".into());
    }
    let revision = digest(&bytes);
    let content = String::from_utf8(bytes).map_err(|_| "File is not UTF-8 text. Export it as UTF-8 before opening.".to_string())?;
    let name = canonical.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "untitled.md".into());
    let line_ending = (if content.contains("\r\n")
        && !content.replace("\r\n", "").contains('\n') { "crlf" } else { "lf" }).to_string();
    Ok(Document { path: canonical.to_string_lossy().to_string(), name, content, revision, line_ending })
}

fn remember(state: &DesktopState, doc: &Document) -> Result<(), String> {
    state.authorized.lock().map_err(|_| "File registry unavailable.".to_string())?
        .insert(doc.path.clone(), doc.revision.clone());
    Ok(())
}

fn session_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|_| "Cannot locate app settings directory.".to_string())?;
    fs::create_dir_all(&dir).map_err(|_| "Cannot create app settings directory.".to_string())?;
    Ok(dir.join("session-v1.json"))
}

fn read_session(app: &tauri::AppHandle) -> Session {
    session_file(app).ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|contents| serde_json::from_str::<Session>(&contents).ok())
        .unwrap_or_default()
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid file location.")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Cannot create a temporary file beside the document.".to_string())?;
    if let Ok(metadata) = fs::metadata(path) {
        temp.as_file().set_permissions(metadata.permissions())
            .map_err(|_| "Could not preserve document permissions.".to_string())?;
    }
    temp.write_all(bytes).and_then(|_| temp.flush()).and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "Could not fully write the temporary file.".to_string())?;
    temp.persist(path).map_err(|_| "Cannot replace the file. Check permissions, locks and available disk space.".to_string())?;
    Ok(())
}

// Textarea editing normalizes newlines. Preserve existing Windows CRLF files.
fn apply_line_ending(source: &str, line_ending: &str) -> Result<String, String> {
    match line_ending {
        "lf" => Ok(source.replace("\r\n", "\n")),
        "crlf" => Ok(source.replace("\r\n", "\n").replace('\n', "\r\n")),
        _ => Err("Invalid line-ending format.".into()),
    }
}

// Testable, disk-level write boundary shared by Save and Save As.
// No file is replaced if a previous revision is missing or diverges.
fn write_checked(
    destination: &Path,
    contents: &str,
    revisions: Option<(&str, &str)>, // expected by tab, most recently authorized
) -> Result<Document, String> {
    if !is_text(destination) {
        return Err("Choose a .md or .txt filename.".into());
    }
    if contents.len() > 32 * 1024 * 1024 {
        return Err("Document exceeds the 32 MB safety limit.".into());
    }
    if let Some((expected, authorized)) = revisions {
        if authorized != expected {
            return Err("The active file revision changed. Reopen or use Save As.".into());
        }
        let disk = read_document(destination)?;
        if disk.revision != expected {
            return Err("The file changed outside Leaf. Your edits are intact. Use Save As.".into());
        }
    }
    atomic_write(destination, contents.as_bytes())?;
    read_document(destination)
}

#[tauri::command]
async fn desktop_open_dialog(app: tauri::AppHandle, state: State<'_, DesktopState>) -> Result<Option<Document>, String> {
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle.dialog().file().add_filter("Markdown and text", &["md", "txt"]).blocking_pick_file()
    }).await.map_err(|_| "Open dialog failed.".to_string())?;
    match picked {
        Some(chosen) => {
            let path = chosen.into_path().map_err(|_| "Unsupported file location.".to_string())?;
            let doc = read_document(&path)?;
            remember(&state, &doc)?;
            Ok(Some(doc))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn desktop_save(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    path: Option<String>,
    expected_revision: Option<String>,
    content: String,
    suggested_name: String,
    save_as: bool,
    line_ending: String,
) -> Result<Option<SaveReceipt>, String> {
    if content.len() > 32 * 1024 * 1024 { return Err("Document exceeds the 32 MB safety limit.".into()); }
    let destination = if save_as || path.is_none() {
        // The OS Save dialog is the only way to authorize a new destination.
        let handle = app.clone();
        let suggested = Path::new(&suggested_name).file_name()
            .map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "untitled.md".into());
        let picked = tauri::async_runtime::spawn_blocking(move || {
            handle.dialog().file().add_filter("Markdown and text", &["md", "txt"])
                .set_file_name(if suggested.is_empty() { "untitled.md" } else { &suggested })
                .blocking_save_file()
        }).await.map_err(|_| "Save dialog failed.".to_string())?;
        match picked {
            Some(file) => file.into_path().map_err(|_| "Unsupported save location.".to_string())?,
            None => return Ok(None),
        }
    } else {
        let selected = path.as_ref().ok_or("Missing file path.")?.clone();
        let accepted = state.authorized.lock().map_err(|_| "File registry unavailable.".to_string())?
            .contains_key(&selected);
        if !accepted { return Err("File was not opened or selected through Leaf.".into()); }
        PathBuf::from(selected)
    };

    let revisions = if !save_as && path.is_some() {
        let expected = expected_revision.ok_or("Document revision is missing. Use Save As.".to_string())?;
        let approved_revision = state.authorized.lock()
            .map_err(|_| "File registry unavailable.".to_string())?
            .get(&path.clone().unwrap_or_default()).cloned()
            .ok_or("File is no longer authorized for saving.")?;
        Some((expected, approved_revision))
    } else {
        None
    };
    let checked = revisions.as_ref().map(|(expected, approved)| (expected.as_str(), approved.as_str()));
    let encoded = apply_line_ending(&content, &line_ending)?;
    let saved = write_checked(&destination, &encoded, checked)?;
    remember(&state, &saved)?;
    Ok(Some(saved.into()))
}

fn permitted_external_url(target: &str) -> bool {
    if target.len() > 2048 || target.chars().any(char::is_control) {
        return false;
    }
    let Ok(parsed) = url::Url::parse(target) else { return false; };
    match parsed.scheme() {
        "http" | "https" => parsed.host_str().is_some()
            && parsed.username().is_empty() && parsed.password().is_none(),
        "mailto" => !parsed.path().is_empty(),
        _ => false,
    }
}

#[tauri::command]
fn desktop_open_external(url: String) -> Result<(), String> {
    if !permitted_external_url(&url) {
        return Err("Only safe web and mail links may open outside Leaf.".into());
    }
    open::that(url).map_err(|_| "Could not open the default application.".to_string())
}

#[tauri::command]
fn desktop_show_releases() -> Result<(), String> {
    // A fixed and reviewed URL. No frontend-provided shell commands or URLs.
    open::that("https://github.com/lgg/leaf/releases")
        .map_err(|_| "Could not launch the default browser.".to_string())
}

fn consume_os_drop(state: &DesktopState, path: &Path) -> Result<bool, String> {
    let canonical = fs::canonicalize(path).map_err(|_| "Dropped file is unavailable.".to_string())?;
    let key = canonical.to_string_lossy().to_string();
    let mut registry = state.dropped.lock().map_err(|_| "File drop registry unavailable.".to_string())?;
    Ok(registry.remove(&key))
}

#[tauri::command]
fn desktop_open_path(path: String, state: State<'_, DesktopState>) -> Result<Document, String> {
    // One-shot authorization is granted only by an OS webview drop event.
    if !consume_os_drop(&state, Path::new(&path))? {
        return Err("Only files actually dropped onto the Leaf window can be opened here.".into());
    }
    let doc = read_document(Path::new(&path))?;
    remember(&state, &doc)?;
    Ok(doc)
}

#[tauri::command]
async fn desktop_export_zip(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<bool, String> {
    if bytes.len() > 32 * 1024 * 1024 { return Err("ZIP export exceeds 32 MB.".into()); }
    let handle = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        handle.dialog().file().add_filter("ZIP archive", &["zip"])
            .set_file_name("leaf-markdown-files.zip").blocking_save_file()
    }).await.map_err(|_| "ZIP export dialog failed.".to_string())?;
    match picked {
        Some(selected) => {
            let path = selected.into_path().map_err(|_| "Unsupported export location.".to_string())?;
            if path.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() != Some("zip") {
                return Err("Choose a .zip filename.".into());
            }
            atomic_write(&path, &bytes)?;
            Ok(true)
        }
        None => Ok(false),
    }
}

#[tauri::command]
fn desktop_restore(app: tauri::AppHandle, state: State<'_, DesktopState>) -> Result<Restored, String> {
    let session = read_session(&app);
    let mut tabs = Vec::new();
    for saved in session.tabs.into_iter().take(60) {
        if let Some(ref path) = saved.path {
            match read_document(Path::new(path)) {
                Ok(doc) => {
                    remember(&state, &doc)?;
                    tabs.push(RestoredTab { saved, disk: Some(doc), error: None });
                }
                Err(err) => tabs.push(RestoredTab { saved, disk: None, error: Some(err) }),
            }
        } else {
            tabs.push(RestoredTab { saved, disk: None, error: None });
        }
    }
    let mut launch_files = Vec::new();
    for arg in std::env::args_os().skip(1).take(10) {
        let path = PathBuf::from(arg);
        if !is_text(&path) { continue; }
        if let Ok(doc) = read_document(&path) {
            remember(&state, &doc)?;
            launch_files.push(doc);
        }
    }
    Ok(Restored { active_index: session.active_index, tabs, launch_files })
}

#[tauri::command]
fn desktop_save_session(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    session: Session,
) -> Result<(), String> {
    if session.tabs.len() > 60 { return Err("Too many open tabs for session recovery.".into()); }
    {
        let allowed = state.authorized.lock().map_err(|_| "File registry unavailable.".to_string())?;
        for tab in &session.tabs {
            if let Some(path) = &tab.path {
                if !allowed.contains_key(path) { return Err("Cannot persist an unauthorized file location.".into()); }
            }
            if tab.draft.as_ref().is_some_and(|s| s.len() > 32 * 1024 * 1024) {
                return Err("Recovery draft exceeds the 32 MB safety limit.".into());
            }
        }
    }
    let path = session_file(&app)?;
    let bytes = serde_json::to_vec(&session).map_err(|_| "Could not serialize session.".to_string())?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("Recovery session exceeds 64 MB. Save or export large documents first.".into());
    }
    atomic_write(&path, &bytes)
}

fn main() {
    tauri::Builder::default()
        .on_webview_event(|webview, event| {
            if webview.label() != "main" { return; }
            if let tauri::WebviewEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let state = webview.state::<DesktopState>();
                let mut allowed = match state.dropped.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                allowed.clear();
                for path in paths {
                    if !is_text(path) { continue; }
                    if let Ok(canonical) = fs::canonicalize(path) {
                        allowed.insert(canonical.to_string_lossy().to_string());
                    }
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_open_dialog, desktop_open_path, desktop_export_zip, desktop_open_external, desktop_show_releases, desktop_save, desktop_restore, desktop_save_session
        ])
        .run(tauri::generate_context!())
        .expect("Leaf desktop could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn save_receipt_does_not_retransmit_original_document_contents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"private text should not be returned on save").unwrap();
        let document = read_document(&path).unwrap();
        let metadata = serde_json::to_value(SaveReceipt::from(document)).unwrap();
        assert_eq!(metadata.get("name").and_then(|v| v.as_str()), Some("note.md"));
        assert!(metadata.get("revision").is_some());
        assert!(metadata.get("lineEnding").is_some());
        assert!(metadata.get("content").is_none());
    }

    #[test]
    fn source_line_endings_are_preserved_through_normalized_textarea_edits() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("windows.md");
        fs::write(&path, b"first\r\nsecond\r\n").unwrap();
        let opened = read_document(&path).unwrap();
        assert_eq!(opened.line_ending, "crlf");
        let encoded = apply_line_ending("first\nchanged\n", &opened.line_ending).unwrap();
        assert_eq!(encoded, "first\r\nchanged\r\n");
        let saved = write_checked(&path, &encoded, Some((&opened.revision, &opened.revision))).unwrap();
        assert_eq!(saved.line_ending, "crlf");
        assert_eq!(fs::read(&path).unwrap().as_slice(), b"first\r\nchanged\r\n");
        assert!(apply_line_ending("text", "invalid").is_err());
    }

    #[test]
    fn external_links_reject_local_files_custom_protocols_and_phishing_userinfo() {
        assert!(permitted_external_url("https://example.com/a"));
        assert!(permitted_external_url("http://example.com"));
        assert!(permitted_external_url("mailto:editor@example.com"));
        for disallowed in [
            "file:///C:/secrets.txt", "javascript:alert(1)", "cmd://powershell",
            "https://attacker@example.com/", "https://", "https://example.com\nunsafe"
        ] {
            assert!(!permitted_external_url(disallowed), "disallowed: {disallowed}");
        }
    }

    #[test]
    fn only_markdown_and_plaintext_files_are_allowed() {
        assert!(is_text(Path::new("note.MD")));
        assert!(is_text(Path::new("note.txt")));
        assert!(!is_text(Path::new("note.html")));
        assert!(!is_text(Path::new("note.md.exe")));
    }
    #[test]
    fn digest_changes_when_content_changes() {
        assert_ne!(digest(b"draft"), digest(b"edited"));
    }
    #[test]
    fn sessions_round_trip_without_losing_metadata() {
        let source = Session { active_index: 0, tabs: vec![SessionTab {
            path: None, name: "draft.md".into(), label: "Draft".into(),
            browser_title: "My title".into(), dirty: true,
            draft: Some("hello".into()), revision: None,
        }] };
        let decoded: Session = serde_json::from_slice(&serde_json::to_vec(&source).unwrap()).unwrap();
        assert_eq!(decoded.tabs[0].label, "Draft");
        assert_eq!(decoded.tabs[0].draft.as_deref(), Some("hello"));
    }
    #[test]
    fn os_dropped_file_access_is_one_shot() {
        let state = DesktopState::default();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        fs::write(&path, b"allowed").unwrap();
        assert!(!consume_os_drop(&state, &path).unwrap());
        let canonical = fs::canonicalize(&path).unwrap();
        state.dropped.lock().unwrap().insert(canonical.to_string_lossy().to_string());
        assert!(consume_os_drop(&state, &path).unwrap());
        assert!(!consume_os_drop(&state, &path).unwrap());
    }
    #[test]
    fn arbitrary_file_extensions_cannot_be_opened_even_if_dropped() {
        assert!(!is_text(Path::new("secrets.key")));
        assert!(!is_text(Path::new("script.md.exe")));
    }
    #[test]
    fn save_existing_document_preserves_file_identity_and_content() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("draft.md");
        fs::write(&path, b"first").unwrap();
        let original = read_document(&path).unwrap();
        let saved = write_checked(&path, "second", Some((&original.revision, &original.revision))).unwrap();
        assert_eq!(saved.path, original.path);
        assert_eq!(saved.content, "second");
        assert_ne!(saved.revision, original.revision);
    }

    #[test]
    fn concurrent_external_changes_are_not_overwritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("draft.md");
        fs::write(&path, b"first").unwrap();
        let original = read_document(&path).unwrap();
        fs::write(&path, b"external").unwrap();
        let result = write_checked(&path, "my edit", Some((&original.revision, &original.revision)));
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "external");
    }

    #[test]
    fn stale_tab_revision_is_rejected_even_if_disk_matches_current_tab() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("draft.txt");
        fs::write(&path, b"unchanged").unwrap();
        let revision = read_document(&path).unwrap().revision;
        let result = write_checked(&path, "my edit", Some((&revision, "outdated-tab")));
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "unchanged");
    }

    #[test]
    fn deleted_file_is_not_silently_recreated_on_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("draft.md");
        fs::write(&path, b"first").unwrap();
        let revision = read_document(&path).unwrap().revision;
        fs::remove_file(&path).unwrap();
        assert!(write_checked(&path, "new", Some((&revision, &revision))).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn save_as_does_not_modify_original_file() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.md");
        let destination = dir.path().join("copy.md");
        fs::write(&original, b"original").unwrap();
        write_checked(&destination, "new copy", None).unwrap();
        assert_eq!(fs::read_to_string(&original).unwrap(), "original");
        assert_eq!(fs::read_to_string(&destination).unwrap(), "new copy");
    }

    #[test]
    fn native_save_rejects_non_text_targets() {
        let dir = tempfile::tempdir().unwrap();
        let forbidden = dir.path().join("installer.exe");
        assert!(write_checked(&forbidden, "danger", None).is_err());
        assert!(!forbidden.exists());
    }

    #[test]
    fn atomic_write_replaces_document() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, b"first").unwrap();
        assert_eq!(read_document(&path).unwrap().content, "first");
        atomic_write(&path, b"second").unwrap();
        assert_eq!(read_document(&path).unwrap().content, "second");
    }
}
