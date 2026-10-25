use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};

use serde_json::{json, Value};
use crate::auth::owner_of;
use crate::models::{Product, Variant, Bundle};
use crate::AppState;

fn slugify(name: &str) -> String {
    let mut result = String::new();
    let mut prev_dash = false;
    for c in name.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            result.push(c);
            prev_dash = false;
        } else if !prev_dash && !result.is_empty() {
            result.push('-');
            prev_dash = true;
        }
    }
    result.trim_matches('-').chars().take(60).collect()
}

pub async fn create_product(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<Product>,
) -> Response {
    let mut db = state.db.db.write().await;
    if owner_of(&headers, &db, &state.session_secret).is_none() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Akses ditolak" }))).into_response();
    }

    if body.name.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Nama produk wajib diisi" }))).into_response();
    }

    if body.slug.trim().is_empty() {
        body.slug = slugify(&body.name);
    }

    // Cek duplikasi slug
    if db.products.iter().any(|p| p.slug == body.slug) {
        body.slug = format!("{}-{}", body.slug, chrono::Utc::now().timestamp_subsec_millis());
    }

    db.products.push(body.clone());
    let _ = state.db.save().await;

    Json(json!({ "ok": true, "product": body })).into_response()
}

pub async fn update_product(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
    Json(patch): Json<Value>,
) -> Response {
    let mut db = state.db.db.write().await;
    if owner_of(&headers, &db, &state.session_secret).is_none() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Akses ditolak" }))).into_response();
    }

    let product = match db.products.iter_mut().find(|p| p.slug == slug) {
        Some(p) => p,
        None => return (StatusCode::NOT_FOUND, Json(json!({ "error": "Produk tidak ditemukan" }))).into_response(),
    };

    if let Some(name) = patch.get("name").and_then(|v| v.as_str()) {
        product.name = name.to_string();
    }
    if let Some(cat) = patch.get("cat").and_then(|v| v.as_str()) {
        product.cat = cat.to_string();
    }
    if let Some(desc) = patch.get("desc").and_then(|v| v.as_str()) {
        product.desc = Some(desc.to_string());
    }
    if let Some(image) = patch.get("image").and_then(|v| v.as_str()) {
        product.image = Some(image.to_string());
    }
    if let Some(hidden) = patch.get("hidden").and_then(|v| v.as_bool()) {
        product.hidden = Some(hidden);
    }
    if let Some(variants) = patch.get("variants") {
        if let Ok(v_list) = serde_json::from_value::<Vec<Variant>>(variants.clone()) {
            product.variants = v_list;
        }
    }

    let updated = product.clone();
    let _ = state.db.save().await;

    Json(json!({ "ok": true, "product": updated })).into_response()
}

pub async fn delete_product(
    State(state): State<AppState>,
    Path(slug): Path<String>,
    headers: HeaderMap,
) -> Response {
    let mut db = state.db.db.write().await;
    if owner_of(&headers, &db, &state.session_secret).is_none() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Akses ditolak" }))).into_response();
    }

    let before = db.products.len();
    db.products.retain(|p| p.slug != slug);

    if db.products.len() == before {
        return (StatusCode::NOT_FOUND, Json(json!({ "error": "Produk tidak ditemukan" }))).into_response();
    }

    let _ = state.db.save().await;
    Json(json!({ "ok": true })).into_response()
}

pub async fn update_bundle(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(patch): Json<Bundle>,
) -> Response {
    let mut db = state.db.db.write().await;
    if owner_of(&headers, &db, &state.session_secret).is_none() {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Akses ditolak" }))).into_response();
    }

    db.bundle = Some(patch.clone());
    let _ = state.db.save().await;

    Json(json!({ "ok": true, "bundle": patch })).into_response()
}
