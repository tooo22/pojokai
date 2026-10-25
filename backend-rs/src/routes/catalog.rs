use axum::{
    extract::State,
    http::HeaderMap,
    response::Json,
};
use serde_json::{json, Value};
use crate::auth::owner_of;
use crate::models::CatalogResponse;
use crate::AppState;

pub async fn get_catalog(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<CatalogResponse> {
    let db = state.db.db.read().await;
    let owner = owner_of(&headers, &db, &state.session_secret);
    let is_owner = owner.is_some();

    let products = if is_owner {
        db.products.clone()
    } else {
        db.products
            .iter()
            .filter(|p| !p.hidden.unwrap_or(false))
            .cloned()
            .collect()
    };

    Json(CatalogResponse {
        wa: db.wa.clone(),
        categories: db.categories.clone(),
        hero: db.hero.clone(),
        faqs: db.faqs.clone(),
        ticker: db.ticker.clone(),
        products,
        bundle: db.bundle.clone(),
        editable: is_owner,
        owner,
    })
}

pub async fn get_bundle(State(state): State<AppState>) -> Json<Value> {
    let db = state.db.db.read().await;
    Json(json!({ "bundle": db.bundle }))
}
