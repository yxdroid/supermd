use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager, State, Url};

const OPENED_MARKDOWN_FILES_EVENT: &str = "supermd://opened-files";

#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<String>>);

#[derive(Debug, Serialize)]
pub struct DocumentPayload {
    path: String,
    content: String,
    size: u64,
    mtime: u128,
    encoding: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentFile {
    path: String,
    name: String,
    opened_at: u128,
}

#[derive(Debug, Serialize)]
pub struct SaveResult {
    path: String,
    size: u64,
    saved_at: u128,
}

#[derive(Debug, Serialize)]
pub struct AssetResult {
    original: String,
    resolved: String,
    is_remote: bool,
}

#[tauri::command]
fn open_markdown_file(path: Option<String>, app: AppHandle) -> Result<DocumentPayload, String> {
    let selected = match path.filter(|value| !value.trim().is_empty()) {
        Some(value) => PathBuf::from(value),
        None => rfd::FileDialog::new()
            .add_filter("Markdown", &["md", "markdown", "mdown", "mkd"])
            .pick_file()
            .ok_or_else(|| "未选择文件".to_string())?,
    };

    let content = fs::read_to_string(&selected).map_err(|error| format!("读取失败：{error}"))?;
    let metadata = fs::metadata(&selected).map_err(|error| format!("读取文件信息失败：{error}"))?;
    let mtime = metadata.modified().ok().map(system_time_ms).unwrap_or_default();
    let path = selected.to_string_lossy().to_string();

    remember_file(&app, &path)?;

    Ok(DocumentPayload {
        path,
        content,
        size: metadata.len(),
        mtime,
        encoding: "utf-8".to_string(),
    })
}

#[tauri::command]
fn save_markdown_file(path: String, content: String) -> Result<SaveResult, String> {
    fs::write(&path, content.as_bytes()).map_err(|error| format!("保存失败：{error}"))?;
    let metadata = fs::metadata(&path).map_err(|error| format!("读取保存结果失败：{error}"))?;

    Ok(SaveResult {
        path,
        size: metadata.len(),
        saved_at: system_time_ms(SystemTime::now()),
    })
}

#[tauri::command]
fn resolve_asset_path(document_path: String, asset_src: String) -> AssetResult {
    let is_remote = is_remote_or_data_url(&asset_src);
    let resolved = if is_remote {
        asset_src.clone()
    } else {
        resolve_local_asset(&document_path, &asset_src)
    };

    AssetResult {
        original: asset_src,
        resolved,
        is_remote,
    }
}

#[tauri::command]
fn get_recent_files(app: AppHandle) -> Result<Vec<RecentFile>, String> {
    read_recent_files(&app)
}

#[tauri::command]
fn take_pending_open_files(state: State<'_, PendingOpenFiles>) -> Vec<String> {
    state
        .0
        .lock()
        .map(|mut paths| std::mem::take(&mut *paths))
        .unwrap_or_default()
}

pub fn run() {
    let context = tauri::generate_context!();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingOpenFiles::default())
        .invoke_handler(tauri::generate_handler![
            open_markdown_file,
            save_markdown_file,
            resolve_asset_path,
            get_recent_files,
            take_pending_open_files
        ])
        .build(context)
        .expect("error while building SuperMD")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                handle_opened_urls(app, urls);
            }
        });
}

#[cfg(target_os = "macos")]
fn handle_opened_urls(app: &AppHandle, urls: Vec<Url>) {
    let paths: Vec<String> = urls
        .iter()
        .filter_map(opened_url_to_markdown_path)
        .collect();

    if paths.is_empty() {
        return;
    }

    if let Some(state) = app.try_state::<PendingOpenFiles>() {
        if let Ok(mut pending) = state.0.lock() {
            pending.extend(paths.iter().cloned());
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    let _ = app.emit(OPENED_MARKDOWN_FILES_EVENT, paths);
}

fn resolve_local_asset(document_path: &str, asset_src: &str) -> String {
    let asset = Path::new(asset_src);
    if asset.is_absolute() {
        return normalize_path(asset).to_string_lossy().to_string();
    }

    let base = Path::new(document_path).parent().unwrap_or_else(|| Path::new(""));
    normalize_path(&base.join(asset)).to_string_lossy().to_string()
}

fn normalize_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }

    normalized
}

fn is_remote_or_data_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.starts_with("https://")
        || lower.starts_with("data:")
        || lower.starts_with("blob:")
        || lower.starts_with("asset:")
        || lower.starts_with("file:")
        || lower.starts_with("//")
}

fn opened_url_to_markdown_path(url: &Url) -> Option<String> {
    if url.scheme() != "file" {
        return None;
    }

    let path = url.to_file_path().ok()?;
    is_markdown_path(&path).then(|| path.to_string_lossy().to_string())
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "mdown" | "mkd"
            )
        })
        .unwrap_or(false)
}

fn remember_file(app: &AppHandle, path: &str) -> Result<(), String> {
    let mut files = read_recent_files(app).unwrap_or_default();
    files.retain(|file| file.path != path);
    files.insert(
        0,
        RecentFile {
            path: path.to_string(),
            name: Path::new(path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string()),
            opened_at: system_time_ms(SystemTime::now()),
        },
    );
    files.truncate(8);

    let store_path = recent_store_path(app)?;
    if let Some(parent) = store_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("创建配置目录失败：{error}"))?;
    }
    fs::write(
        store_path,
        serde_json::to_vec_pretty(&files).map_err(|error| format!("序列化最近文件失败：{error}"))?,
    )
    .map_err(|error| format!("写入最近文件失败：{error}"))?;

    Ok(())
}

fn read_recent_files(app: &AppHandle) -> Result<Vec<RecentFile>, String> {
    let store_path = recent_store_path(app)?;
    if !store_path.exists() {
        return Ok(Vec::new());
    }

    let bytes = fs::read(store_path).map_err(|error| format!("读取最近文件失败：{error}"))?;
    serde_json::from_slice(&bytes).map_err(|error| format!("解析最近文件失败：{error}"))
}

fn recent_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join("recent-files.json"))
        .map_err(|error| format!("获取配置目录失败：{error}"))
}

fn system_time_ms(time: SystemTime) -> u128 {
    time.duration_since(UNIX_EPOCH).unwrap_or_default().as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opened_url_to_markdown_path_accepts_markdown_file_urls() {
        let url = Url::parse("file:///Users/demo/Notes/README.MD").unwrap();

        assert_eq!(
            opened_url_to_markdown_path(&url),
            Some("/Users/demo/Notes/README.MD".to_string())
        );
    }

    #[test]
    fn opened_url_to_markdown_path_ignores_non_markdown_and_non_file_urls() {
        let image = Url::parse("file:///Users/demo/Notes/image.png").unwrap();
        let remote = Url::parse("https://example.com/readme.md").unwrap();

        assert_eq!(opened_url_to_markdown_path(&image), None);
        assert_eq!(opened_url_to_markdown_path(&remote), None);
    }
}
