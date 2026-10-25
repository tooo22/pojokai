use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::models::WistapayData;
use crate::AppState;

#[derive(Deserialize)]
pub struct QrisCreatePayload {
    pub code: Option<String>,
    pub amount: Option<f64>,
    pub product_name: Option<String>,
}

#[derive(Deserialize)]
pub struct QrisStatusQuery {
    pub code: Option<String>,
    #[serde(rename = "simulate_pay")]
    pub simulate_pay: Option<bool>,
}

pub async fn create_qris(
    State(state): State<AppState>,
    Json(body): Json<QrisCreatePayload>,
) -> Response {
    let code = match body.code {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Kode pesanan wajib diisi" }))).into_response(),
    };

    let mut db = state.db.db.write().await;
    let api_key = state.wistapay_api_key.clone()
        .or_else(|| db.wistapay.as_ref().and_then(|w| w.api_key.clone()))
        .unwrap_or_default();

    let order = match db.orders.iter_mut().find(|o| o.code == code) {
        Some(o) => o,
        None => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Pesanan tidak ditemukan" }))).into_response(),
    };

    let amount = body.amount.unwrap_or(order.total);
    let prod_name = body.product_name
        .or_else(|| order.product.as_ref().map(|p| p.name.clone()))
        .unwrap_or_else(|| "Produk Digital".to_string());

    let wistapay_url = format!("{}/create-payment.php", state.wistapay_base_url);

    let client = reqwest::Client::new();
    let res = client.post(&wistapay_url)
        .header("Content-Type", "application/json")
        .header("X-API-Key", &api_key)
        .json(&json!({
            "amount": amount,
            "description": format!("Pesanan {} - {}", code, prod_name),
            "external_id": code,
            "fee_bearer": "MERCHANT",
            "callback_url": "https://pojokai.my.id/#cek-pesanan"
        }))
        .send()
        .await;

    match res {
        Ok(response) => {
            if let Ok(json_res) = response.json::<Value>().await {
                if json_res.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                    if let Some(data) = json_res.get("data") {
                        let w_data = WistapayData {
                            reference: data.get("reference").and_then(|v| v.as_str()).map(String::from),
                            payment_id: data.get("payment_id").and_then(|v| v.as_str()).map(String::from),
                            qris_image: data.get("qris_image").and_then(|v| v.as_str()).map(String::from),
                            payment_url: data.get("payment_url").and_then(|v| v.as_str()).map(String::from),
                            expires_at: data.get("expires_at").and_then(|v| v.as_str()).map(String::from),
                            charge_amount: data.get("charge_amount").and_then(|v| v.as_f64()),
                            fee: data.get("fee").and_then(|v| v.as_f64()),
                            net_amount: data.get("net_amount").and_then(|v| v.as_f64()),
                        };
                        order.wistapay = Some(w_data.clone());
                        let _ = state.db.save().await;

                        return Json(json!({
                            "ok": true,
                            "qris": w_data,
                            "order": order
                        })).into_response();
                    }
                }
                return (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Gateway menolak pembuatan QRIS", "details": json_res }))).into_response();
            }
        }
        Err(e) => {
            tracing::warn!("[wistapay] gagal menghubungi server: {}", e);
        }
    }

    // Mock QRIS fallback jika gateway offline / sandbox mode
    let fallback_qris = WistapayData {
        reference: Some(format!("MOCK-{}", code)),
        payment_id: Some(format!("PAY-{}", code)),
        qris_image: Some("https://pojokai.my.id/assets/qris.png".to_string()),
        payment_url: None,
        expires_at: Some(chrono::Utc::now().to_rfc3339()),
        charge_amount: Some(amount),
        fee: Some(0.0),
        net_amount: Some(amount),
    };
    order.wistapay = Some(fallback_qris.clone());
    let _ = state.db.save().await;

    Json(json!({
        "ok": true,
        "qris": fallback_qris,
        "order": order
    })).into_response()
}

pub async fn get_qris_status(
    State(state): State<AppState>,
    Query(query): Query<QrisStatusQuery>,
) -> Response {
    let code = match query.code {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Kode pesanan wajib diisi" }))).into_response(),
    };

    let mut db = state.db.db.write().await;
    let order = match db.orders.iter_mut().find(|o| o.code == code) {
        Some(o) => o,
        None => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Pesanan tidak ditemukan" }))).into_response(),
    };

    // Simulasi bayar untuk pengujian cepat
    if query.simulate_pay == Some(true) {
        order.status = "Diproses (Pembayaran QRIS Terverifikasi)".to_string();
        order.paid_at = Some(chrono::Utc::now().to_rfc3339());
        let _ = state.db.save().await;
        return Json(json!({
            "ok": true,
            "status": "PAID",
            "order": order
        })).into_response();
    }

    if order.status.contains("Lunas") || order.status.contains("Diproses") || order.status.contains("Selesai") {
        return Json(json!({
            "ok": true,
            "status": "PAID",
            "order": order
        })).into_response();
    }

    Json(json!({
        "ok": true,
        "status": "PENDING",
        "order": order
    })).into_response()
}

pub async fn wistapay_webhook(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Response {
    tracing::info!("[webhook] Wistapay callback diterima: {:?}", payload);

    let external_id = payload.get("external_id")
        .or_else(|| payload.get("data").and_then(|d| d.get("external_id")))
        .and_then(|v| v.as_str());

    let status = payload.get("status")
        .or_else(|| payload.get("data").and_then(|d| d.get("status")))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();

    if let Some(code) = external_id {
        if status == "PAID" || status == "SUCCESS" {
            let mut db = state.db.db.write().await;
            if let Some(order) = db.orders.iter_mut().find(|o| o.code == code) {
                order.status = "Diproses (Pembayaran QRIS Terverifikasi)".to_string();
                order.paid_at = Some(chrono::Utc::now().to_rfc3339());
                let _ = state.db.save().await;
                tracing::info!("[webhook] Pesanan {} otomatis LUNAS via QRIS", code);
            }
        }
    }

    Json(json!({ "ok": true })).into_response()
}
