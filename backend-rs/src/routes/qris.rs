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
    #[serde(alias = "order_id")]
    pub code: Option<String>,
    pub amount: Option<f64>,
    pub product_name: Option<String>,
    pub description: Option<String>,
}

#[derive(Deserialize)]
pub struct QrisStatusQuery {
    #[serde(alias = "order_id")]
    pub code: Option<String>,
    pub reference: Option<String>,
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

    let amount = if order.total > 0.0 { order.total } else { body.amount.unwrap_or(0.0) };
    if amount < 1000.0 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nominal pembayaran minimal Rp1.000" }))).into_response();
    }

    let desc = body.description
        .or(body.product_name.map(|p| format!("Pesanan {} - {}", code, p)))
        .or_else(|| order.product.as_ref().map(|p| format!("Pesanan {} - {}", code, p.name)))
        .unwrap_or_else(|| format!("Pesanan {}", code));

    let wistapay_url = format!("{}/create-payment.php", state.wistapay_base_url);

    let client = reqwest::Client::new();
    let res = client.post(&wistapay_url)
        .header("Content-Type", "application/json")
        .header("X-API-Key", &api_key)
        .json(&json!({
            "amount": amount,
            "description": desc,
            "external_id": code,
            "fee_bearer": "MERCHANT",
            "callback_url": "https://pojokai.my.id/#cek-pesanan"
        }))
        .send()
        .await;

    if let Ok(response) = res {
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
                        "success": true,
                        "data": data
                    })).into_response();
                }
            }
            return (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Gateway Wistapay menolak pembuatan QRIS", "details": json_res }))).into_response();
        }
    }

    (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Koneksi gateway WistaPay terganggu", "fallback": true }))).into_response()
}

pub async fn get_qris_status(
    State(state): State<AppState>,
    Query(query): Query<QrisStatusQuery>,
) -> Response {
    let code_opt = query.code.as_deref().map(|c| c.trim().to_uppercase());
    let ref_opt = query.reference.as_deref().map(|r| r.trim().to_string());

    if code_opt.is_none() && ref_opt.is_none() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Parameter reference atau order_id wajib diisi" }))).into_response();
    }

    let mut db = state.db.db.write().await;
    let order_idx = db.orders.iter().position(|o| {
        (code_opt.is_some() && code_opt.as_deref() == Some(&o.code))
            || (ref_opt.is_some() && o.wistapay.as_ref().and_then(|w| w.reference.as_ref()) == ref_opt.as_ref())
    });

    let lookup_ref = ref_opt.or_else(|| {
        order_idx.and_then(|idx| db.orders[idx].wistapay.as_ref().and_then(|w| w.reference.clone()))
    });

    if let Some(idx) = order_idx {
        let order = &mut db.orders[idx];
        if order.status.contains("Lunas") || order.status.contains("Diproses") || order.status.contains("Selesai") {
            return Json(json!({
                "success": true,
                "status": "PAID",
                "orderStatus": order.status
            })).into_response();
        }
    }

    if let Some(r) = lookup_ref {
        let api_key = state.wistapay_api_key.clone()
            .or_else(|| db.wistapay.as_ref().and_then(|w| w.api_key.clone()))
            .unwrap_or_default();
        let check_url = format!("{}/check-status.php?reference={}", state.wistapay_base_url, r);

        let client = reqwest::Client::new();
        if let Ok(res) = client.get(&check_url).header("X-API-Key", &api_key).send().await {
            if let Ok(json_res) = res.json::<Value>().await {
                if json_res.get("success").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let w_status = json_res.get("data").and_then(|d| d.get("status")).and_then(|s| s.as_str()).unwrap_or("");
                    if w_status == "SUCCESS" || w_status == "PAID" {
                        if let Some(idx) = order_idx {
                            let order = &mut db.orders[idx];
                            order.status = "Diproses (Pembayaran Terverifikasi)".to_string();
                            order.paid_at = Some(chrono::Utc::now().to_rfc3339());
                            let _ = state.db.save().await;
                        }
                        return Json(json!({ "success": true, "status": "PAID", "data": json_res.get("data") })).into_response();
                    }
                    return Json(json!({ "success": true, "status": w_status, "data": json_res.get("data") })).into_response();
                }
            }
        }
    }

    Json(json!({ "success": true, "status": "PENDING" })).into_response()
}

pub async fn wistapay_webhook(
    State(state): State<AppState>,
    Json(payload): Json<Value>,
) -> Response {
    tracing::info!("[webhook] Wistapay callback diterima: {:?}", payload);

    let external_id = payload.get("external_id")
        .or_else(|| payload.get("data").and_then(|d| d.get("external_id")))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_uppercase());

    let reference = payload.get("reference")
        .or_else(|| payload.get("data").and_then(|d| d.get("reference")))
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string());

    let status = payload.get("status")
        .or_else(|| payload.get("data").and_then(|d| d.get("status")))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_uppercase();

    let mut db = state.db.db.write().await;
    let order_idx = db.orders.iter().position(|o| {
        (external_id.is_some() && external_id.as_deref() == Some(&o.code))
            || (reference.is_some() && o.wistapay.as_ref().and_then(|w| w.reference.as_ref()) == reference.as_ref())
    });

    let lookup_ref = reference.or_else(|| {
        order_idx.and_then(|idx| db.orders[idx].wistapay.as_ref().and_then(|w| w.reference.clone()))
    });

    if status == "PAID" || status == "SUCCESS" {
        // Verifikasi langsung ke gateway sebelum menandai pesanan lunas
        if let Some(r) = lookup_ref {
            let api_key = state.wistapay_api_key.clone()
                .or_else(|| db.wistapay.as_ref().and_then(|w| w.api_key.clone()))
                .unwrap_or_default();
            let check_url = format!("{}/check-status.php?reference={}", state.wistapay_base_url, r);

            let client = reqwest::Client::new();
            if let Ok(res) = client.get(&check_url).header("X-API-Key", &api_key).send().await {
                if let Ok(json_res) = res.json::<Value>().await {
                    let gw_status = json_res.get("data").and_then(|d| d.get("status")).and_then(|s| s.as_str()).unwrap_or("");
                    if gw_status != "SUCCESS" && gw_status != "PAID" {
                        tracing::warn!("[webhook reject] Verifikasi status gateway gagal: {:?}", json_res);
                        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Verifikasi pembayaran gateway gagal" }))).into_response();
                    }
                } else {
                    return (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Gagal membaca status gateway" }))).into_response();
                }
            } else {
                return (StatusCode::BAD_GATEWAY, Json(json!({ "error": "Gagal menghubungi gateway" }))).into_response();
            }
        } else {
            return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Reference transaksi tidak ditemukan" }))).into_response();
        }

        if let Some(idx) = order_idx {
            let order = &mut db.orders[idx];
            order.status = "Diproses (Pembayaran Terverifikasi)".to_string();
            order.paid_at = Some(chrono::Utc::now().to_rfc3339());
            let _ = state.db.save().await;
            tracing::info!("[webhook] Pesanan {} otomatis LUNAS via QRIS", order.code);
        }
    }

    Json(json!({ "success": true })).into_response()
}
