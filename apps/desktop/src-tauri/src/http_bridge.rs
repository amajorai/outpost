use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};
use std::time::Duration;

use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::acp::{tool_definitions, ToolResultSender};

static CALL_COUNTER: AtomicU64 = AtomicU64::new(0);

fn generate_call_id() -> String {
    let n = CALL_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("http_{n}")
}

#[derive(Clone)]
pub struct HttpBridgeState {
    pub pending: Arc<Mutex<HashMap<String, ToolResultSender>>>,
    pub app: AppHandle,
}

/// Per-request guard shared by every bridge route.
///
/// Runs before any handler and enforces two checks that together neutralise the
/// "any website can POST to localhost" class of attack:
///
/// 1. **Host header pinning** rejects requests whose `Host` is not exactly one
///    of the loopback names the bridge listens on. This blocks DNS-rebinding,
///    where an attacker resolves their own domain to `127.0.0.1` and relies on
///    the browser sending their hostname in the `Host` header.
/// 2. **Shared-secret token** (`Authorization: Bearer <token>` or
///    `X-Outpost-Token: <token>`) rejects any caller that cannot present the
///    per-install secret. A random web page cannot read the token, so even a
///    same-origin-policy-bypassing simple `fetch` gets a `401`.
///
/// The token comparison is constant-time to avoid leaking it via timing.
#[derive(Clone)]
struct AuthState {
    token: String,
    port: u16,
}

fn host_is_allowed(host: &str, port: u16) -> bool {
    // A bare host without a port is only valid on the default HTTP port (80),
    // which the bridge never uses, so always require an explicit `:port`.
    let expected_v4 = format!("127.0.0.1:{port}");
    let expected_localhost = format!("localhost:{port}");
    host == expected_v4 || host == expected_localhost
}

fn presented_token(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(value) = headers.get("x-outpost-token").and_then(|v| v.to_str().ok()) {
        return Some(value.to_string());
    }
    let auth = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    auth.strip_prefix("Bearer ")
        .map(|rest| rest.trim().to_string())
}

async fn auth_middleware(
    State(auth): State<AuthState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let host = request
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !host_is_allowed(host, auth.port) {
        // 421 Misdirected Request: the Host does not match a name we serve.
        return (
            StatusCode::MISDIRECTED_REQUEST,
            "Invalid Host header",
        )
            .into_response();
    }

    let presented = presented_token(request.headers());
    let authorized = presented
        .as_deref()
        .map(|t| constant_time_eq::constant_time_eq(t.as_bytes(), auth.token.as_bytes()))
        .unwrap_or(false);

    if !authorized {
        return (StatusCode::UNAUTHORIZED, "Missing or invalid bridge token").into_response();
    }

    next.run(request).await
}

#[derive(Serialize)]
struct ToolsResponse {
    tools: serde_json::Value,
}

#[derive(Deserialize)]
struct ToolCallRequest {
    name: String,
    arguments: serde_json::Value,
}

#[derive(Deserialize)]
struct McpRequest {
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct ToolCallResponse {
    content: Vec<ToolContent>,
    #[serde(rename = "isError")]
    is_error: bool,
}

#[derive(Serialize)]
struct ToolContent {
    #[serde(rename = "type")]
    content_type: String,
    text: String,
}

async fn handle_list_tools(State(s): State<HttpBridgeState>) -> impl IntoResponse {
    let _ = s;
    Json(ToolsResponse {
        tools: tool_definitions(),
    })
}

async fn handle_tool_call(
    State(s): State<HttpBridgeState>,
    Json(body): Json<ToolCallRequest>,
) -> impl IntoResponse {
    call_tool(s, body.name, body.arguments).await
}

async fn call_tool(
    s: HttpBridgeState,
    name: String,
    arguments: serde_json::Value,
) -> (StatusCode, Json<ToolCallResponse>) {
    let call_id = generate_call_id();

    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<serde_json::Value, String>>(1);
    s.pending.lock().unwrap().insert(call_id.clone(), tx);

    let emit_result = s.app.emit(
        "acp-tool-call",
        serde_json::json!({
            "callId": call_id,
            "toolName": name,
            "arguments": arguments,
        }),
    );

    if emit_result.is_err() {
        s.pending.lock().unwrap().remove(&call_id);
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ToolCallResponse {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: "Failed to emit tool call event".to_string(),
                }],
                is_error: true,
            }),
        );
    }

    let result =
        tokio::task::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(30))).await;

    s.pending.lock().unwrap().remove(&call_id);

    match result {
        Ok(Ok(Ok(value))) => (
            StatusCode::OK,
            Json(ToolCallResponse {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: match &value {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    },
                }],
                is_error: false,
            }),
        ),
        Ok(Ok(Err(err))) => (
            StatusCode::OK,
            Json(ToolCallResponse {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: err,
                }],
                is_error: true,
            }),
        ),
        _ => (
            StatusCode::GATEWAY_TIMEOUT,
            Json(ToolCallResponse {
                content: vec![ToolContent {
                    content_type: "text".to_string(),
                    text: "Tool call timed out after 30 seconds".to_string(),
                }],
                is_error: true,
            }),
        ),
    }
}

