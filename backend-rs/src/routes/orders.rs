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
    pub q: Option<String>,
    pub r#type: Option<String>,
}

#[derive(Deserialize)]
pub struct CreateOrderPayload {
    pub code: Option<String>,
    pub product: OrderProduct,
    pub buyer: Option<Buyer>,
    pub note: Option<String>,
}

#[derive(Deserialize)]
pub struct ExpireOrderPayload {
    pub code: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateOrderPayload {
    pub code: Option<String>,
    pub status: Option<String>,
}

#[derive(Deserialize)]
pub struct DeleteOrderPayload {
    pub code: Option<String>,
    pub r#type: Option<String>,
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
    let mut db = state.db.db.write().await;
    let is_owner = owner_of(&headers, &db, &state.session_secret).is_some();

    // Auto-cancel pesanan yang sudah melewati 5 menit
    let now = chrono::Utc::now();
    let five_minutes = chrono::Duration::minutes(5);
    for o in db.orders.iter_mut() {
        if o.status == "Menunggu Pengiriman" || o.status == "Menunggu Pembayaran" {
            if let Ok(created) = chrono::DateTime::parse_from_rfc3339(&o.created_at) {
                if now.signed_duration_since(created.with_timezone(&chrono::Utc)) > five_minutes {
                    o.status = "Dibatalkan (Waktu Habis)".to_string();
                }
            }
        }
    }

    if is_owner {
        let orders: Vec<Order> = db.orders.iter().take(100).cloned().collect();
        return Json(json!({ "orders": orders })).into_response();
    }

    let search_code = params.code.or_else(|| params.q.clone());
    if let Some(code) = search_code {
        let clean_code = code.trim().to_uppercase();
        let found: Vec<Order> = db.orders
            .iter()
            .filter(|o| o.code == clean_code)
            .cloned()
            .map(sanitize_order)
            .collect();
        if !found.is_empty() {
            return Json(json!({ "orders": found })).into_response();
        }
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
            if !found.is_empty() {
                return Json(json!({ "orders": found })).into_response();
            }
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
        if !found.is_empty() {
            return Json(json!({ "orders": found })).into_response();
        }
    }

    Json(json!({ "orders": [] })).into_response()
}

pub async fn create_order(
    State(state): State<AppState>,
    Json(body): Json<CreateOrderPayload>,
) -> Response {
    let order_code = body.code
        .map(|c| c.trim().to_uppercase())
        .filter(|c| !c.is_empty())
        .unwrap_or_else(generate_order_code);

    let mut db = state.db.db.write().await;

    // Validasi harga terhadap katalog produk / bundle untuk mencegah tampering
    let mut verified_price = body.product.price;
    let prod_name_lower = body.product.name.trim().to_lowercase();
    let var_name_lower = body.product.variant.as_deref().unwrap_or("").trim().to_lowercase();

    let matched_prod = db.products.iter().find(|p| {
        p.name.trim().to_lowercase() == prod_name_lower || p.slug == prod_name_lower
    });

    let bundle_matched = if let Some(b) = &db.bundle {
        let b_title = b.title.trim().to_lowercase();
        b.enabled && (b_title == prod_name_lower || prod_name_lower.contains(&b_title))
    } else {
        false
    };

    if matched_prod.is_none() && !bundle_matched {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Produk tidak valid atau tidak terdaftar di katalog" }))).into_response();
    }

    if let Some(prod) = matched_prod {
        if !prod.variants.is_empty() {
            if let Some(matched_var) = prod.variants.iter().find(|v| v.label.trim().to_lowercase() == var_name_lower) {
                if matched_var.price > 0.0 {
                    verified_price = matched_var.price;
                }
            } else if prod.variants[0].price > 0.0 {
                verified_price = prod.variants[0].price;
            }
        }
    } else if bundle_matched {
        if let Some(b) = &db.bundle {
            if b.price > 0.0 {
                verified_price = b.price;
            }
        }
    }

    let qty = body.product.qty.clamp(1, 100);
    let total = verified_price * (qty as f64);

    let mut product = body.product;
    product.price = verified_price;
    product.qty = qty;

    let new_order = Order {
        code: order_code,
        created_at: chrono::Utc::now().to_rfc3339(),
        status: "Menunggu Pengiriman".to_string(),
        total,
        product: Some(product),
        buyer: body.buyer,
        note: body.note,
        credentials: None,
        delivery_text: None,
        paid_at: None,
        cancelled_at: None,
        wistapay: None,
        extra: Default::default(),
    };

    db.orders.insert(0, new_order.clone());
    if db.orders.len() > 1000 {
        db.orders.pop();
    }
    let _ = state.db.save().await;

    (StatusCode::CREATED, Json(json!({ "ok": true, "order": new_order }))).into_response()
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
            if let Ok(created) = chrono::DateTime::parse_from_rfc3339(&order.created_at) {
                let age = chrono::Utc::now().signed_duration_since(created.with_timezone(&chrono::Utc));
                if age.num_milliseconds() >= 5 * 60 * 1000 {
                    order.status = "Dibatalkan (Waktu Habis)".to_string();
                    order.cancelled_at = Some(chrono::Utc::now().to_rfc3339());
                    let _ = state.db.save().await;
                    return Json(json!({ "ok": true })).into_response();
                } else {
                    return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Batas waktu 5 menit belum terlampaui" }))).into_response();
                }
            }
        }
    }

    Json(json!({ "ok": true })).into_response()
}

