use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::SystemTime,
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, Mutex};

// ---------- app state ----------

#[derive(Clone)]
struct AppState {
    pool: Pool,
    rooms: Rooms,
}

type Rooms = Arc<Mutex<HashMap<String, broadcast::Sender<Message>>>>;

static NEXT_CLIENT_ID: AtomicU64 = AtomicU64::new(1);

// ---------- DB ----------

const INIT_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS patterns (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    author     TEXT NOT NULL DEFAULT 'anon',
    data       JSONB NOT NULL,
    likes      INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"#;

async fn db_pool() -> Pool {
    let mgr_config = ManagerConfig {
        recycling_method: RecyclingMethod::Fast,
    };
    let mgr = Manager::from_config(
        "host=localhost user=thump password=thump dbname=thump"
            .parse()
            .unwrap(),
        tokio_postgres::NoTls,
        mgr_config,
    );
    Pool::builder(mgr).max_size(8).build().unwrap()
}

fn gen_id() -> String {
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut rng = rand::rng();
    (0..8)
        .map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char)
        .collect()
}

// ---------- API models ----------

#[derive(Deserialize)]
struct SavePattern {
    title: String,
    #[serde(default)]
    author: String,
    data: Value,
}

#[derive(Serialize)]
struct SavedPattern {
    id: String,
}

#[derive(Serialize)]
struct PatternMeta {
    id: String,
    title: String,
    author: String,
    likes: i32,
    created_at: String,
}

#[derive(Serialize)]
struct PatternFull {
    id: String,
    title: String,
    author: String,
    data: Value,
    likes: i32,
}

// ---------- handlers ----------

async fn list_patterns(State(state): State<AppState>) -> impl IntoResponse {
    let client = match state.pool.get().await {
        Ok(c) => c,
        Err(e) => return err500(e),
    };
    let rows = match client
        .query(
            "SELECT id, title, author, likes, created_at
             FROM patterns ORDER BY created_at DESC LIMIT 60",
            &[],
        )
        .await
    {
        Ok(r) => r,
        Err(e) => return err500(e),
    };
    let out: Vec<PatternMeta> = rows
        .iter()
        .map(|r| PatternMeta {
            id: r.get(0),
            title: r.get(1),
            author: r.get(2),
            likes: r.get(3),
            created_at: fmt_time(r.get(4)),
        })
        .collect();
    Json(out).into_response()
}

async fn save_pattern(
    State(state): State<AppState>,
    Json(body): Json<SavePattern>,
) -> impl IntoResponse {
    if body.data.is_null() {
        return (StatusCode::BAD_REQUEST, Json("missing data".to_string())).into_response();
    }
    let id = gen_id();
    let author: String = if body.author.trim().is_empty() {
        "anon".into()
    } else {
        body.author.trim().chars().take(24).collect()
    };
    let t = body.title.trim();
    let title: String = if t.is_empty() {
        "untitled".into()
    } else {
        t.chars().take(64).collect()
    };

    let client = match state.pool.get().await {
        Ok(c) => c,
        Err(e) => return err500(e),
    };
    if let Err(e) = client
        .execute(
            "INSERT INTO patterns (id, title, author, data) VALUES ($1, $2, $3, $4)",
            &[&id, &title, &author, &body.data],
        )
        .await
    {
        return err500(e);
    }
    tracing::info!("saved pattern {id} ({title} by {author})");
    Json(SavedPattern { id }).into_response()
}

async fn get_pattern(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let client = match state.pool.get().await {
        Ok(c) => c,
        Err(e) => return err500(e),
    };
    match client
        .query_opt(
            "SELECT id, title, author, data, likes FROM patterns WHERE id = $1",
            &[&id],
        )
        .await
    {
        Ok(Some(r)) => {
            let p = PatternFull {
                id: r.get(0),
                title: r.get(1),
                author: r.get(2),
                data: r.get(3),
                likes: r.get(4),
            };
            Json(p).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json("not found".to_string())).into_response(),
        Err(e) => err500(e),
    }
}

