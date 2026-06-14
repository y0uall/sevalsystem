use chrono::Local;
use std::fs;
use std::path::Path;

pub fn run_backup(db_path: &str) -> Result<(), String> {
    let db_file = Path::new(db_path);
    if !db_file.exists() {
        return Ok(()); // Keine Datenbank, kein Backup nötig
    }

    // 1. Backup-Verzeichnis bestimmen (Ordner "backups" im gleichen Verzeichnis wie die DB)
    let db_dir = db_file.parent().unwrap_or_else(|| Path::new("."));
    let backup_dir = db_dir.join("backups");

    if !backup_dir.exists() {
        fs::create_dir_all(&backup_dir).map_err(|e| format!("Backup-Verzeichnis konnte nicht erstellt werden: {}", e))?;
    }

    // 2. Prüfen, ob heute schon ein Backup erstellt wurde
    let now = Local::now();
    let date_str = now.format("%Y-%m-%d").to_string();
    let backup_filename = format!("bewertungen_{}.db.bak", date_str);
    let backup_path = backup_dir.join(&backup_filename);

    if !backup_path.exists() {
        // Backup erstellen
        fs::copy(db_file, &backup_path).map_err(|e| format!("Backup-Fehler: {}", e))?;
        eprintln!("[SEVALSystem] Automatisches Backup erstellt: {:?}", backup_path);
    }

    // 3. Alte Backups aufräumen — nutzt konfigurierbaren Wert
    cleanup_old_backups(&backup_dir, 30); // Default 30; wird von App mit konfiguriertem Wert nochmals aufgerufen

    Ok(())
}

pub fn cleanup_old_backups(backup_dir: &Path, days: i64) {
    let entries = match fs::read_dir(backup_dir) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("[SEVALSystem] Backup-Cleanup Fehler: {}", e);
            return;
        }
    };
    let now = Local::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path.extension().is_some_and(|ext| ext == "bak")
            && let Ok(metadata) = fs::metadata(&path)
            && let Ok(modified) = metadata.modified()
        {
            let modified_local: chrono::DateTime<Local> = modified.into();
            let age = now.signed_duration_since(modified_local);

            if age.num_days() > days
                && let Err(e) = fs::remove_file(&path) {
                    eprintln!("[SEVALSystem] Altes Backup konnte nicht gelöscht werden {:?}: {}", path, e);
                }
        }
    }
}
