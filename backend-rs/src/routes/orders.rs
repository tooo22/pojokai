use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use rand::Rng;
use serde::Deserialize;
use serde_json::json;
use crate::auth::owner_of;
use crate::models::{Buyer, Order, OrderProduct};
use crate::AppState;

#[derive(Deserialize)]
pub struct OrderQueryParams {
    pub code: Option<String>,
    pub wa: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateOrderPayload {
    pub product: OrderProduct,
    pub buyer: Option<Buyer>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct ExpireOrderPayload {
    pub code: Option<String>,
}

fn generate_order_code() -> String {
    let charset: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let mut rng = rand::thread_rng();
    let random_str: String = (0..6)
        .map(|_| {
            let idx = rng.gen_range(0..charset.len());
            charset[idx] as char
        })
        .collect();
    format!("POJOK-{}", random_str)
}

fn sanitize_order(mut order: Order) -> Order {
    if let Some(buyer) = order.buyer.as_mut() {
        if let Some(email) = &buyer.email {
            if let Some(idx) = email.find('@') {
                let (user, domain) = email.split_at(idx);
                let visible = if user.len() > 2 { &user[..2] } else { user };
                buyer.email = Some(format!("{}****{}", visible, domain));
            }
        }
        if let Some(wa) = &buyer.wa {
            if wa.len() > 6 {
                let prefix = &wa[..wa.len() - 4];
                buyer.wa = Some(format!("{}****", prefix));
            }
        }
    }
    order
}

pub async fn get_orders(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<OrderQueryParams>,
) -> Response {
    let db = state.db.db.read().await;
    let is_owner = owner_of(&headers, &db, &state.session_secret).is_some();

    if is_owner {
        let orders: Vec<Order> = db.orders.iter().take(100).cloned().collect();
        return Json(json!({ "orders": orders })).into_response();
    }

    if let Some(code) = params.code {
        let clean_code = code.trim().to_uppercase();
        let found: Vec<Order> = db.orders
            .iter()
            .filter(|o| o.code == clean_code)
            .cloned()
            .map(sanitize_order)
            .collect();
        return Json(json!({ "orders": found })).into_response();
    }

    if let Some(wa) = params.wa {
        let clean_wa: String = wa.chars().filter(|c| c.is_ascii_digit()).collect();
        if clean_wa.len() >= 8 {
            let found: Vec<Order> = db.orders
                .iter()
                .filter(|o| {
                    if let Some(buyer_wa) = o.buyer.as_ref().and_then(|b| b.wa.as_ref()) {
                        let b_digits: String = buyer_wa.chars().filter(|c| c.is_ascii_digit()).collect();
                        b_digits == clean_wa || (clean_wa.len() >= 9 && b_digits.ends_with(&clean_wa[clean_wa.len() - 9..]))
                    } else {
                        false
                    }
                })
                .take(20)
                .cloned()
                .map(sanitize_order)
                .collect();
            return Json(json!({ "orders": found })).into_response();
        }
    }

    if let Some(email) = params.email {
        let clean_email = email.trim().to_lowercase();
        let found: Vec<Order> = db.orders
            .iter()
            .filter(|o| {
                o.buyer.as_ref().and_then(|b| b.email.as_ref()).map(|e| e.to_lowercase()) == Some(clean_email.clone())
            })
            .take(20)
            .cloned()
            .map(sanitize_order)
            .collect();
        return Json(json!({ "orders": found })).into_response();
    }

    Json(json!({ "orders": [] })).into_response()
}

pub async fn create_order(
    State(state): State<AppState>,
    Json(body): Json<CreateOrderPayload>,
) -> Response {
    let order_code = generate_order_code();
    let total = body.product.price * (body.product.qty as f64);

    let new_order = Order {
        code: order_code,
        created_at: chrono::Utc::now().to_rfc3339(),
        status: "Menunggu Pembayaran".to_string(),
        total,
        product: Some(body.product),
        buyer: body.buyer,
        note: body.note,
        credentials: None,
        delivery_text: None,
        paid_at: None,
        cancelled_at: None,
        wistapay: None,
        extra: Default::default(),
    };

    let mut db = state.db.db.write().await;
    db.orders.insert(0, new_order.clone());
    if db.orders.len() > 1000 {
        db.orders.pop();
    }
    let _ = state.db.save().await;

    Json(json!({ "ok": true, "order": new_order })).into_response()
}

pub async fn expire_order(
    State(state): State<AppState>,
    Json(body): Json<ExpireOrderPayload>,
) -> Response {
    let code = match body.code {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Kode pesanan wajib diisi" }))).into_response(),
    };

    let mut db = state.db.db.write().await;
    if let Some(order) = db.orders.iter_mut().find(|o| o.code == code) {
        if !order.status.contains("Lunas") && !order.status.contains("Diproses") && !order.status.contains("Selesai") {
            order.status = "Dibatalkan (Waktu Habis)".to_string();
            order.cancelled_at = Some(chrono::Utc::now().to_rfc3339());
            let _ = state.db.save().await;
            return Json(json!({ "ok": true })).into_response();
        }
    }

    Json(json!({ "ok": true })).into_response()
}