async fn like_pattern(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let client = match state.pool.get().await {
        Ok(c) => c,
        Err(e) => return err500(e),
    };
    match client
        .query_opt(
            "UPDATE patterns SET likes = likes + 1 WHERE id = $1 RETURNING likes",
            &[&id],
        )
        .await
    {
        Ok(Some(r)) => {
            let likes: i32 = r.get(0);
            Json(serde_json::json!({ "likes": likes })).into_response()
        }
        _ => (StatusCode::NOT_FOUND, Json("not found".to_string())).into_response(),
    }
}

fn err500<E: std::fmt::Display>(e: E) -> axum::response::Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(e.to_string()),
    )
        .into_response()
}

fn fmt_time(t: SystemTime) -> String {
    let secs = t
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // minimal UTC formatter (no chrono dep)
    let days = secs / 86400;
    let rem = secs % 86400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil-from-days algorithm (Howard Hinnant)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if mo <= 2 { y + 1 } else { y };
    format!("{y:04}-{mo:02}-{d:02} {h:02}:{m:02}:{s:02}Z")
}

// ---------- jam rooms ----------

#[derive(Deserialize)]
struct RoomQuery {
    room: Option<String>,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<RoomQuery>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    let room_name = q.room.unwrap_or_else(|| "lobby".to_string());
    ws.on_upgrade(move |socket| handle_socket(socket, state.rooms, room_name))
}

async fn handle_socket(mut socket: WebSocket, rooms: Rooms, room_name: String) {
    let bcast_tx = {
        let mut map = rooms.lock().await;
        map.entry(room_name.clone())
            .or_insert_with(|| broadcast::channel::<Message>(256).0)
            .clone()
    };
    let client_id = NEXT_CLIENT_ID.fetch_add(1, Ordering::Relaxed);
    let mut bcast_rx = bcast_tx.subscribe();

    let members = bcast_tx.receiver_count();
    let _ = socket
        .send(Message::Text(
            serde_json::json!({
                "type": "hello",
                "clientId": client_id,
                "members": members,
                "room": room_name
            })
            .to_string()
            .into(),
        ))
        .await;

    let (mut ws_tx, mut ws_rx) = socket.split();

    let outbound = async move {
        loop {
            match bcast_rx.recv().await {
                Ok(msg) => {
                    // don't echo the sender's own messages back
                    if let Message::Text(ref t) = msg {
                        if let Ok(v) = serde_json::from_str::<Value>(t.as_str()) {
                            if v.get("from").and_then(Value::as_u64) == Some(client_id) {
                                continue;
                            }
                        }
                    }
                    if ws_tx.send(msg).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            }
        }
    };

    let inbound = async {
        while let Some(Ok(msg)) = ws_rx.next().await {
            if matches!(msg, Message::Close(_)) {
                break;
            }
            let tagged = match msg {
                Message::Text(t) => {
                    let mut v: Value =
                        serde_json::from_str::<Value>(t.as_str()).unwrap_or_default();
                    v["from"] = client_id.into();
                    Message::Text(v.to_string().into())
                }
                other => other,
            };
            let _ = bcast_tx.send(tagged);
        }
        let mut map = rooms.lock().await;
        if let Some(s) = map.get(&room_name) {
            if s.receiver_count() <= 1 {
                map.remove(&room_name);
            }
        }
    };

    tokio::join!(outbound, inbound);
}

// ---------- main ----------

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let pool = db_pool().await;
    {
        let client = pool.get().await.expect("db connection failed");
        client.execute(INIT_SQL, &[]).await.expect("init schema");
    }

    let static_dir = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "../".to_string());

    let app = Router::new()
        .route("/api/patterns", get(list_patterns).post(save_pattern))
        .route("/api/patterns/{id}", get(get_pattern))
        .route("/api/patterns/{id}/like", post(like_pattern))
        .route("/ws", get(ws_handler))
        .fallback_service(
            tower_http::services::ServeDir::new(&static_dir)
                .append_index_html_on_directories(true),
        )
        .with_state(AppState {
            pool,
            rooms: Arc::new(Mutex::new(HashMap::new())),
        });

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));
    tracing::info!("THUMP server listening on http://{addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
