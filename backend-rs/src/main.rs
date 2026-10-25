mod models;
mod db;
mod auth;
mod routes;

use std::path::PathBuf;
use axum::{
    routing::{get, patch, post},
    Router,
};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::info;
use crate::db::Database;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub session_secret: String,
    pub wistapay_api_key: Option<String>,
    pub wistapay_base_url: String,
    pub telegram_bot_token: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Muat environment variable
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env()
            .add_directive(tracing::Level::INFO.into()))
        .init();

    // 2. Tentukan path database dan root static file
    let exe_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let root_dir = if exe_dir.join("data").exists() {
        exe_dir.clone()
    } else if exe_dir.parent().map(|p| p.join("data").exists()).unwrap_or(false) {
        exe_dir.parent().unwrap().to_path_buf()
    } else {
        exe_dir.clone()
    };

    let db_path = std::env::var("WK_DB")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root_dir.join("data").join("db.json"));

    info!("[init] Memuat database dari: {}", db_path.display());
    info!("[init] Menyajikan static web dari: {}", root_dir.display());

    let database = Database::load(db_path).await;

    let session_secret = std::env::var("SESSION_SECRET")
        .unwrap_or_else(|_| "pojokai-secure-owner-session-key-v1".to_string());
    let wistapay_api_key = std::env::var("WISTAPAY_API_KEY").ok();
    let wistapay_base_url = std::env::var("WISTAPAY_BASE_URL")
        .unwrap_or_else(|_| "https://wistapay.shop/wistapay/api".to_string());
    let telegram_bot_token = std::env::var("TELEGRAM_BOT_TOKEN").unwrap_or_default();

    let state = AppState {
        db: database,
        session_secret,
        wistapay_api_key,
        wistapay_base_url,
        telegram_bot_token,
    };

    // 3. Bangun Router Axum
    let api_routes = Router::new()
        .route("/catalog", get(routes::catalog::get_catalog))
        .route("/bundle", get(routes::catalog::get_bundle).patch(routes::products::update_bundle))
        .route("/session", get(routes::auth::get_session))
        .route("/login", post(routes::auth::login))
        .route("/logout", post(routes::auth::logout))
        .route("/setup", post(routes::auth::setup))
        .route("/password", post(routes::auth::change_password))
        .route("/products", post(routes::products::create_product))
        .route("/products/:slug", patch(routes::products::update_product).delete(routes::products::delete_product))
        .route("/orders", get(routes::orders::get_orders).post(routes::orders::create_order))
        .route("/orders/expire", post(routes::orders::expire_order))
        .route("/qris/create", post(routes::qris::create_qris))
        .route("/qris/status", get(routes::qris::get_qris_status))
        .route("/wistapay-webhook", post(routes::qris::wistapay_webhook))
        .route("/telegram-webhook", post(routes::telegram::telegram_webhook));

    let static_service = ServeDir::new(&root_dir).append_index_html_on_directories(true);

    let app = Router::new()
        .nest("/api", api_routes)
        .fallback_service(static_service)
        .layer(CorsLayer::permissive())
        .with_state(state);

    // 4. Jalankan TCP Listener
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let addr = std::net::SocketAddr::from(([0, 0, 0, 0], port));

    info!("🚀 PojokAI Rust High-Performance Server berjalan di http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