/// Ingest endpoint for the browser extension (Unit U18).
///
/// The extension's background script POSTs a detected user-authored post here.
/// To avoid a CORS preflight from the extension's service worker, the body is
/// sent as `text/plain` and parsed manually rather than via the `Json` extractor
/// (which would require an `application/json` content type).
///
/// For this unit we only receive the payload and re-emit it as a `detected-post`
/// Tauri event. Unit U19 consumes the event to drive optional cross-posting.
async fn handle_detected_post(State(s): State<HttpBridgeState>, raw_body: String) -> Response {
    let payload: serde_json::Value = match serde_json::from_str(&raw_body) {
        Ok(value) => value,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({
                    "ok": false,
                    "error": format!("Invalid JSON body: {err}"),
                })),
            )
                .into_response();
        }
    };

    let emit_result = s.app.emit("detected-post", &payload);

    if emit_result.is_err() {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({
                "ok": false,
                "error": "Failed to emit detected-post event",
            })),
        )
            .into_response();
    }

    (
        StatusCode::OK,
        Json(serde_json::json!({ "ok": true })),
    )
        .into_response()
}

async fn handle_mcp(State(s): State<HttpBridgeState>, Json(body): Json<McpRequest>) -> Response {
    let id = body.id.unwrap_or(serde_json::Value::Null);
    let response = match body.method.as_str() {
        "initialize" => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": body
                    .params
                    .as_ref()
                    .and_then(|p| p.get("protocolVersion"))
                    .cloned()
                    .unwrap_or_else(|| serde_json::json!("2024-11-05")),
                "capabilities": {
                    "tools": {}
                },
                "serverInfo": {
                    "name": "outpost",
                    "version": "0.0.1"
                }
            }
        }),
        "tools/list" => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "tools": tool_definitions()
            }
        }),
        "tools/call" => {
            let params = body.params.unwrap_or_default();
            let name = params
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let arguments = params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            let (status, Json(result)) = call_tool(s, name, arguments).await;
            if status == StatusCode::OK {
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": result
                })
            } else {
                serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {
                        "code": -32000,
                        "message": result
                            .content
                            .first()
                            .map(|content| content.text.clone())
                            .unwrap_or_else(|| "Tool call failed".to_string())
                    }
                })
            }
        }
        _ => serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {
                "code": -32601,
                "message": format!("Method not found: {}", body.method)
            }
        }),
    };

    Json(response).into_response()
}

pub async fn start(
    pending: Arc<Mutex<HashMap<String, ToolResultSender>>>,
    app: AppHandle,
    port: u16,
    token: String,
) {
    let state = HttpBridgeState { pending, app };
    let auth = AuthState { token, port };

    let router = Router::new()
        .route("/api/tools", get(handle_list_tools))
        .route("/api/tools/call", post(handle_tool_call))
        .route("/mcp", post(handle_mcp))
        .route("/api/detected-post", post(handle_detected_post))
        // Host + token validation runs ahead of every route above.
        .layer(middleware::from_fn_with_state(auth, auth_middleware))
        .with_state(state);

    // Bind loopback only (never 0.0.0.0): the bridge must not be reachable from
    // other machines on the network.
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(_) => return,
    };

    let _ = axum::serve(listener, router).await;
}
