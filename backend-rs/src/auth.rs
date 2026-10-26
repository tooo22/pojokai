use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use serde::{Deserialize, Serialize};
use crate::models::{Db, OwnerInfo};

type HmacSha256 = Hmac<Sha256>;

pub const SESSION_TTL_MS: i64 = 30 * 24 * 60 * 60 * 1000; // 30 hari

#[derive(Serialize, Deserialize)]
struct TokenPayload {
    email: String,
    expires: i64,
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}
pub fn hash_password(password: &str) -> String {
    let mut salt_bytes = [0u8; 16];
    rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt_bytes);
    let salt = hex::encode(salt_bytes);
    let params = scrypt::Params::new(14, 8, 1).expect("valid scrypt params");
    let mut output = [0u8; 64];
    scrypt::scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut output).expect("scrypt hash");
    format!("scrypt:{}:{}", salt, hex::encode(output))
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    let parts: Vec<&str> = stored.split(':').collect();
    if parts.len() != 3 || parts[0] != "scrypt" {
        return false;
    }
    let salt = parts[1];
    let expected_hash = parts[2];
    let expected_bytes = match hex::decode(expected_hash) {
        Ok(b) => b,
        Err(_) => return false,
    };
    if expected_bytes.len() != 64 {
        return false;
    }
    let params = match scrypt::Params::new(14, 8, 1) {
        Ok(p) => p,
        Err(_) => return false,
    };
    let mut output = [0u8; 64];
    if scrypt::scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut output).is_err() {
        return false;
    }
    bool::from(output.ct_eq(&expected_bytes[..]))
}

pub fn create_session_token(email: &str, secret: &str) -> String {
    let expires = chrono::Utc::now().timestamp_millis() + SESSION_TTL_MS;
    let payload = TokenPayload {
        email: email.to_string(),
        expires,
    };

    let payload_json = serde_json::to_string(&payload).unwrap_or_default();
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json.as_bytes());

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC can take key of any size");
    mac.update(payload_b64.as_bytes());
    let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    format!("{}.{}", payload_b64, sig)
}

pub fn verify_session_token(token: &str, secret: &str) -> Option<String> {
    if !token.contains('.') {
        return None;
    }

    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return None;
    }

    let payload_b64 = parts[0];
    let sig_b64 = parts[1];

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload_b64.as_bytes());
    let expected_sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    if !bool::from(sig_b64.as_bytes().ct_eq(expected_sig.as_bytes())) {
        return None;
    }

    let payload_bytes = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let payload: TokenPayload = serde_json::from_slice(&payload_bytes).ok()?;

    let now = chrono::Utc::now().timestamp_millis();
    if payload.expires < now {
        return None;
    }

    Some(payload.email)
}

pub fn extract_token_from_headers(headers: &axum::http::HeaderMap) -> Option<String> {
    if let Some(auth_val) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth_val.strip_prefix("Bearer ").or_else(|| auth_val.strip_prefix("bearer ")) {
            return Some(token.trim().to_string());
        }
    }

    if let Some(cookie_val) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        for cookie in cookie_val.split(';') {
            let cookie = cookie.trim();
            if let Some(token) = cookie.strip_prefix("wk_token=") {
                return Some(token.trim().to_string());
            }
        }
    }

    None
}

pub fn owner_of(headers: &axum::http::HeaderMap, db: &Db, secret: &str) -> Option<OwnerInfo> {
    let token = extract_token_from_headers(headers)?;
    let hash = hash_token(&token);
    let now = chrono::Utc::now().timestamp_millis();

    let sess = db.sessions.iter().find(|s| s.token_hash == hash)?;
    if sess.expires < now {
        return None;
    }

    if token.contains('.') {
        let verified_email = verify_session_token(&token, secret)?;
        if verified_email.to_lowercase() != sess.email.to_lowercase() {
            return None;
        }
    }

    let email_lower = sess.email.to_lowercase();
    if email_lower == "3t.ardiansyah@gmail.com" {
        return Some(OwnerInfo {
            email: "3t.ardiansyah@gmail.com".to_string(),
            role: "owner".to_string(),
            username: Some("tittoganteng".to_string()),
        });
    }

    if let Some(owner) = db.owners.iter().find(|o| o.email.to_lowercase() == email_lower) {
        return Some(OwnerInfo {
            email: owner.email.clone(),
            role: owner.role.clone().unwrap_or_else(|| "owner".to_string()),
            username: owner.username.clone(),
        });
    }

    Some(OwnerInfo {
        email: sess.email.clone(),
        role: "owner".to_string(),
        username: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_and_verify_password() {
        let pass = "mySecretPassword123!";
        let hash = hash_password(pass);
        assert!(hash.starts_with("scrypt:"));
        assert!(verify_password(pass, &hash));
        assert!(!verify_password("wrongPassword", &hash));
        assert!(!verify_password("admin123", &hash));
    }

    #[test]
    fn test_verify_node_scrypt_hash() {
        // Known scrypt hash generated by Node.js crypto.scryptSync('password123', 'd07487153fa56bbb0a5faf9b1df164ec', 64)
        let node_hash = "scrypt:d07487153fa56bbb0a5faf9b1df164ec:907a759345cae6ecc30a7dd1d01c9aee2c0415fca2d9dc716aa442fdfa14baa58d5c9f741d7b318b59bda73b3811e6fcea35ad51d84c71b272ee2461d34c85ad";
        assert!(verify_password("password123", node_hash));
        assert!(!verify_password("admin123", node_hash));
    }

    #[test]
    fn test_session_token_create_and_verify() {
        let secret = "test-secret-key-12345";
        let email = "admin@pojokai.my.id";
        let token = create_session_token(email, secret);
        assert!(token.contains('.'));
        let verified = verify_session_token(&token, secret);
        assert_eq!(verified.as_deref(), Some(email));
        assert_eq!(verify_session_token(&token, "wrong-secret"), None);
    }
}
