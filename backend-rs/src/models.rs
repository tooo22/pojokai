use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct TelegramConfig {
    #[serde(rename = "botToken")]
    pub bot_token: Option<String>,
    #[serde(rename = "ownerChatId")]
    pub owner_chat_id: Option<String>,
    #[serde(rename = "botUsername")]
    pub bot_username: Option<String>,
    pub enabled: Option<bool>,
    #[serde(rename = "webhookSecret")]
    pub webhook_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct SecurityBotConfig {
    #[serde(rename = "botToken")]
    pub bot_token: Option<String>,
    #[serde(rename = "ownerChatId")]
    pub owner_chat_id: Option<String>,
    #[serde(rename = "botUsername")]
    pub bot_username: Option<String>,
    pub enabled: Option<bool>,
    #[serde(rename = "lastMessageId")]
    pub last_message_id: Option<i64>,
    #[serde(rename = "animationFileId")]
    pub animation_file_id: Option<String>,
    #[serde(rename = "webhookSecret")]
    pub webhook_secret: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct WistapayConfig {
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Category {
    pub id: String,
    pub anchor: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct HeroSlide {
    pub eyebrow: Option<String>,
    pub title: Option<String>,
    pub line2: Option<String>,
    pub sub: Option<String>,
    pub cta: Option<String>,
    pub href: Option<String>,
    pub items: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Variant {
    pub label: String,
    pub price: f64,
    pub stock: i64,
    pub ful: Option<String>,
    pub strike: Option<f64>,
    pub d: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Product {
    pub slug: String,
    pub name: String,
    pub cat: String,
    pub sold: Option<i64>,
    pub desc: Option<String>,
    pub image: Option<String>,
    pub brief: Option<Vec<String>>,
    pub mf: Option<Vec<String>>,
    pub variants: Vec<Variant>,
    pub hidden: Option<bool>,
    pub patungan: Option<bool>,
    pub rating: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Bundle {
    pub enabled: bool,
    pub title: String,
    pub prod1: String,
    pub prod2: String,
    pub badge: Option<String>,
    pub price: f64,
    pub strike: Option<f64>,
    #[serde(rename = "soldText")]
    pub sold_text: Option<String>,
    #[serde(rename = "fulText")]
    pub ful_text: Option<String>,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Owner {
    pub email: String,
    #[serde(rename = "passhash", alias = "password")]
    pub passhash: Option<String>,
    pub role: Option<String>,
    pub username: Option<String>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<String>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Session {
    pub email: String,
    #[serde(rename = "tokenHash")]
    pub token_hash: String,
    pub expires: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Buyer {
    pub name: Option<String>,
    pub email: Option<String>,
    pub wa: Option<String>,
    #[serde(rename = "telegramUserId")]
    pub telegram_user_id: Option<String>,
    #[serde(rename = "telegramChatId")]
    pub telegram_chat_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct OrderProduct {
    pub id: Option<String>,
    pub name: String,
    pub variant: Option<String>,
    pub price: f64,
    pub qty: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct WistapayData {
    pub reference: Option<String>,
    pub payment_id: Option<String>,
    pub qris_image: Option<String>,
    pub payment_url: Option<String>,
    pub expires_at: Option<String>,
    pub charge_amount: Option<f64>,
    pub fee: Option<f64>,
    pub net_amount: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Order {
    pub code: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    pub status: String,
    pub total: f64,
    pub product: Option<OrderProduct>,
    pub buyer: Option<Buyer>,
    pub note: Option<String>,
    pub credentials: Option<String>,
    #[serde(rename = "deliveryText")]
    pub delivery_text: Option<String>,
    #[serde(rename = "paidAt")]
    pub paid_at: Option<String>,
    #[serde(rename = "cancelledAt")]
    pub cancelled_at: Option<String>,
    pub wistapay: Option<WistapayData>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Wallet {
    pub balance: Option<f64>,
    #[serde(rename = "totalDeposit")]
    pub total_deposit: Option<f64>,
    #[serde(rename = "totalSpent")]
    pub total_spent: Option<f64>,
    pub lang: Option<String>,
    pub wa: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct UserState {
    pub action: Option<String>,
    pub time: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct Db {
    pub wa: String,
    pub telegram: Option<TelegramConfig>,
    #[serde(rename = "securityBot")]
    pub security_bot: Option<SecurityBotConfig>,
    pub wistapay: Option<WistapayConfig>,
    #[serde(rename = "userLanguages")]
    pub user_languages: HashMap<String, String>,
    pub categories: Vec<Category>,
    pub hero: Vec<HeroSlide>,
    pub faqs: Vec<serde_json::Value>,
    pub ticker: Vec<serde_json::Value>,
    pub products: Vec<Product>,
    pub bundle: Option<Bundle>,
    pub owners: Vec<Owner>,
    pub sessions: Vec<Session>,
    pub orders: Vec<Order>,
    pub wallets: HashMap<String, Wallet>,
    #[serde(rename = "userStates")]
    pub user_states: HashMap<String, UserState>,
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct CatalogResponse {
    pub wa: String,
    pub categories: Vec<Category>,
    pub hero: Vec<HeroSlide>,
    pub faqs: Vec<serde_json::Value>,
    pub ticker: Vec<serde_json::Value>,
    pub products: Vec<Product>,
    pub bundle: Option<Bundle>,
    pub editable: bool,
    pub owner: Option<OwnerInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct OwnerInfo {
    pub email: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
}
