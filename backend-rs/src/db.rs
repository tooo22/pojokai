use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{error, info, warn};
use crate::models::Db;

pub type SharedDb = Arc<RwLock<Db>>;

#[derive(Clone)]
pub struct Database {
    pub db: SharedDb,
    pub file_path: PathBuf,
}

impl Database {
    pub async fn load(file_path: PathBuf) -> Self {
        let db_data = if file_path.exists() {
            match tokio::fs::read_to_string(&file_path).await {
                Ok(content) => match serde_json::from_str::<Db>(&content) {
                    Ok(parsed) => {
                        info!("[db] Database berhasil dimuat: {} produk", parsed.products.len());
                        parsed
                    }
                    Err(e) => {
                        error!("[db] Gagal parse JSON {}: {}", file_path.display(), e);
                        Db::default()
                    }
                },
                Err(e) => {
                    error!("[db] Gagal membaca file {}: {}", file_path.display(), e);
                    Db::default()
                }
            }
        } else {
            warn!("[db] File {} tidak ditemukan, menggunakan database kosong", file_path.display());
            Db::default()
        };

        let shared = Arc::new(RwLock::new(db_data));
        let instance = Self {
            db: shared,
            file_path,
        };

        // Buat backup snapshot harian jika belum ada
        instance.create_daily_backup().await;

        instance
    }

    pub async fn save(&self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let db_read = self.db.read().await;
        let content = serde_json::to_string_pretty(&*db_read)?;
        drop(db_read);

        if let Some(parent) = self.file_path.parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }

        let tmp_path = self.file_path.with_extension(format!("tmp.{}", std::process::id()));
        tokio::fs::write(&tmp_path, &content).await?;

        // Atomic rename
        if let Err(e) = tokio::fs::rename(&tmp_path, &self.file_path).await {
            warn!("[db] Gagal rename atomic, mencoba overwrite langsung: {}", e);
            tokio::fs::write(&self.file_path, content).await?;
            let _ = tokio::fs::remove_file(tmp_path).await;
        }

        Ok(())
    }

    async fn create_daily_backup(&self) {
        if let Some(parent) = self.file_path.parent() {
            let backup_dir = parent.join("backups");
            let _ = tokio::fs::create_dir_all(&backup_dir).await;
            let date_str = chrono::Utc::now().format("%Y-%m-%d").to_string();
            let backup_file = backup_dir.join(format!("db-{}.json", date_str));

            if !backup_file.exists() {
                let db_read = self.db.read().await;
                if let Ok(content) = serde_json::to_string_pretty(&*db_read) {
                    if let Ok(_) = tokio::fs::write(&backup_file, content).await {
                        info!("[db] Snapshot backup harian dibuat: {}", backup_file.display());
                    }
                }
            }
        }
    }
}
