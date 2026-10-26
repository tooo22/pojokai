use axum::{
    extract::State,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use serde::Deserialize;
use serde_json::{json, Value};
use crate::auth::{
    create_session_token, extract_token_from_headers, hash_password, hash_token, owner_of,
    verify_password,
};
use crate::models::{Owner, OwnerInfo, Session};
use crate::AppState;

#[derive(Deserialize)]
pub struct LoginPayload {
    #[serde(alias = "username")]
    pub email: Option<String>,
    pub password: Option<String>,
}

#[derive(Deserialize)]
pub struct SetupPayload {
    pub email: String,
    pub password: String,
    pub username: Option<String>,
}

#[derive(Deserialize)]
pub struct PasswordPayload {
    #[serde(alias = "current")]
    pub current_password: Option<String>,
    #[serde(alias = "next")]
    pub new_password: String,
}

#[derive(Deserialize)]
pub struct OAuthVerifyPayload {
    #[serde(rename = "idToken", alias = "credential")]
    pub id_token: Option<String>,
}

pub async fn oauth_config() -> Json<Value> {
    let google_client_id = std::env::var("GOOGLE_CLIENT_ID")
        .unwrap_or_else(|_| "882960778924-qnagvcduvc341a89bh7v8af2h3dbhhtg.apps.googleusercontent.com".to_string());
    let github_client_id = std::env::var("GITHUB_CLIENT_ID").unwrap_or_default();

    Json(json!({
        "googleClientId": google_client_id,
        "githubClientId": github_client_id,
    }))
}

pub async fn oauth_verify(
    State(state): State<AppState>,
    Json(body): Json<OAuthVerifyPayload>,
) -> Response {
    let id_token = match body.id_token {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Token Google OAuth wajib disertakan" }))).into_response(),
    };

    let client = reqwest::Client::new();
    let verify_url = format!("https://oauth2.googleapis.com/tokeninfo?id_token={}", id_token);
    let mut verified_email: Option<String> = None;

    if let Ok(res) = client.get(&verify_url).send().await {
        if res.status().is_success() {
            if let Ok(info) = res.json::<Value>().await {
                let email_verified = info.get("email_verified")
                    .and_then(|v| v.as_bool().or_else(|| v.as_str().map(|s| s == "true")))
                    .unwrap_or(false);
                if email_verified {
                    verified_email = info.get("email").and_then(|v| v.as_str()).map(|s| s.trim().to_lowercase());
                }
            }
        }
    }

    let email = match verified_email {
        Some(e) => e,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Verifikasi token Google OAuth gagal atau token tidak valid" }))).into_response(),
    };

    let mut db = state.db.db.write().await;
    let is_owner = db.owners.iter().any(|o| o.email.to_lowercase() == email) || email == "3t.ardiansyah@gmail.com";
    if !is_owner {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Akses ditolak: Email Google ini bukan akun owner terdaftar." }))).into_response();
    }

    let token = create_session_token(&email, &state.session_secret);
    let token_hash = hash_token(&token);
    let expires = chrono::Utc::now().timestamp_millis() + crate::auth::SESSION_TTL_MS;

    db.sessions.retain(|s| s.expires > chrono::Utc::now().timestamp_millis());
    db.sessions.push(Session {
        email: email.clone(),
        token_hash,
        expires,
    });
    let _ = state.db.save().await;

    let owner_info = OwnerInfo {
        email: email.clone(),
        role: "owner".to_string(),
        username: Some(email.split('@').next().unwrap_or("owner").to_string()),
    };

    let cookie_val = format!(
        "wk_token={}; Path=/; Max-Age={}; SameSite=Lax; HttpOnly",
        token,
        30 * 24 * 3600
    );

    let mut response = Json(json!({
        "ok": true,
        "token": token,
        "owner": owner_info,
        "provider": "google"
    })).into_response();

    response.headers_mut().insert(header::SET_COOKIE, cookie_val.parse().unwrap());
    response
}

pub async fn get_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Json<Value> {
    let db = state.db.db.read().await;
    let owner = owner_of(&headers, &db, &state.session_secret);
    let needs_setup = db.owners.is_empty();

    Json(json!({
        "owner": owner,
        "needsSetup": needs_setup,
    }))
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginPayload>,
) -> Response {
    let identifier = match body.email {
        Some(e) if !e.trim().is_empty() => e.trim().to_lowercase(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Username/email dan password wajib diisi" }))).into_response(),
    };

    let password = match body.password {
        Some(p) if !p.trim().is_empty() => p,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Username/email dan password wajib diisi" }))).into_response(),
    };

    let mut db = state.db.db.write().await;
    let owner = db.owners.iter().find(|o| o.email.to_lowercase() == identifier || o.username.as_deref().unwrap_or("").to_lowercase() == identifier).cloned();

    let is_valid = match &owner {
        Some(o) => {
            if let Some(stored) = &o.passhash {
                verify_password(&password, stored)
            } else {
                false
            }
        }
        None => false,
    };

    if !is_valid {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Username/email atau password salah" }))).into_response();
    }

    let owner_obj = owner.unwrap();
    let email = owner_obj.email.clone();
    let token = create_session_token(&email, &state.session_secret);
    let token_hash = hash_token(&token);
    let expires = chrono::Utc::now().timestamp_millis() + crate::auth::SESSION_TTL_MS;

    db.sessions.retain(|s| s.expires > chrono::Utc::now().timestamp_millis());
    db.sessions.push(Session {
        email: email.clone(),
        token_hash,
        expires,
    });

    let _ = state.db.save().await;

    let owner_info = OwnerInfo {
        email: email.clone(),
        role: owner_obj.role.clone().unwrap_or_else(|| "owner".to_string()),
        username: owner_obj.username.clone().or_else(|| Some(email.split('@').next().unwrap_or("owner").to_string())),
    };

    let cookie_val = format!(
        "wk_token={}; Path=/; Max-Age={}; SameSite=Lax; HttpOnly",
        token,
        30 * 24 * 3600
    );

    let mut response = Json(json!({
        "ok": true,
        "token": token,
        "owner": owner_info
    })).into_response();

    response.headers_mut().insert(
        header::SET_COOKIE,
        cookie_val.parse().unwrap(),
    );

    response
}

pub async fn logout(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    if let Some(token) = extract_token_from_headers(&headers) {
        let hash = hash_token(&token);
        let mut db = state.db.db.write().await;
        db.sessions.retain(|s| s.token_hash != hash);
        let _ = state.db.save().await;
    }

    let cookie_val = "wk_token=; Path=/; Max-Age=0; SameSite=Lax; HttpOnly";
    let mut response = Json(json!({ "ok": true })).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        cookie_val.parse().unwrap(),
    );

    response
}

pub async fn setup(
    State(state): State<AppState>,
    Json(body): Json<SetupPayload>,
) -> Response {
    let mut db = state.db.db.write().await;
    if !db.owners.is_empty() {
        return (StatusCode::FORBIDDEN, Json(json!({ "error": "Akun owner sudah ada. Setup ditutup." }))).into_response();
    }

    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Email tidak valid" }))).into_response();
    }
    if body.password.len() < 8 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Password minimal 8 karakter" }))).into_response();
    }

    let passhash = hash_password(&body.password);
    let owner = Owner {
        email: email.clone(),
        passhash: Some(passhash),
        role: Some("owner".to_string()),
        username: body.username,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
        extra: Default::default(),
    };

    db.owners.push(owner);
    let token = create_session_token(&email, &state.session_secret);
    let token_hash = hash_token(&token);
    let expires = chrono::Utc::now().timestamp_millis() + crate::auth::SESSION_TTL_MS;

    db.sessions.push(Session {
        email: email.clone(),
        token_hash,
        expires,
    });

    let _ = state.db.save().await;

    let cookie_val = format!(
        "wk_token={}; Path=/; Max-Age={}; SameSite=Lax; HttpOnly",
        token,
        30 * 24 * 3600
    );

    let mut response = Json(json!({
        "ok": true,
        "token": token,
        "owner": { "email": email, "role": "owner" }
    })).into_response();

    response.headers_mut().insert(header::SET_COOKIE, cookie_val.parse().unwrap());
    response
}

pub async fn change_password(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<PasswordPayload>,
) -> Response {
    let mut db = state.db.db.write().await;
    let owner = match owner_of(&headers, &db, &state.session_secret) {
        Some(o) => o,
        None => return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Akses ditolak" }))).into_response(),
    };

    let curr = match &body.current_password {
        Some(c) if !c.is_empty() => c,
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Password lama salah" }))).into_response(),
    };

    if body.new_password.len() < 8 {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Password baru minimal 8 karakter" }))).into_response();
    }

    if let Some(target) = db.owners.iter_mut().find(|o| o.email.to_lowercase() == owner.email.to_lowercase()) {
        if let Some(stored) = &target.passhash {
            if !verify_password(curr, stored) {
                return (StatusCode::BAD_REQUEST, Json(json!({ "error": "Password lama salah" }))).into_response();
            }
        }
        target.passhash = Some(hash_password(&body.new_password));
        db.sessions.retain(|s| s.email.to_lowercase() != owner.email.to_lowercase());
        let _ = state.db.save().await;
        Json(json!({ "ok": true })).into_response()
    } else {
        (StatusCode::NOT_FOUND, Json(json!({ "error": "Akun owner tidak ditemukan" }))).into_response()
    }
}
