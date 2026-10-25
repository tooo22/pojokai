use axum::{
    extract::State,
    response::{IntoResponse, Json, Response},
};
use serde_json::{json, Value};
use crate::AppState;

pub async fn telegram_webhook(
    State(state): State<AppState>,
    Json(body): Json<Value>,
) -> Response {
    let token = state.telegram_bot_token.clone();
    if token.is_empty() {
        return Json(json!({ "ok": true })).into_response();
    }

    let chat_id = body.get("message")
        .and_then(|m| m.get("chat"))
        .and_then(|c| c.get("id"))
        .or_else(|| {
            body.get("callback_query")
                .and_then(|cb| cb.get("message"))
                .and_then(|m| m.get("chat"))
                .and_then(|c| c.get("id"))
        })
        .and_then(|v| v.as_i64());

    let text = body.get("message")
        .and_then(|m| m.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("");

    if let Some(cid) = chat_id {
        if text.starts_with("/start") {
            let client = reqwest::Client::new();
            let welcome_text = "👋 <b>Selamat datang di PojokAI Official Store!</b>\n\nToko akun digital legal, murah, dan terpercaya.\nSilakan gunakan menu di bawah untuk mulai berbelanja:";
            let send_url = format!("https://api.telegram.org/bot{}/sendMessage", token);

            let keyboard = json!({
                "inline_keyboard": [
                    [{"text": "🛍️ Buka Web Toko", "web_app": {"url": "https://pojokai.my.id"}}],
                    [{"text": "📦 Cek Pesanan", "callback_data": "menu_check_order"}],
                    [{"text": "💬 Hubungi Admin", "url": "https://wa.me/6283171982973"}]
                ]
            });

            let _ = client.post(&send_url)
                .json(&json!({
                    "chat_id": cid,
                    "text": welcome_text,
                    "parse_mode": "HTML",
                    "reply_markup": keyboard
                }))
                .send()
                .await;
        }
    }

    Json(json!({ "ok": true })).into_response()
}
