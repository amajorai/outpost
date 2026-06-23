//! Per-install shared secret for the local privileged HTTP bridge.
//!
//! The Axum bridge (see `http_bridge.rs`) exposes privileged endpoints on
//! `127.0.0.1`. Loopback binding plus Host-header validation stop remote and
//! DNS-rebinding attacks, but any web page the user visits can still issue a
//! same-machine `fetch` to `http://localhost:37842`. To stop a malicious page
//! from driving tool execution or injecting fake detected posts, every request
//! must present this secret. A random website cannot read it; the legitimate
//! clients (the local MCP proxy and the browser extension, configured once by
//! the user) can.
//!
//! The token is persisted (load-or-create) rather than regenerated each launch
//! so the user's one-time extension/MCP setup keeps working across restarts.
//! It lives in a fixed dotfile under the home directory so the Node MCP server
//! can locate it with `os.homedir()` without replicating Tauri's bundle-id path
//! logic. On Unix the file is created with `0600` permissions.

use base64::Engine as _;
use rand::RngCore;
use std::fs;
use std::path::PathBuf;

/// Managed Tauri state holding the active bridge token.
#[derive(Clone)]
pub struct BridgeToken(pub String);

/// Directory holding the shared token file: `~/.outpost`.
fn token_dir(home_dir: &std::path::Path) -> PathBuf {
    home_dir.join(".outpost")
}

/// Path to the shared token file: `~/.outpost/bridge-token`.
fn token_file(home_dir: &std::path::Path) -> PathBuf {
    token_dir(home_dir).join("bridge-token")
}

/// Generate a 256-bit URL-safe random token.
fn generate_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

#[cfg(unix)]
fn write_token_file(path: &std::path::Path, token: &str) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::io::Write as _;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(token.as_bytes())
}

#[cfg(not(unix))]
fn write_token_file(path: &std::path::Path, token: &str) -> std::io::Result<()> {
    fs::write(path, token.as_bytes())
}

/// Load the persisted bridge token, or generate and persist a new one.
///
/// A missing/empty/oversized file is treated as absent and regenerated so a
/// corrupted file can never wedge the bridge.
pub fn load_or_create(home_dir: &std::path::Path) -> String {
    let dir = token_dir(home_dir);
    let file = token_file(home_dir);

    if let Ok(contents) = fs::read_to_string(&file) {
        let trimmed = contents.trim();
        if !trimmed.is_empty() && trimmed.len() <= 256 {
            return trimmed.to_string();
        }
    }

    let token = generate_token();
    // Best-effort persistence: if the directory or file cannot be written, the
    // bridge still works for this session (the in-memory token is authoritative);
    // only cross-process clients reading the file would be affected.
    let _ = fs::create_dir_all(&dir);
    let _ = write_token_file(&file, &token);
    token
}