pub async fn update_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<UpdateOrderPayload>,
) -> Response {
    let mut db = state.db.db.write().await;
    if owner_of(&headers, &db, &state.session_secret).is_none() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Akses ditolak" }))).into_response();
    }

    let code = match body.code {
        Some(c) if !c.trim().is_empty() => c.trim().to_uppercase(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Kode pesanan wajib diisi" }))).into_response(),
    };
    let status = match body.status {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Status pesanan wajib diisi" }))).into_response(),
    };

    if let Some(order) = db.orders.iter_mut().find(|o| o.code == code) {
        order.status = status;
        let updated = order.clone();
        let _ = state.db.save().await;
        return Json(json!({ "order": updated })).into_response();
    }

    (StatusCode::NOT_FOUND, Json(json!({ "error": "Pesanan tidak ditemukan" }))).into_response()
}

pub async fn delete_order(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(params): Query<OrderQueryParams>,
    body: Option<Json<DeleteOrderPayload>>,
) -> Response {
    let mut db = state.db.db.write().await;
    if owner_of(&headers, &db, &state.session_secret).is_none() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Akses ditolak" }))).into_response();
    }

    let p_type = params.r#type.as_deref().or_else(|| body.as_ref().and_then(|b| b.r#type.as_deref()));
    if p_type == Some("all") {
        let count = db.orders.len();
        db.orders.clear();
        let _ = state.db.save().await;
        return Json(json!({ "ok": true, "deleted": count })).into_response();
    }

    if p_type == Some("cancelled") {
        let before = db.orders.len();
        db.orders.retain(|o| {
            let s = o.status.to_lowercase();
            !s.contains("batal") && !s.contains("kadaluarsa") && !s.contains("expired")
        });
        let deleted = before - db.orders.len();
        let _ = state.db.save().await;
        return Json(json!({ "ok": true, "deleted": deleted })).into_response();
    }

    let code = params.code
        .or_else(|| body.as_ref().and_then(|b| b.code.clone()))
        .map(|c| c.trim().to_uppercase());

    if let Some(c) = code {
        let before = db.orders.len();
        db.orders.retain(|o| o.code != c);
        if db.orders.len() < before {
            let _ = state.db.save().await;
            return Json(json!({ "ok": true })).into_response();
        }
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "Pesanan tidak ditemukan" }))).into_response();
    }

    (StatusCode::BAD_REQUEST, Json(json!({ "error": "Parameter code atau type wajib diisi" }))).into_response()
}
