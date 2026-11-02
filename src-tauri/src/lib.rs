use bcrypt::{hash, verify};
const BCRYPT_COST: u32 = 10;
use chrono::{Datelike, Local, NaiveDate};
use directories::ProjectDirs;
use rusqlite::{Connection, Result as SqlResult};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

mod models;
pub use models::*;
mod backup;

// ============================================================================
// Standard-Fragenkatalog (wird bei erster Initialisierung in DB geschrieben)
// ============================================================================

// Beispiel-Fragenkatalog (Platzhalter). Diese generischen Kriterien dienen als
// Ausgangspunkt und können in der Anwendung jederzeit angepasst, ergänzt oder
// gelöscht werden (Admin-Bereich > Fragen verwalten).
fn get_standard_fragen() -> Vec<(&'static str, Vec<&'static str>)> {
    vec![
        ("Zusammenarbeit & Kommunikation", vec![
            "Erreichbarkeit und Reaktionszeit bei Anfragen => zeitnah, verbindlich",
            "Qualität der Abstimmung mit Schnittstellen => klar, lösungsorientiert",
            "Proaktive Information bei Abweichungen => frühzeitig, transparent",
        ]),
        ("Entwicklung & Technik", vec![
            "Fachliches Know-how => kompetent, problemlösungsorientiert",
            "Termintreue bei Arbeitspaketen => zuverlässig, planbar",
            "Qualität der gelieferten Arbeitsergebnisse => vollständig, fehlerarm",
            "Umgang mit Änderungen => flexibel, nachvollziehbar dokumentiert",
            "Einhaltung vereinbarter Standards und Vorgaben => konsequent",
            "Eigenständige Bearbeitung von Sonderthemen => zuverlässig",
            "Dokumentation und Nachvollziehbarkeit => vollständig, aktuell",
        ]),
        ("Qualität & Lieferung", vec![
            "Umsetzung vereinbarter Maßnahmen => termingerecht, wirksam",
            "Liefer- und Anlieferqualität => einwandfrei, verlässlich",
        ]),
    ]
}

// ============================================================================
// Datenbank
// ============================================================================

pub struct Database {
    conn: Mutex<Connection>,
    current_path: Mutex<PathBuf>,
    current_user: Mutex<Option<User>>,  // Authentifizierter Benutzer
}

impl Database {
    pub fn new() -> SqlResult<Self> {
        let db_path = Self::get_db_path();

        if let Some(parent) = db_path.parent()
            && let Err(e) = std::fs::create_dir_all(parent) {
                eprintln!("[SEVALSystem] DB-Verzeichnis konnte nicht erstellt werden: {}", e);
            }

        // Automatisches Backup durchführen
        if let Some(path_str) = db_path.to_str()
            && let Err(e) = backup::run_backup(path_str) {
                eprintln!("[SEVALSystem] Backup fehlgeschlagen: {}", e);
            }

        let conn = Connection::open(&db_path)?;
        let db_path_clone = db_path.clone();
        let db = Self {
            conn: Mutex::new(conn),
            current_path: Mutex::new(db_path),
            current_user: Mutex::new(None),
        };
        db.init_tables()?;

        // Backup-Cleanup mit konfiguriertem Retention-Wert
        {
            let c = db.conn.lock().map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(e.to_string()))))?;
            let retention = Self::read_setting_i32(&c, "backup_retention_days", 30);
            if let Some(db_dir) = db_path_clone.parent() {
                let backup_dir = db_dir.join("backups");
                if backup_dir.exists() {
                    backup::cleanup_old_backups(&backup_dir, retention as i64);
                }
            }
        }

        Ok(db)
    }

    /// Setzt den aktuell eingeloggten Benutzer
    pub fn set_current_user(&self, user: Option<User>) {
        let mut current = self.current_user.lock().unwrap_or_else(|e| e.into_inner());
        *current = user;
    }

    /// Prüft ob der aktuelle Benutzer Admin ist
    pub fn is_current_user_admin(&self) -> bool {
        let current = self.current_user.lock().unwrap_or_else(|e| e.into_inner());
        current.as_ref().map(|u| u.role == "admin").unwrap_or(false)
    }

    /// Prüft ob der aktuelle Benutzer Admin ist (mit Fehler)
    pub fn require_admin(&self) -> Result<(), String> {
        self.require_login()?;
        if !self.is_current_user_admin() {
            Err("Nur Administratoren haben Zugriff auf diese Funktion".to_string())
        } else {
            Ok(())
        }
    }

    /// Prüft ob der aktuelle Benutzer Member ist
    pub fn is_current_user_member(&self) -> bool {
        let current = self.current_user.lock().unwrap_or_else(|e| e.into_inner());
        current
            .as_ref()
            .map(|u| u.role == "member" || u.role == "admin")
            .unwrap_or(false)
    }

    /// Prüft ob der aktuelle Benutzer Controlling ist
    pub fn is_current_user_controlling(&self) -> bool {
        let current = self.current_user.lock().unwrap_or_else(|e| e.into_inner());
        current
            .as_ref()
            .map(|u| u.role == "controlling" || u.role == "admin")
            .unwrap_or(false)
    }

    /// Gibt den aktuellen Benutzernamen zurück
    pub fn get_current_username(&self) -> Option<String> {
        let current = self.current_user.lock().unwrap_or_else(|e| e.into_inner());
        current.as_ref().map(|u| u.username.clone())
    }

    /// Prüft ob ein Benutzer eingeloggt ist
    pub fn require_login(&self) -> Result<(), String> {
        let current = self.current_user.lock().unwrap_or_else(|e| e.into_inner());
        if current.is_none() {
            Err("Nicht angemeldet. Bitte zuerst einloggen.".to_string())
        } else {
            Ok(())
        }
    }

    /// Prüft ob der aktuelle Benutzer Admin oder Member ist
    pub fn require_member_or_admin(&self) -> Result<(), String> {
        self.require_login()?;
        if !self.is_current_user_member() {
            Err("Keine Berechtigung für diese Aktion".to_string())
        } else {
            Ok(())
        }
    }

    /// Schreibt einen Audit-Log-Eintrag (revisionssicher)
    #[allow(clippy::too_many_arguments)]
    fn write_audit_log(
        &self,
        conn: &Connection,
        username: &str,
        action: &str,
        entity_type: &str,
        entity_id: Option<i64>,
        details: &str,
        success: bool,
        error_message: Option<&str>,
    ) -> SqlResult<()> {
        let user_id: Option<i64> = conn
            .query_row("SELECT id FROM users WHERE username = ?1", [username], |row| row.get(0))
            .ok();

        let user_agent = format!("SEVALSystem/{}", env!("CARGO_PKG_VERSION"));
        conn.execute(
            "INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details, success, error_message, user_agent) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![user_id, username, action, entity_type, entity_id, details, if success { 1 } else { 0 }, error_message, user_agent],
        )?;
        Ok(())
    }

    pub fn switch_to(&self, new_path: &str) -> SqlResult<()> {
        let path = PathBuf::from(new_path);

        // Sicherheitsprüfung: Nur .db Dateien erlauben
        if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if ext_str != "db" && ext_str != "sqlite" && ext_str != "sqlite3" {
                return Err(rusqlite::Error::InvalidParameterName(
                    "Nur .db, .sqlite oder .sqlite3 Dateien sind erlaubt".to_string()
                ));
            }
        } else {
            return Err(rusqlite::Error::InvalidParameterName(
                "Datei muss eine .db Erweiterung haben".to_string()
            ));
        }

        // Sicherheitsprüfung: Pfad normalisieren und auf Path-Traversal prüfen
        let path_str = path.to_string_lossy();
        if path_str.contains("..") {
            return Err(rusqlite::Error::InvalidParameterName(
                "Ungültiger Dateipfad (Path-Traversal nicht erlaubt)".to_string()
            ));
        }

        // Create parent directory if needed
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::InvalidParameterName(
                    format!("Verzeichnis konnte nicht erstellt werden: {}", e)
                )
            })?;
        }

        // Bei Datenbank-Wechsel: Benutzer-Session zurücksetzen
        self.set_current_user(None);

        // Open new connection
        let new_conn = Connection::open(&path)?;

        // Replace connection
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        *conn = new_conn;

        // Update current path
        let mut current = self.current_path.lock().unwrap_or_else(|e| e.into_inner());
        *current = path;

        // Initialize tables in new database
        drop(conn);
        drop(current);
        self.init_tables()?;

        Ok(())
    }

    /// Close the current database connection by switching to an in-memory database.
    /// This releases the file lock on Windows, allowing the file to be deleted.
    pub fn close_connection(&self) -> SqlResult<()> {
        // Open an in-memory connection to replace the file-based one
        let mem_conn = Connection::open_in_memory()?;

        // Replace connection - this closes the old connection and releases the file lock
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        *conn = mem_conn;

        // Clear the path
        let mut current = self.current_path.lock().unwrap_or_else(|e| e.into_inner());
        *current = PathBuf::new();

        Ok(())
    }

    pub fn get_current_path(&self) -> String {
        self.current_path.lock().unwrap_or_else(|e| e.into_inner()).display().to_string()
    }

    pub fn get_db_path() -> PathBuf {
        // Check if custom path is configured
        if let Some(custom_path) = get_configured_db_path() {
            return PathBuf::from(custom_path);
        }

        // Default path
        if let Some(proj_dirs) = ProjectDirs::from("de", "sevalsystem", "SEVALSystem") {
            proj_dirs.data_dir().join("bewertungen.db")
        } else {
            PathBuf::from("bewertungen.db")
        }
    }

    pub fn get_default_db_path() -> PathBuf {
        if let Some(proj_dirs) = ProjectDirs::from("de", "sevalsystem", "SEVALSystem") {
            proj_dirs.data_dir().join("bewertungen.db")
        } else {
            PathBuf::from("bewertungen.db")
        }
    }

    fn init_tables(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Foreign-Key-Enforcement aktivieren (SQLite-Default ist OFF).
        // MUSS vor der Transaktion gesetzt werden — innerhalb einer Transaktion ist
        // PRAGMA foreign_keys wirkungslos. Aktiviert den deklarierten ON DELETE CASCADE
        // (z. B. massnahmen -> bewertungen), damit das Löschen einer Bewertung ihre
        // Maßnahmen mitlöscht statt sie verwaist zurückzulassen.
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;

        // Alle Migrationen in einer Transaktion, damit bei Crash kein inkonsistenter Zustand entsteht
        conn.execute_batch("BEGIN TRANSACTION")?;

        let result = self.init_tables_inner(&conn);

        match result {
            Ok(()) => {
                conn.execute_batch("COMMIT")?;
                Ok(())
            }
            Err(e) => {
                conn.execute_batch("ROLLBACK").ok();
                Err(e)
            }
        }
    }

    fn init_tables_inner(&self, conn: &Connection) -> SqlResult<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS bewertungen (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lieferant TEXT NOT NULL,
                se_team TEXT DEFAULT '',
                datum TEXT NOT NULL,
                antworten TEXT NOT NULL,
                kommentar1 TEXT,
                kommentar2 TEXT,
                kommentar3 TEXT,
                ergebnis REAL NOT NULL,
                erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Migration: Add se_team column if it doesn't exist
        let has_se_team: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='se_team'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_se_team {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN se_team TEXT DEFAULT ''", [])?;
        }

        // Migration: Add kommentare_json column for new format (group-based comments)
        let has_kommentare_json: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='kommentare_json'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_kommentare_json {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN kommentare_json TEXT", [])?;
        }

        // Migration: Convert old kommentar1/2/3 to kommentare_json (Phase 7.3)
        conn.execute(
            "UPDATE bewertungen
             SET kommentare_json = json_object(
                 'Zusammenarbeit & Kommunikation', COALESCE(kommentar1, ''),
                 'Entwicklung & Technik', COALESCE(kommentar2, ''),
                 'Qualität & Lieferung', COALESCE(kommentar3, '')
             )
             WHERE (kommentare_json IS NULL OR kommentare_json = '')
             AND (COALESCE(kommentar1,'') != '' OR COALESCE(kommentar2,'') != '' OR COALESCE(kommentar3,'') != '')",
            [],
        )?;

        // Migration: Add bestellnummer column
        let has_bestellnummer: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='bestellnummer'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_bestellnummer {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN bestellnummer TEXT DEFAULT ''", [])?;
        }

        // Migration: Add massnahmen column (Maßnahmen für nächstes Quartal)
        let has_massnahmen: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='massnahmen'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_massnahmen {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN massnahmen TEXT DEFAULT ''", [])?;
        }

        // Migration: Add action_due_date column (Fälligkeitsdatum für Maßnahmen)
        let has_due_date: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='action_due_date'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_due_date {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN action_due_date TEXT", [])?;
        }

        // Migration: Add action_completed column (Maßnahme erledigt)
        let has_completed: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='action_completed'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_completed {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN action_completed INTEGER DEFAULT 0", [])?;
        }

        // Migration: Add created_by column
        let has_created_by: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='created_by'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_created_by {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN created_by TEXT", [])?;
        }

        // Migration: Add modified_by column
        let has_modified_by: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='modified_by'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_modified_by {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN modified_by TEXT", [])?;
        }

        conn.execute(
            "CREATE TABLE IF NOT EXISTS lieferanten (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS se_teams (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                is_admin INTEGER DEFAULT 0,
                erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Migration: Add role column to users table
        let has_role: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='role'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_role {
            conn.execute("ALTER TABLE users ADD COLUMN role TEXT", [])?;
        }

        // Migration: Add active column to users table
        let has_active: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('users') WHERE name='active'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_active {
            conn.execute("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1", [])?;
        }

        // Audit-Log Tabelle (erweiterte Revisionssicherheit)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                username TEXT NOT NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER,
                details TEXT NOT NULL,
                timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
                ip_address TEXT,
                user_agent TEXT,
                success INTEGER DEFAULT 1,
                error_message TEXT
            )",
            [],
        )?;

        // Migration: Add missing columns to existing audit_log table
        let has_details: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('audit_log') WHERE name='details'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_details {
            conn.execute("ALTER TABLE audit_log ADD COLUMN details TEXT NOT NULL DEFAULT ''", [])?;
        } else {
            conn.execute("UPDATE audit_log SET details = '' WHERE details IS NULL", [])?;
        }

        let has_ip_address: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('audit_log') WHERE name='ip_address'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_ip_address {
            conn.execute("ALTER TABLE audit_log ADD COLUMN ip_address TEXT", [])?;
        }

        let has_user_agent: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('audit_log') WHERE name='user_agent'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_user_agent {
            conn.execute("ALTER TABLE audit_log ADD COLUMN user_agent TEXT", [])?;
        }

        let has_success: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('audit_log') WHERE name='success'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_success {
            conn.execute("ALTER TABLE audit_log ADD COLUMN success INTEGER DEFAULT 1", [])?;
        }

        let has_error_message: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('audit_log') WHERE name='error_message'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_error_message {
            conn.execute("ALTER TABLE audit_log ADD COLUMN error_message TEXT", [])?;
        }

        // Create index for faster queries
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, username)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, entity_type)",
            [],
        )?;

        // ================================================================
        // Phase 2: Strukturiertes Maßnahmen-Tracking
        // ================================================================
        conn.execute(
            "CREATE TABLE IF NOT EXISTS massnahmen (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bewertung_id INTEGER NOT NULL,
                beschreibung TEXT NOT NULL,
                verantwortlich TEXT,
                faellig_am TEXT,
                status TEXT DEFAULT 'offen',
                erledigt_am TEXT,
                erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP,
                erstellt_von TEXT,
                FOREIGN KEY (bewertung_id) REFERENCES bewertungen(id) ON DELETE CASCADE
            )",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_massnahmen_bewertung ON massnahmen(bewertung_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_massnahmen_status ON massnahmen(status)",
            [],
        )?;

        // Einmalige Bereinigung: verwaiste Maßnahmen entfernen, die in DBs entstanden sein
        // können, als das FK-Enforcement noch nicht aktiv war (Bewertung gelöscht, Maßnahme
        // blieb zurück und verfälschte die Maßnahmen-Übersicht). Idempotent.
        conn.execute(
            "DELETE FROM massnahmen WHERE bewertung_id NOT IN (SELECT id FROM bewertungen)",
            [],
        )?;

        // Phase 6: Ziele & Sollwerte
        conn.execute(
            "CREATE TABLE IF NOT EXISTS ziele (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lieferant TEXT NOT NULL,
                se_team TEXT,
                quartal TEXT NOT NULL,
                zielwert REAL NOT NULL,
                beschreibung TEXT,
                erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP,
                erstellt_von TEXT
            )",
            [],
        )?;
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_ziele_unique ON ziele(lieferant, quartal)",
            [],
        )?;

        // Phase 7.1: FK-Migration — lieferant_id/se_team_id Spalten hinzufügen
        let has_lieferant_id: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('bewertungen') WHERE name='lieferant_id'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_lieferant_id {
            conn.execute("ALTER TABLE bewertungen ADD COLUMN lieferant_id INTEGER", [])?;
            conn.execute("ALTER TABLE bewertungen ADD COLUMN se_team_id INTEGER", [])?;
        }

        let has_ziele_lieferant_id: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('ziele') WHERE name='lieferant_id'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_ziele_lieferant_id {
            conn.execute("ALTER TABLE ziele ADD COLUMN lieferant_id INTEGER", [])?;
            conn.execute("ALTER TABLE ziele ADD COLUMN se_team_id INTEGER", [])?;
        }

        // Phase 7.1: Backfill — fehlende Lieferanten/SE-Teams auto-erstellen
        conn.execute(
            "INSERT OR IGNORE INTO lieferanten (name)
             SELECT DISTINCT lieferant FROM bewertungen
             WHERE lieferant IS NOT NULL AND lieferant != ''
             AND lieferant NOT IN (SELECT name FROM lieferanten)",
            [],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO se_teams (name)
             SELECT DISTINCT se_team FROM bewertungen
             WHERE se_team IS NOT NULL AND se_team != ''
             AND se_team NOT IN (SELECT name FROM se_teams)",
            [],
        )?;
        conn.execute(
            "INSERT OR IGNORE INTO lieferanten (name)
             SELECT DISTINCT lieferant FROM ziele
             WHERE lieferant IS NOT NULL AND lieferant != ''
             AND lieferant NOT IN (SELECT name FROM lieferanten)",
            [],
        )?;

        // Phase 7.1: Backfill — IDs setzen
        conn.execute(
            "UPDATE bewertungen SET lieferant_id = (SELECT id FROM lieferanten WHERE name = bewertungen.lieferant)
             WHERE lieferant_id IS NULL AND lieferant IS NOT NULL AND lieferant != ''",
            [],
        )?;
        conn.execute(
            "UPDATE bewertungen SET se_team_id = (SELECT id FROM se_teams WHERE name = bewertungen.se_team)
             WHERE se_team_id IS NULL AND se_team IS NOT NULL AND se_team != ''",
            [],
        )?;
        conn.execute(
            "UPDATE ziele SET lieferant_id = (SELECT id FROM lieferanten WHERE name = ziele.lieferant)
             WHERE lieferant_id IS NULL AND lieferant IS NOT NULL AND lieferant != ''",
            [],
        )?;
        conn.execute(
            "UPDATE ziele SET se_team_id = (SELECT id FROM se_teams WHERE name = ziele.se_team)
             WHERE se_team_id IS NULL AND se_team IS NOT NULL AND se_team != ''",
            [],
        )?;

        // Phase 7.1: Indizes für FK-Spalten
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bewertungen_lieferant_id ON bewertungen(lieferant_id)", [])?;
        conn.execute("CREATE INDEX IF NOT EXISTS idx_bewertungen_se_team_id ON bewertungen(se_team_id)", [])?;
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ziele_lieferant_id ON ziele(lieferant_id)", [])?;
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_ziele_unique_id ON ziele(lieferant_id, quartal)", [])?;

        // Migration: Bestehende Freitext-Maßnahmen in massnahmen-Tabelle überführen
        let massnahmen_count: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen", [], |row| row.get(0))?;
        if massnahmen_count == 0 {
            // Nur migrieren wenn Tabelle leer ist (einmalige Migration)
            let mut migrate_stmt = conn.prepare(
                "SELECT id, massnahmen, created_by FROM bewertungen
                 WHERE massnahmen IS NOT NULL AND massnahmen != ''
                 AND massnahmen NOT LIKE '[VQ-Maßnahmen%'"
            )?;
            let migrations: Vec<(i64, String, Option<String>)> = migrate_stmt
                .query_map([], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            for (bew_id, text, created_by) in &migrations {
                // Status-Tags entfernen für sauberen Text
                let clean = text
                    .replace("[VQ-Maßnahmen umgesetzt]", "")
                    .replace("[VQ-Maßnahmen nicht umgesetzt]", "")
                    .trim()
                    .to_string();
                if !clean.is_empty() {
                    conn.execute(
                        "INSERT INTO massnahmen (bewertung_id, beschreibung, status, erstellt_von)
                         VALUES (?1, ?2, 'offen', ?3)",
                        rusqlite::params![bew_id, clean, created_by],
                    )?;
                }
            }
        }

        // Create default admin user if no users exist (password: admin123)
        let user_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;

        if user_count == 0 {
            // Hash the default password with bcrypt
        let hashed_password = hash("admin123", BCRYPT_COST)
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
            conn.execute(
                "INSERT INTO users (username, password_hash, role, active) VALUES ('admin', ?1, 'admin', 1)",
                [&hashed_password],
            )?;
        } else {
            // Migrate existing plaintext passwords to bcrypt (one-time migration)
            self.migrate_passwords_to_bcrypt(conn)?;
            // Ensure all admins have role = 'admin'
            conn.execute("UPDATE users SET role = 'admin' WHERE is_admin = 1 AND (role IS NULL OR role != 'admin')", [])?;
        }

        // Note: No default suppliers or SE-Teams are added
        // Users can add their own via the admin interface

        // Fragen-Tabelle für dynamische Fragen
        conn.execute(
            "CREATE TABLE IF NOT EXISTS fragen (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sort_index INTEGER NOT NULL,
                text TEXT NOT NULL,
                gruppe TEXT NOT NULL,
                is_custom INTEGER DEFAULT 0,
                erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Initialize standard questions if table is empty
        let fragen_count: i32 = conn.query_row("SELECT COUNT(*) FROM fragen", [], |row| row.get(0))?;

        if fragen_count == 0 {
            let standard = get_standard_fragen();
            let mut index = 0;
            for (gruppe, texte) in standard {
                for text in texte {
                    conn.execute(
                        "INSERT INTO fragen (sort_index, text, gruppe, is_custom) VALUES (?1, ?2, ?3, 0)",
                        rusqlite::params![index, text, gruppe],
                    )?;
                    index += 1;
                }
            }
        }

        // Migration: Add gewichtung column to fragen table
        let has_gewichtung: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('fragen') WHERE name='gewichtung'")?
            .query_row([], |row| row.get::<_, i32>(0))
            .map(|count| count > 0)
            .unwrap_or(false);

        if !has_gewichtung {
            conn.execute("ALTER TABLE fragen ADD COLUMN gewichtung INTEGER DEFAULT 1", [])?;
        }

        // Settings-Tabelle für konfigurierbare Einstellungen
        conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Initialize default settings if not present
        let settings_count: i32 = conn.query_row("SELECT COUNT(*) FROM settings", [], |row| row.get(0))?;
        if settings_count == 0 {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('threshold_success', '75.0')",
                [],
            )?;
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('threshold_warning', '50.0')",
                [],
            )?;
        }

        // Migration: Convert array-format antworten to object-format (keyed by frage_id)
        // This ensures correct answer mapping even when questions are added/removed
        self.migrate_antworten_to_object_format(conn)?;

        Ok(())
    }

    /// Einmalige Migration: Konvertiert alte Array-Antworten [2,1,0,...] in Objekt-Format {"frage_id": answer}
    fn migrate_antworten_to_object_format(&self, conn: &Connection) -> SqlResult<()> {
        // Check if any array-format bewertungen exist
        let array_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen WHERE antworten LIKE '[%'",
            [],
            |row| row.get(0),
        )?;

        if array_count == 0 {
            return Ok(());
        }

        // Load sort_index → frage_id mapping
        let mut fragen_stmt = conn.prepare("SELECT id, sort_index FROM fragen ORDER BY sort_index")?;
        let fragen_map: Vec<(i64, i64)> = fragen_stmt
            .query_map([], |row| Ok((row.get::<_, i64>(1)?, row.get::<_, i64>(0)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        // Find and convert all array-format bewertungen
        let mut stmt = conn.prepare("SELECT id, antworten FROM bewertungen WHERE antworten LIKE '[%'")?;
        let array_bewertungen: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        for (id, antworten_str) in &array_bewertungen {
            if let Ok(serde_json::Value::Array(arr)) = serde_json::from_str::<serde_json::Value>(antworten_str) {
                let mut obj = serde_json::Map::new();
                for (sort_index, frage_id) in &fragen_map {
                    if let Some(val) = arr.get(*sort_index as usize) {
                        obj.insert(frage_id.to_string(), val.clone());
                    }
                }
                let new_str = serde_json::to_string(&serde_json::Value::Object(obj)).unwrap_or_default();
                conn.execute(
                    "UPDATE bewertungen SET antworten = ?1 WHERE id = ?2",
                    rusqlite::params![new_str, id],
                )?;
            }
        }

        println!("Migration: {} Bewertungen von Array- zu Objekt-Format konvertiert", array_count);
        Ok(())
    }

    /// Berechnet den Score serverseitig anhand der Antworten und Fragen-Gewichtungen
    fn berechne_ergebnis(&self, conn: &Connection, antworten: &serde_json::Value) -> f32 {
        let antworten_obj = match antworten.as_object() {
            Some(obj) => obj,
            None => return 0.0,
        };

        let mut total_achieved: f64 = 0.0;
        let mut total_max: f64 = 0.0;

        for (frage_id_str, answer_val) in antworten_obj {
            let answer = answer_val.as_i64().unwrap_or(-1);
            if answer < 0 {
                continue; // Unbeantwortet
            }

            // Gewichtung der Frage aus DB laden
            let gewichtung: i32 = frage_id_str.parse::<i64>().ok()
                .and_then(|fid| {
                    conn.query_row(
                        "SELECT gewichtung FROM fragen WHERE id = ?1",
                        [fid],
                        |row| row.get(0),
                    ).ok()
                })
                .unwrap_or(1);

            let base_points = match answer {
                2 => 100.0, // Erfüllt
                1 => 50.0,  // Teilweise
                0 => 0.0,   // Nicht erfüllt
                _ => continue,
            };

            total_achieved += base_points * gewichtung as f64;
            total_max += 100.0 * gewichtung as f64;
        }

        if total_max == 0.0 {
            0.0
        } else {
            ((total_achieved / total_max) * 100.0) as f32
        }
    }

    /// Prüft ob im selben Quartal bereits eine Bewertung für Lieferant + SE-Team existiert
    pub fn check_duplicate_bewertung(&self, lieferant_id: i64, se_team_id: Option<i64>, datum: &str) -> SqlResult<Option<DuplicateInfo>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Quartal aus Datum berechnen (YYYY-MM-DD)
        let parts: Vec<&str> = datum.split('-').collect();
        if parts.len() != 3 {
            return Ok(None);
        }
        let year: i32 = parts[0].parse().unwrap_or(0);
        let month: i32 = parts[1].parse().unwrap_or(0);
        let quarter = (month - 1) / 3;
        let q_start = format!("{}-{:02}-01", year, quarter * 3 + 1);
        let q_end_month = quarter * 3 + 3;
        let q_end_day = match q_end_month {
            3 => 31, 6 => 30, 9 => 30, 12 => 31, _ => 30
        };
        let q_end = format!("{}-{:02}-{:02}", year, q_end_month, q_end_day);

        let st_id = se_team_id.unwrap_or(0);
        let result = conn.query_row(
            "SELECT id, datum, ergebnis FROM bewertungen
             WHERE lieferant_id = ?1 AND COALESCE(se_team_id, 0) = ?2 AND datum >= ?3 AND datum <= ?4
             ORDER BY datum DESC LIMIT 1",
            rusqlite::params![lieferant_id, st_id, &q_start, &q_end],
            |row| {
                Ok(DuplicateInfo {
                    id: row.get(0)?,
                    datum: row.get(1)?,
                    ergebnis: row.get(2)?,
                })
            },
        );

        match result {
            Ok(info) => Ok(Some(info)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn speichere_bewertung(&self, bewertung: &Bewertung) -> SqlResult<i64> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let antworten_str = serde_json::to_string(&bewertung.antworten).unwrap_or_default();
        let kommentare_str = serde_json::to_string(&bewertung.kommentare).unwrap_or_default();

        // Score serverseitig berechnen statt Frontend-Wert blind zu vertrauen
        let ergebnis = self.berechne_ergebnis(&conn, &bewertung.antworten);

        // Lieferant-Name aus ID auflösen (für Text-Spalte + Audit)
        let lieferant_name = if let Some(lid) = bewertung.lieferant_id {
            conn.query_row("SELECT name FROM lieferanten WHERE id = ?1", [lid], |r| r.get::<_, String>(0))
                .unwrap_or(bewertung.lieferant.clone())
        } else {
            bewertung.lieferant.clone()
        };
        let se_team_name = if let Some(sid) = bewertung.se_team_id {
            conn.query_row("SELECT name FROM se_teams WHERE id = ?1", [sid], |r| r.get::<_, String>(0))
                .unwrap_or(bewertung.se_team.clone())
        } else {
            bewertung.se_team.clone()
        };

        conn.execute(
            "INSERT INTO bewertungen (lieferant, se_team, lieferant_id, se_team_id, datum, antworten, kommentare_json, ergebnis, bestellnummer, massnahmen, created_by)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            rusqlite::params![
                &lieferant_name,
                &se_team_name,
                bewertung.lieferant_id,
                bewertung.se_team_id,
                &bewertung.datum,
                antworten_str,
                kommentare_str,
                ergebnis,
                &bewertung.bestellnummer,
                &bewertung.massnahmen,
                &username,
            ],
        )?;

        let id = conn.last_insert_rowid();
        let details = format!("Lieferant: {}, SE-Team: {}, Ergebnis: {:.1}%", lieferant_name, se_team_name, ergebnis);
        self.write_audit_log(&conn, &username, "CREATE", "bewertung", Some(id), &details, true, None)?;

        Ok(id)
    }

    pub fn aktualisiere_bewertung(&self, bewertung: &Bewertung) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let kommentare_str = serde_json::to_string(&bewertung.kommentare).unwrap_or_default();

        conn.execute(
            "UPDATE bewertungen SET kommentare_json = ?1, bestellnummer = ?2, massnahmen = ?3, modified_by = ?4 WHERE id = ?5",
            rusqlite::params![
                kommentare_str,
                &bewertung.bestellnummer,
                &bewertung.massnahmen,
                &username,
                bewertung.id,
            ],
        )?;

        let bew_id = bewertung.id.unwrap_or(0);
        let details = conn.query_row(
            "SELECT lieferant, COALESCE(se_team, ''), datum FROM bewertungen WHERE id = ?1",
            [bew_id],
            |row| {
                let lieferant: String = row.get(0)?;
                let se_team: String = row.get(1)?;
                let datum: String = row.get(2)?;
                Ok(format!("Bewertung aktualisiert: {} / {} vom {} (ID {})", lieferant, se_team, datum, bew_id))
            }
        ).unwrap_or_else(|_| format!("Bewertung ID {} aktualisiert", bew_id));
        self.write_audit_log(&conn, &username, "UPDATE", "bewertung", bewertung.id, &details, true, None)?;

        Ok(())
    }

    pub fn lade_historie(
        &self,
        lieferant_filter: Option<i64>,
        se_team_filter: Option<i64>,
    ) -> SqlResult<Vec<HistorieEintrag>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let base_select = "SELECT b.id, COALESCE(l.name, b.lieferant) as lieferant, COALESCE(st.name, b.se_team, '') as se_team,
             b.datum, b.ergebnis, COALESCE(b.bestellnummer, '') as bestellnummer,
             (b.massnahmen IS NOT NULL AND b.massnahmen != '' AND b.massnahmen NOT LIKE '%[VQ-Maßnahmen umgesetzt]%') as has_new_massnahmen,
             (b.massnahmen LIKE '%[VQ-Maßnahmen umgesetzt]%') as is_resolution,
             b.lieferant_id, b.se_team_id
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             LEFT JOIN se_teams st ON b.se_team_id = st.id";

        let map_row = |row: &rusqlite::Row| -> rusqlite::Result<HistorieEintrag> {
            Ok(HistorieEintrag {
                id: row.get(0)?,
                lieferant_id: row.get(8)?,
                lieferant: row.get(1)?,
                se_team_id: row.get(9)?,
                se_team: row.get(2)?,
                datum: row.get(3)?,
                ergebnis: row.get(4)?,
                bestellnummer: row.get(5)?,
                has_open_massnahmen: row.get::<_, i32>(6)? != 0,
                is_resolution: row.get::<_, i32>(7)? != 0,
                vorquartal_ergebnis: None,
                vorquartal_diff: None,
                massnahmen_total: 0,
                massnahmen_offen: 0,
                massnahmen_erledigt: 0,
            })
        };

        let mut eintraege: Vec<HistorieEintrag> = match (lieferant_filter, se_team_filter) {
            (Some(lid), Some(sid)) => {
                let query = format!("{} WHERE b.lieferant_id = ?1 AND b.se_team_id = ?2 ORDER BY b.datum DESC, b.id DESC", base_select);
                let mut stmt = conn.prepare(&query)?;
                stmt.query_map(rusqlite::params![lid, sid], map_row)?
                    .collect::<Result<Vec<_>, _>>()?
            }
            (Some(lid), None) => {
                let query = format!("{} WHERE b.lieferant_id = ?1 ORDER BY b.datum DESC, b.id DESC", base_select);
                let mut stmt = conn.prepare(&query)?;
                stmt.query_map([lid], map_row)?
                    .collect::<Result<Vec<_>, _>>()?
            }
            (None, Some(sid)) => {
                let query = format!("{} WHERE b.se_team_id = ?1 ORDER BY b.datum DESC, b.id DESC", base_select);
                let mut stmt = conn.prepare(&query)?;
                stmt.query_map([sid], map_row)?
                    .collect::<Result<Vec<_>, _>>()?
            }
            (None, None) => {
                let query = format!("{} ORDER BY b.datum DESC, b.id DESC", base_select);
                let mut stmt = conn.prepare(&query)?;
                stmt.query_map([], map_row)?
                    .collect::<Result<Vec<_>, _>>()?
            }
        };

        // Berechne Vorquartal-Vergleich und Maßnahmen-Counts für jeden Eintrag
        for eintrag in &mut eintraege {
            if let Some((prev_quarter_start, prev_quarter_end)) = Self::get_previous_quarter(&eintrag.datum)
                && let Some(lid) = eintrag.lieferant_id {
                    let prev_result: Option<f32> = conn.query_row(
                        "SELECT ergebnis FROM bewertungen
                         WHERE lieferant_id = ?1 AND datum >= ?2 AND datum <= ?3
                         ORDER BY datum DESC LIMIT 1",
                        rusqlite::params![lid, &prev_quarter_start, &prev_quarter_end],
                        |row| row.get(0),
                    ).ok();

                    if let Some(prev) = prev_result {
                        eintrag.vorquartal_ergebnis = Some(prev);
                        eintrag.vorquartal_diff = Some(eintrag.ergebnis - prev);
                    }
                }

            // Maßnahmen-Counts aus strukturierter Tabelle
            eintrag.massnahmen_total = conn.query_row(
                "SELECT COUNT(*) FROM massnahmen WHERE bewertung_id = ?1",
                [eintrag.id], |r| r.get(0),
            ).unwrap_or(0);
            eintrag.massnahmen_offen = conn.query_row(
                "SELECT COUNT(*) FROM massnahmen WHERE bewertung_id = ?1 AND status IN ('offen', 'in_bearbeitung', 'ueberfaellig')",
                [eintrag.id], |r| r.get(0),
            ).unwrap_or(0);
            eintrag.massnahmen_erledigt = conn.query_row(
                "SELECT COUNT(*) FROM massnahmen WHERE bewertung_id = ?1 AND status = 'erledigt'",
                [eintrag.id], |r| r.get(0),
            ).unwrap_or(0);
        }

        Ok(eintraege)
    }

    /// Berechnet Start- und Enddatum des Vorquartals basierend auf einem Datum
    fn get_previous_quarter(datum: &str) -> Option<(String, String)> {
        // Parse datum (format: YYYY-MM-DD)
        let parts: Vec<&str> = datum.split('-').collect();
        if parts.len() != 3 {
            return None;
        }

        let year: i32 = parts[0].parse().ok()?;
        let month: u32 = parts[1].parse().ok()?;

        // Bestimme aktuelles Quartal und berechne Vorquartal
        let (prev_year, prev_quarter) = match month {
            1..=3 => (year - 1, 4),   // Q1 -> Vorjahr Q4
            4..=6 => (year, 1),        // Q2 -> Q1
            7..=9 => (year, 2),        // Q3 -> Q2
            10..=12 => (year, 3),      // Q4 -> Q3
            _ => return None,
        };

        // Berechne Start- und Enddatum des Vorquartals
        let (start_month, end_month) = match prev_quarter {
            1 => (1, 3),
            2 => (4, 6),
            3 => (7, 9),
            4 => (10, 12),
            _ => return None,
        };

        let start = format!("{:04}-{:02}-01", prev_year, start_month);
        let end = format!("{:04}-{:02}-31", prev_year, end_month); // 31 ist ok, SQL vergleicht als String

        Some((start, end))
    }

    /// Berechnet Start- und Enddatum basierend auf dem Timeframe
    fn get_timeframe_range(timeframe: &str, custom_start: Option<&str>, custom_end: Option<&str>) -> (String, String, String) {
        let now = Local::now();
        let today = now.format("%Y-%m-%d").to_string();

        match timeframe {
            "today" => {
                (today.clone(), today.clone(), "Heute".to_string())
            }
            "week" => {
                // Diese Woche (Montag bis Sonntag)
                let weekday = now.weekday().num_days_from_monday();
                let monday = now - chrono::Duration::days(weekday as i64);
                let sunday = monday + chrono::Duration::days(6);
                (
                    monday.format("%Y-%m-%d").to_string(),
                    sunday.format("%Y-%m-%d").to_string(),
                    "Diese Woche".to_string()
                )
            }
            "month" => {
                // Dieser Monat
                let year = now.format("%Y").to_string();
                let month = now.format("%m").to_string();
                let month_name = match now.month() {
                    1 => "Januar", 2 => "Februar", 3 => "März", 4 => "April",
                    5 => "Mai", 6 => "Juni", 7 => "Juli", 8 => "August",
                    9 => "September", 10 => "Oktober", 11 => "November", 12 => "Dezember",
                    _ => "?"
                };
                (
                    format!("{}-{}-01", year, month),
                    format!("{}-{}-31", year, month),
                    format!("{} {}", month_name, year)
                )
            }
            "quarter" => {
                // Dieses Quartal (Standard)
                Self::get_current_quarter(&today)
            }
            "year" => {
                // Dieses Jahr
                let year = now.format("%Y").to_string();
                (
                    format!("{}-01-01", year),
                    format!("{}-12-31", year),
                    year
                )
            }
            "last_quarter" => {
                // Letztes Quartal
                if let Some((start, end)) = Self::get_previous_quarter(&today) {
                    let parts: Vec<&str> = start.split('-').collect();
                    let year: i32 = parts.first().and_then(|s| s.parse().ok()).unwrap_or(2024);
                    let month: u32 = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
                    let quarter = match month {
                        1..=3 => 1, 4..=6 => 2, 7..=9 => 3, 10..=12 => 4, _ => 1
                    };
                    (start, end, format!("Q{} {}", quarter, year))
                } else {
                    Self::get_current_quarter(&today)
                }
            }
            "last_year" => {
                // Letztes Jahr
                let last_year = now.format("%Y").to_string().parse::<i32>().unwrap_or(2024) - 1;
                (
                    format!("{}-01-01", last_year),
                    format!("{}-12-31", last_year),
                    last_year.to_string()
                )
            }
            "custom" => {
                // Benutzerdefinierter Zeitraum
                if let (Some(start), Some(end)) = (custom_start, custom_end) {
                    // Format dates for display
                    let start_parts: Vec<&str> = start.split('-').collect();
                    let end_parts: Vec<&str> = end.split('-').collect();
                    let label = if start_parts.len() == 3 && end_parts.len() == 3 {
                        format!("{}.{}.{} - {}.{}.{}",
                            start_parts[2], start_parts[1], start_parts[0],
                            end_parts[2], end_parts[1], end_parts[0])
                    } else {
                        "Benutzerdefiniert".to_string()
                    };
                    (start.to_string(), end.to_string(), label)
                } else {
                    // Fallback to current quarter
                    Self::get_current_quarter(&today)
                }
            }
            _ => {
                // Fallback: Aktuelles Quartal
                Self::get_current_quarter(&today)
            }
        }
    }

    pub fn lade_bewertung(&self, id: i64) -> SqlResult<Option<Bewertung>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let mut stmt = conn.prepare(
            "SELECT COALESCE(l.name, b.lieferant) as lieferant, COALESCE(st.name, b.se_team, '') as se_team,
             b.datum, b.antworten, b.ergebnis, COALESCE(b.kommentare_json, '') as kommentare_json,
             COALESCE(b.bestellnummer, '') as bestellnummer, COALESCE(b.massnahmen, '') as massnahmen,
             b.lieferant_id, b.se_team_id
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             LEFT JOIN se_teams st ON b.se_team_id = st.id
             WHERE b.id = ?1"
        )?;

        let mut rows = stmt.query([id])?;

        if let Some(row) = rows.next()? {
            let antworten_str: String = row.get(3)?;
            let antworten: serde_json::Value = serde_json::from_str(&antworten_str)
                .unwrap_or_else(|_| serde_json::json!({}));

            let kommentare_json_str: String = row.get::<_, String>(5).unwrap_or_default();
            let kommentare: serde_json::Value = if !kommentare_json_str.is_empty() {
                serde_json::from_str(&kommentare_json_str).unwrap_or_else(|_| serde_json::json!({}))
            } else {
                serde_json::json!({})
            };

            Ok(Some(Bewertung {
                id: Some(id),
                lieferant_id: row.get(8)?,
                lieferant: row.get(0)?,
                se_team_id: row.get(9)?,
                se_team: row.get(1)?,
                datum: row.get(2)?,
                antworten,
                kommentare,
                ergebnis: row.get(4)?,
                bestellnummer: row.get(6)?,
                massnahmen: row.get(7)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn loesche_bewertung(&self, id: i64) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Details VOR dem Löschen erfassen
        let details = conn.query_row(
            "SELECT lieferant, COALESCE(se_team, ''), datum, ergebnis FROM bewertungen WHERE id = ?1",
            [id],
            |row| {
                let lieferant: String = row.get(0)?;
                let se_team: String = row.get(1)?;
                let datum: String = row.get(2)?;
                let ergebnis: f64 = row.get(3)?;
                Ok(format!("Bewertung ID {}: {} / {} am {} ({:.1}%)", id, lieferant, se_team, datum, ergebnis))
            }
        ).ok().unwrap_or_else(|| format!("Bewertung ID {} gelöscht", id));

        // Erst löschen, dann Audit-Log schreiben (damit Log nur bei Erfolg geschrieben wird).
        // Zugehörige Maßnahmen werden per ON DELETE CASCADE entfernt (foreign_keys ist in
        // init_tables aktiviert) — daher kein manuelles Löschen der massnahmen nötig.
        conn.execute("DELETE FROM bewertungen WHERE id = ?1", [id])?;
        self.write_audit_log(&conn, &username, "DELETE", "bewertung", Some(id), &details, true, None)?;
        Ok(())
    }

    pub fn lade_lieferanten(&self) -> SqlResult<Vec<LieferantInfo>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare("SELECT id, name FROM lieferanten ORDER BY name")?;
        let lieferanten = stmt.query_map([], |row| {
            Ok(LieferantInfo { id: row.get(0)?, name: row.get(1)? })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(lieferanten)
    }

    pub fn fuege_lieferant_hinzu(&self, name: &str) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT OR IGNORE INTO lieferanten (name) VALUES (?1)",
            [name],
        )?;
        
        let details = format!("Lieferant: {}", name);
        self.write_audit_log(&conn, &username, "CREATE", "lieferant", None, &details, true, None)?;
        
        Ok(())
    }

    /// Zählt verknüpfte Bewertungen für einen Lieferanten (per ID)
    pub fn count_bewertungen_for_lieferant(&self, id: i64) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row(
            "SELECT COUNT(*) FROM bewertungen WHERE lieferant_id = ?1",
            [id],
            |row| row.get(0),
        )
    }

    /// Zählt verknüpfte Bewertungen für ein SE-Team (per ID)
    pub fn count_bewertungen_for_se_team(&self, id: i64) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row(
            "SELECT COUNT(*) FROM bewertungen WHERE se_team_id = ?1",
            [id],
            |row| row.get(0),
        )
    }

    pub fn loesche_lieferant(&self, id: i64) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let name: String = conn.query_row(
            "SELECT name FROM lieferanten WHERE id = ?1", [id], |r| r.get(0)
        ).unwrap_or_else(|_| format!("ID {}", id));

        // Kaskadierendes Löschen in Transaktion
        conn.execute("BEGIN TRANSACTION", [])?;

        let result = (|| -> SqlResult<()> {
            conn.execute("DELETE FROM massnahmen WHERE bewertung_id IN (SELECT id FROM bewertungen WHERE lieferant_id = ?1)", [id])?;
            conn.execute("DELETE FROM bewertungen WHERE lieferant_id = ?1", [id])?;
            conn.execute("DELETE FROM ziele WHERE lieferant_id = ?1", [id])?;
            conn.execute("DELETE FROM lieferanten WHERE id = ?1", [id])?;
            Ok(())
        })();

        match result {
            Ok(_) => {
                conn.execute("COMMIT", [])?;
                let details = format!("Lieferant gelöscht (kaskadierend): {} (ID {})", name, id);
                self.write_audit_log(&conn, &username, "DELETE", "lieferant", Some(id), &details, true, None)?;
                Ok(())
            }
            Err(e) => {
                conn.execute("ROLLBACK", []).ok();
                Err(e)
            }
        }
    }

    pub fn lade_se_teams(&self) -> SqlResult<Vec<SeTeamInfo>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare("SELECT id, name FROM se_teams ORDER BY name")?;
        let teams = stmt.query_map([], |row| {
            Ok(SeTeamInfo { id: row.get(0)?, name: row.get(1)? })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(teams)
    }

    pub fn fuege_se_team_hinzu(&self, name: &str) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT OR IGNORE INTO se_teams (name) VALUES (?1)",
            [name],
        )?;
        
        let details = format!("SE-Team: {}", name);
        self.write_audit_log(&conn, &username, "CREATE", "se_team", None, &details, true, None)?;
        
        Ok(())
    }

    pub fn loesche_se_team(&self, id: i64) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let name: String = conn.query_row(
            "SELECT name FROM se_teams WHERE id = ?1", [id], |r| r.get(0)
        ).unwrap_or_else(|_| format!("ID {}", id));

        // Kaskadierendes Löschen in Transaktion
        conn.execute("BEGIN TRANSACTION", [])?;

        let result = (|| -> SqlResult<()> {
            conn.execute("DELETE FROM massnahmen WHERE bewertung_id IN (SELECT id FROM bewertungen WHERE se_team_id = ?1)", [id])?;
            conn.execute("DELETE FROM bewertungen WHERE se_team_id = ?1", [id])?;
            conn.execute("DELETE FROM ziele WHERE se_team_id = ?1", [id])?;
            conn.execute("DELETE FROM se_teams WHERE id = ?1", [id])?;
            Ok(())
        })();

        match result {
            Ok(_) => {
                conn.execute("COMMIT", [])?;
                let details = format!("SE-Team gelöscht (kaskadierend): {} (ID {})", name, id);
                self.write_audit_log(&conn, &username, "DELETE", "se_team", Some(id), &details, true, None)?;
                Ok(())
            }
            Err(e) => {
                conn.execute("ROLLBACK", []).ok();
                Err(e)
            }
        }
    }

    pub fn login(&self, username: &str, password: &str) -> SqlResult<Option<User>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, username, password_hash, \
                COALESCE(NULLIF(role, ''), 'member') as role, \
                COALESCE(active, 1) as active \
             FROM users WHERE username = ?1"
        )?;

        let mut rows = stmt.query([username])?;

        if let Some(row) = rows.next()? {
            let user_id: i64 = row.get(0)?;
            let stored_hash: String = row.get(2)?;
            let active: i32 = row.get(4)?;

            if active == 0 {
                self.write_audit_log(&conn, username, "LOGIN_FAILED", "session", None, "Benutzerkonto deaktiviert", false, Some("Account is inactive")).ok();
                return Ok(None);
            }

            let password_valid = verify(password, &stored_hash).unwrap_or(false);

            if password_valid {
                self.write_audit_log(&conn, username, "LOGIN_SUCCESS", "session", Some(user_id), "Erfolgreicher Login", true, None).ok();
                Ok(Some(User {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    role: row.get(3)?,
                    active: true,
                }))
            } else {
                self.write_audit_log(&conn, username, "LOGIN_FAILED", "session", None, "Ungültiges Passwort", false, Some("Invalid password")).ok();
                Ok(None)
            }
        } else {
            self.write_audit_log(&conn, username, "LOGIN_FAILED", "session", None, "Benutzer nicht gefunden", false, Some("User not found")).ok();
            Ok(None)
        }
    }

    /// Prüft ob ein Benutzer das Standard-Passwort verwendet
    pub fn is_default_password(&self, username: &str) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let stored_hash: Option<String> = conn.query_row(
            "SELECT password_hash FROM users WHERE username = ?1",
            [username],
            |row| row.get(0),
        ).ok();

        if let Some(hash_str) = stored_hash {
            Ok(verify("admin123", &hash_str).unwrap_or(false))
        } else {
            Ok(false)
        }
    }

    pub fn change_password(&self, username: &str, old_password: &str, new_password: &str) -> SqlResult<bool> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // First get the stored hash
        let stored_hash: Option<String> = conn.query_row(
            "SELECT password_hash FROM users WHERE username = ?1",
            [username],
            |row| row.get(0),
        ).ok();

        // Verify old password
        if let Some(hash) = stored_hash {
            if !verify(old_password, &hash).unwrap_or(false) {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }

        if new_password.len() < 8 {
            return Err(rusqlite::Error::InvalidParameterName(
                "Neues Passwort muss mindestens 8 Zeichen haben".to_string()
            ));
        }

        // Hash the new password
        let new_hash = hash(new_password, BCRYPT_COST)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE username = ?2",
            [&new_hash, username],
        )?;

        Ok(true)
    }

    // Migrate plaintext passwords to bcrypt hashes (one-time migration)
    fn migrate_passwords_to_bcrypt(&self, conn: &Connection) -> SqlResult<()> {
        let mut stmt = conn.prepare("SELECT id, password_hash FROM users")?;
        let users: Vec<(i64, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        for (id, stored_password) in users {
            // Check if password is already hashed (bcrypt hashes start with $2)
            if !stored_password.starts_with("$2") {
                // It's plaintext, hash it
                if let Ok(hashed) = hash(&stored_password, BCRYPT_COST) {
                    conn.execute(
                        "UPDATE users SET password_hash = ?1 WHERE id = ?2",
                        rusqlite::params![hashed, id],
                    )?;
                }
            }
        }
        Ok(())
    }

    // Fragen-Verwaltung
    pub fn lade_fragen(&self) -> SqlResult<Vec<Frage>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, sort_index, text, gruppe, is_custom, COALESCE(gewichtung, 1) as gewichtung, erstellt_am FROM fragen ORDER BY sort_index"
        )?;

        let fragen: Vec<Frage> = stmt
            .query_map([], |row| {
                Ok(Frage {
                    id: row.get(0)?,
                    index: row.get::<_, i64>(1)? as usize,
                    text: row.get(2)?,
                    gruppe: row.get(3)?,
                    is_custom: row.get::<_, i32>(4)? == 1,
                    gewichtung: row.get(5)?,
                    erstellt_am: row.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(fragen)
    }

    pub fn fuege_frage_hinzu(&self, frage: &NeueFrage) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Get current max index
        let max_index: i64 = conn
            .query_row("SELECT COALESCE(MAX(sort_index), -1) FROM fragen", [], |row| row.get(0))
            .unwrap_or(-1);

        let new_index = match frage.position {
            Some(pos) => {
                // Shift all questions at and after this position
                conn.execute(
                    "UPDATE fragen SET sort_index = sort_index + 1 WHERE sort_index >= ?1",
                    [pos as i64],
                )?;
                pos as i64
            }
            None => max_index + 1,
        };

        conn.execute(
            "INSERT INTO fragen (sort_index, text, gruppe, is_custom, gewichtung) VALUES (?1, ?2, ?3, 1, ?4)",
            rusqlite::params![new_index, &frage.text, &frage.gruppe, frage.gewichtung],
        )?;

        let id = conn.last_insert_rowid();
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let details = format!("Frage {}: {} (Gruppe: {})", id, frage.text, frage.gruppe);
        self.write_audit_log(&conn, &username, "CREATE", "frage", Some(id), &details, true, None)?;

        Ok(id)
    }

    pub fn aktualisiere_frage(&self, id: i64, text: &str, gewichtung: i32) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "UPDATE fragen SET text = ?1, gewichtung = ?2 WHERE id = ?3",
            rusqlite::params![text, gewichtung, id],
        )?;
        
        let details = format!("Frage {}: {} (Gewichtung: {})", id, text, gewichtung);
        self.write_audit_log(&conn, &username, "UPDATE", "frage", Some(id), &details, true, None)?;
        
        Ok(())
    }

    pub fn loesche_frage(&self, id: i64) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let mut conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let (index, frage_text, frage_gruppe): (i64, String, String) = conn.query_row(
            "SELECT sort_index, text, gruppe FROM fragen WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;

        // DELETE + Reindex atomar in einer Transaktion (auto-rollback bei Fehler)
        {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM fragen WHERE id = ?1", [id])?;
            tx.execute(
                "UPDATE fragen SET sort_index = sort_index - 1 WHERE sort_index > ?1",
                [index],
            )?;
            tx.commit()?;
        }

        let details = format!("Frage gelöscht: '{}' (Gruppe: {}, ID {})", frage_text, frage_gruppe, id);
        self.write_audit_log(&conn, &username, "DELETE", "frage", Some(id), &details, true, None)?;

        Ok(())
    }

    pub fn lade_gruppen(&self) -> SqlResult<Vec<String>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT gruppe FROM fragen GROUP BY gruppe ORDER BY MIN(sort_index)"
        )?;

        let gruppen: Vec<String> = stmt
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(gruppen)
    }

    // ========================================================================
    // Settings-Methoden
    // ========================================================================

    fn read_setting_f32(conn: &rusqlite::Connection, key: &str, default: f32) -> f32 {
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1", [key],
            |row| { let v: String = row.get(0)?; Ok(v.parse().unwrap_or(default)) }
        ).unwrap_or(default)
    }

    fn read_setting_i32(conn: &rusqlite::Connection, key: &str, default: i32) -> i32 {
        conn.query_row(
            "SELECT value FROM settings WHERE key = ?1", [key],
            |row| { let v: String = row.get(0)?; Ok(v.parse().unwrap_or(default)) }
        ).unwrap_or(default)
    }

    pub fn lade_settings(&self) -> SqlResult<Settings> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        Ok(Settings {
            threshold_success: Self::read_setting_f32(&conn, "threshold_success", 75.0),
            threshold_warning: Self::read_setting_f32(&conn, "threshold_warning", 50.0),
            dashboard_top_limit: Self::read_setting_i32(&conn, "dashboard_top_limit", 5),
            dashboard_recent_limit: Self::read_setting_i32(&conn, "dashboard_recent_limit", 5),
            dashboard_critical_limit: Self::read_setting_i32(&conn, "dashboard_critical_limit", 10),
            backup_retention_days: Self::read_setting_i32(&conn, "backup_retention_days", 30),
        })
    }

    pub fn speichere_settings(&self, settings: &Settings) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let pairs: Vec<(&str, String)> = vec![
            ("threshold_success", settings.threshold_success.to_string()),
            ("threshold_warning", settings.threshold_warning.to_string()),
            ("dashboard_top_limit", settings.dashboard_top_limit.to_string()),
            ("dashboard_recent_limit", settings.dashboard_recent_limit.to_string()),
            ("dashboard_critical_limit", settings.dashboard_critical_limit.to_string()),
            ("backup_retention_days", settings.backup_retention_days.to_string()),
        ];

        for (key, value) in &pairs {
            conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
                [*key, value.as_str()],
            )?;
        }

        let details = format!("Einstellungen geändert: Erfolg >= {}%, Warnung >= {}%, Top {}, Letzte {}, Kritische {}, Backup {} Tage",
            settings.threshold_success, settings.threshold_warning,
            settings.dashboard_top_limit, settings.dashboard_recent_limit,
            settings.dashboard_critical_limit, settings.backup_retention_days);
        self.write_audit_log(&conn, &username, "UPDATE", "settings", None, &details, true, None).ok();

        Ok(())
    }

    // ========================================================================
    // Dashboard-Methoden
    // ========================================================================

    pub fn lade_dashboard_data(
        &self,
        timeframe: Option<&str>,
        custom_start: Option<&str>,
        custom_end: Option<&str>
    ) -> SqlResult<DashboardData> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Zeitraum basierend auf Timeframe berechnen
        let tf = timeframe.unwrap_or("quarter");
        let (quartal_start, quartal_end, quartal_name) = Self::get_timeframe_range(tf, custom_start, custom_end);

        // Aktuelles Datum und Quartal für "Fehlende Bewertungen" und "Offene Maßnahmen"
        // Diese sollten immer das aktuelle Quartal zeigen, nicht den ausgewählten Zeitraum
        let heute = Local::now().format("%Y-%m-%d").to_string();
        let (aktuelles_quartal_start, aktuelles_quartal_end, _) = Self::get_current_quarter(&heute);

        // Bewertungen im aktuellen Quartal
        let bewertungen_quartal: i32 = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen WHERE datum >= ?1 AND datum <= ?2",
            [&quartal_start, &quartal_end],
            |row| row.get(0),
        ).unwrap_or(0);

        // Bewertungen gesamt
        let bewertungen_gesamt: i32 = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        // Lieferanten gesamt
        let lieferanten_gesamt: i32 = conn.query_row(
            "SELECT COUNT(*) FROM lieferanten",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        // Durchschnitt im aktuellen Quartal
        let durchschnitt_quartal: Option<f32> = conn.query_row(
            "SELECT AVG(ergebnis) FROM bewertungen WHERE datum >= ?1 AND datum <= ?2",
            [&quartal_start, &quartal_end],
            |row| row.get(0),
        ).ok().flatten();

        // Settings direkt laden (ohne lade_settings aufzurufen um Deadlock zu vermeiden)
        let threshold_warning: f32 = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'threshold_warning'",
                [],
                |row| {
                    let val: String = row.get(0)?;
                    Ok(val.parse().unwrap_or(50.0))
                },
            )
            .unwrap_or(50.0);

        // Konfigurierbare Limits laden
        let critical_limit = Self::read_setting_i32(&conn, "dashboard_critical_limit", 10);
        let recent_limit = Self::read_setting_i32(&conn, "dashboard_recent_limit", 5);
        let top_limit = Self::read_setting_i32(&conn, "dashboard_top_limit", 5);

        // Kritische Lieferanten (letztes Ergebnis unter Warn-Schwellenwert)
        let mut stmt = conn.prepare(
            "SELECT COALESCE(l.name, b.lieferant) as lieferant, b.ergebnis, b.datum
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             INNER JOIN (
                 SELECT lieferant_id, MAX(datum) as max_datum
                 FROM bewertungen
                 GROUP BY lieferant_id
             ) latest ON b.lieferant_id = latest.lieferant_id AND b.datum = latest.max_datum
             WHERE b.ergebnis < ?1
             ORDER BY b.ergebnis ASC
             LIMIT ?2"
        )?;

        let kritische_lieferanten: Vec<KritischerLieferant> = stmt
            .query_map(rusqlite::params![threshold_warning, critical_limit], |row| {
                Ok(KritischerLieferant {
                    name: row.get(0)?,
                    letztes_ergebnis: row.get(1)?,
                    datum: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Fehlende Bewertungen im aktuellen Quartal (nicht im ausgewählten Zeitraum)
        let mut stmt = conn.prepare(
            "SELECT name FROM lieferanten
             WHERE id NOT IN (
                 SELECT DISTINCT lieferant_id FROM bewertungen
                 WHERE lieferant_id IS NOT NULL AND datum >= ?1 AND datum <= ?2
             )
             ORDER BY name"
        )?;

        let fehlende_bewertungen: Vec<String> = stmt
            .query_map([&aktuelles_quartal_start, &aktuelles_quartal_end], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        // Letzte 5 Bewertungen
        let mut stmt = conn.prepare(
            "SELECT b.id, COALESCE(l.name, b.lieferant) as lieferant, COALESCE(st.name, b.se_team, '') as se_team,
             b.datum, b.ergebnis, COALESCE(b.bestellnummer, '') as bestellnummer,
             (b.massnahmen IS NOT NULL AND b.massnahmen != '' AND b.massnahmen NOT LIKE '%[VQ-Maßnahmen umgesetzt]%') as has_new_massnahmen,
             (b.massnahmen LIKE '%[VQ-Maßnahmen umgesetzt]%') as is_resolution,
             b.lieferant_id, b.se_team_id
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             LEFT JOIN se_teams st ON b.se_team_id = st.id
             ORDER BY b.datum DESC, b.id DESC
             LIMIT ?1"
        )?;

        let letzte_bewertungen: Vec<HistorieEintrag> = stmt
            .query_map([recent_limit], |row| {
                Ok(HistorieEintrag {
                    id: row.get(0)?,
                    lieferant_id: row.get(8)?,
                    lieferant: row.get(1)?,
                    se_team_id: row.get(9)?,
                    se_team: row.get(2)?,
                    datum: row.get(3)?,
                    ergebnis: row.get(4)?,
                    bestellnummer: row.get(5)?,
                    has_open_massnahmen: row.get::<_, i32>(6)? != 0,
                    is_resolution: row.get::<_, i32>(7)? != 0,
                    vorquartal_ergebnis: None,
                    vorquartal_diff: None,
                    massnahmen_total: 0,
                    massnahmen_offen: 0,
                    massnahmen_erledigt: 0,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Offene Maßnahmen aus dem Vorquartal
        // Eine Maßnahme gilt als "offen", wenn:
        // 1. Sie im Vorquartal erstellt wurde UND
        // 2. Es KEINE Bewertung im aktuellen Quartal für denselben Lieferanten gibt,
        //    die den Marker [VQ-Maßnahmen umgesetzt] enthält
        let (prev_start, prev_end) = Self::get_previous_quarter(&heute)
            .unwrap_or(("".to_string(), "".to_string()));

        let mut stmt = conn.prepare(
            "SELECT b.id, COALESCE(l.name, b.lieferant) as lieferant, b.massnahmen, b.datum
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             WHERE b.datum >= ?1 AND b.datum <= ?2
             AND b.massnahmen IS NOT NULL AND b.massnahmen != ''
             AND NOT EXISTS (
                 SELECT 1 FROM bewertungen b2
                 WHERE b2.lieferant_id = b.lieferant_id
                 AND b2.datum >= ?3 AND b2.datum <= ?4
                 AND b2.massnahmen LIKE '%[VQ-Maßnahmen umgesetzt]%'
             )
             ORDER BY b.datum DESC
             LIMIT ?5"
        )?;

        let offene_massnahmen: Vec<OffeneMassnahme> = stmt
            .query_map(rusqlite::params![&prev_start, &prev_end, &aktuelles_quartal_start, &aktuelles_quartal_end, recent_limit], |row| {
                Ok(OffeneMassnahme {
                    bewertung_id: row.get(0)?,
                    lieferant: row.get(1)?,
                    massnahmen: row.get(2)?,
                    datum: row.get(3)?,
                    action_due_date: None, // Nicht mehr verwendet
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Threshold für Verteilung holen
        let threshold_success: f32 = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'threshold_success'",
                [],
                |row| {
                    let val: String = row.get(0)?;
                    Ok(val.parse().unwrap_or(75.0))
                },
            )
            .unwrap_or(75.0);

        // Bewertungsverteilung (nur aktuelles Quartal)
        let gruen: i32 = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen WHERE ergebnis >= ?1 AND datum >= ?2 AND datum <= ?3",
            rusqlite::params![threshold_success, &quartal_start, &quartal_end],
            |row| row.get(0),
        ).unwrap_or(0);

        let gelb: i32 = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen WHERE ergebnis >= ?1 AND ergebnis < ?2 AND datum >= ?3 AND datum <= ?4",
            rusqlite::params![threshold_warning, threshold_success, &quartal_start, &quartal_end],
            |row| row.get(0),
        ).unwrap_or(0);

        let rot: i32 = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen WHERE ergebnis < ?1 AND datum >= ?2 AND datum <= ?3",
            rusqlite::params![threshold_warning, &quartal_start, &quartal_end],
            |row| row.get(0),
        ).unwrap_or(0);

        let bewertungsverteilung = BewertungsVerteilung { gruen, gelb, rot };

        // Top Performer - beste Lieferanten nach Durchschnitt (im aktuellen Quartal)
        let mut stmt = conn.prepare(
            "SELECT COALESCE(l.name, b.lieferant) as lieferant, AVG(b.ergebnis) as avg_score
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             WHERE b.datum >= ?1 AND b.datum <= ?2
             GROUP BY b.lieferant_id
             ORDER BY avg_score DESC
             LIMIT ?3"
        )?;
        let top_performer: Vec<TopPerformer> = stmt
            .query_map(rusqlite::params![&quartal_start, &quartal_end, top_limit], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|(_, avg)| *avg >= threshold_success as f64) // Nur grüne anzeigen
            .enumerate()
            .map(|(idx, (name, avg))| TopPerformer {
                rang: (idx + 1) as i32,
                name,
                durchschnitt: avg as f32,
            })
            .collect();

        // Lieferanten nach Kategorie (für Detail-Modal)
        let mut stmt = conn.prepare(
            "SELECT COALESCE(l.name, b.lieferant) as lieferant, b.ergebnis, b.datum
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             WHERE b.datum >= ?1 AND b.datum <= ?2
             ORDER BY b.ergebnis DESC"
        )?;
        let alle_bewertungen: Vec<(String, f32, String)> = stmt
            .query_map([&quartal_start, &quartal_end], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut gruen_lieferanten = Vec::new();
        let mut gelb_lieferanten = Vec::new();
        let mut rot_lieferanten = Vec::new();

        for (name, score, datum) in alle_bewertungen {
            let (score_class, kategorie) = if score >= threshold_success {
                ("success".to_string(), &mut gruen_lieferanten)
            } else if score >= threshold_warning {
                ("warning".to_string(), &mut gelb_lieferanten)
            } else {
                ("danger".to_string(), &mut rot_lieferanten)
            };
            kategorie.push(KategorieLieferant {
                name,
                score,
                datum,
                score_class,
            });
        }

        let lieferanten_nach_kategorie = LieferantenNachKategorie {
            gruen: gruen_lieferanten,
            gelb: gelb_lieferanten,
            rot: rot_lieferanten,
        };

        // Ziele-Summary für Dashboard — alle Ziele laden (aktuelles + zukünftige Quartale)
        let ziele_summary = {
            let mut ziel_stmt = conn.prepare(
                "SELECT z.id, COALESCE(l.name, z.lieferant) as lieferant, z.quartal, z.zielwert, z.lieferant_id
                 FROM ziele z
                 LEFT JOIN lieferanten l ON z.lieferant_id = l.id
                 ORDER BY z.quartal ASC, lieferant ASC"
            );
            match ziel_stmt {
                Ok(ref mut stmt) => {
                    let ziele: Vec<(i64, String, String, f64, Option<i64>)> = stmt
                        .query_map([], |row| {
                            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
                        })
                        .ok()
                        .map(|iter| iter.filter_map(|r| r.ok()).collect())
                        .unwrap_or_default();

                    if ziele.is_empty() {
                        None
                    } else {
                        let mut erreicht = 0i32;
                        let mut knapp = 0i32;
                        let mut verfehlt = 0i32;
                        let mut ohne_bewertung = 0i32;
                        let mut details = Vec::new();

                        for (_id, lieferant_z, quartal_z, zielwert, lid) in &ziele {
                            let (q_start, q_end) = Self::quartal_name_to_range(quartal_z);
                            let ist_wert: Option<f64> = if let Some(lieferant_id) = lid {
                                conn.query_row(
                                    "SELECT ergebnis FROM bewertungen
                                     WHERE lieferant_id = ?1 AND datum >= ?2 AND datum <= ?3
                                     ORDER BY datum DESC LIMIT 1",
                                    rusqlite::params![lieferant_id, q_start, q_end],
                                    |row| row.get(0),
                                ).ok()
                            } else {
                                None
                            };

                            let (ampel, differenz) = if let Some(ist) = ist_wert {
                                let diff = ist - zielwert;
                                let ampel = if ist >= *zielwert {
                                    erreicht += 1;
                                    "gruen".to_string()
                                } else if ist >= zielwert - 5.0 {
                                    knapp += 1;
                                    "gelb".to_string()
                                } else {
                                    verfehlt += 1;
                                    "rot".to_string()
                                };
                                (ampel, Some(diff as f32))
                            } else {
                                ohne_bewertung += 1;
                                ("keine".to_string(), None)
                            };

                            details.push(ZielStatus {
                                lieferant_id: *lid,
                                lieferant: lieferant_z.clone(),
                                quartal: quartal_z.clone(),
                                zielwert: *zielwert as f32,
                                ist_wert: ist_wert.map(|v| v as f32),
                                ampel,
                                differenz,
                            });
                        }

                        Some(ZieleSummary { erreicht, knapp, verfehlt, ohne_bewertung, details })
                    }
                }
                Err(_) => None, // ziele-Tabelle existiert evtl. noch nicht
            }
        };

        Ok(DashboardData {
            bewertungen_quartal,
            bewertungen_gesamt,
            lieferanten_gesamt,
            durchschnitt_quartal,
            kritische_lieferanten,
            fehlende_bewertungen,
            letzte_bewertungen,
            aktuelles_quartal: quartal_name,
            offene_massnahmen,
            bewertungsverteilung,
            top_performer,
            lieferanten_nach_kategorie,
            ziele_summary,
        })
    }

    // ========================================================================
    // User-Management Methoden
    // ========================================================================

    pub fn lade_users(&self) -> SqlResult<Vec<UserForList>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT id, username, COALESCE(role, 'member') as role, COALESCE(active, 1) as active, COALESCE(erstellt_am, '') as erstellt_am FROM users ORDER BY username"
        )?;

        let users: Vec<UserForList> = stmt
            .query_map([], |row| {
                Ok(UserForList {
                    id: row.get(0)?,
                    username: row.get(1)?,
                    role: row.get(2)?,
                    active: row.get::<_, i32>(3)? == 1,
                    erstellt_am: row.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(users)
    }

    pub fn erstelle_user(&self, new_user: &NewUser) -> SqlResult<i64> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Rollen-Whitelist
        if !matches!(new_user.role.as_str(), "admin" | "member" | "controlling") {
            return Err(rusqlite::Error::InvalidParameterName(
                "Ungültige Rolle. Erlaubt: admin, member, controlling".to_string()
            ));
        }

        // Username-Validierung
        let trimmed_username = new_user.username.trim();
        if trimmed_username.is_empty() {
            return Err(rusqlite::Error::InvalidParameterName(
                "Benutzername darf nicht leer sein".to_string()
            ));
        }
        if trimmed_username.len() > 100 {
            return Err(rusqlite::Error::InvalidParameterName(
                "Benutzername zu lang (max 100 Zeichen)".to_string()
            ));
        }

        if new_user.password.len() < 8 {
            return Err(rusqlite::Error::InvalidParameterName(
                "Passwort muss mindestens 8 Zeichen haben".to_string()
            ));
        }

        let hashed_password = hash(&new_user.password, BCRYPT_COST)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "INSERT INTO users (username, password_hash, role, active) VALUES (?1, ?2, ?3, 1)",
            rusqlite::params![trimmed_username, &hashed_password, &new_user.role],
        )?;

        let id = conn.last_insert_rowid();
        let details = format!(
            "Benutzer: {} | Rolle: {} | Aktiv: {}",
            trimmed_username,
            new_user.role,
            true
        );
        self.write_audit_log(&conn, &username, "CREATE", "user", Some(id), &details, true, None)?;

        Ok(id)
    }

    pub fn aktualisiere_user(&self, id: i64, role: &str, active: bool) -> SqlResult<()> {
        // Rollen-Whitelist
        if !matches!(role, "admin" | "member" | "controlling") {
            return Err(rusqlite::Error::InvalidParameterName(
                "Ungültige Rolle. Erlaubt: admin, member, controlling".to_string()
            ));
        }

        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let target_username: String = conn.query_row(
            "SELECT username FROM users WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;

        // Schutz: Der letzte aktive Administrator darf nicht herabgestuft oder deaktiviert
        // werden — sonst gäbe es keinen Admin mehr und die Benutzerverwaltung wäre gesperrt
        // (nur per direktem DB-Eingriff wiederherstellbar). Spiegelt die Logik aus loesche_user.
        let other_active_admins: i64 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?1",
            [id],
            |row| row.get(0),
        )?;
        let bleibt_aktiver_admin = role == "admin" && active;
        if other_active_admins == 0 && !bleibt_aktiver_admin {
            return Err(rusqlite::Error::InvalidParameterName(
                "Der letzte aktive Administrator kann nicht herabgestuft oder deaktiviert werden".to_string()
            ));
        }

        let active_int = if active { 1 } else { 0 };

        conn.execute(
            "UPDATE users SET role = ?1, active = ?2 WHERE id = ?3",
            rusqlite::params![role, active_int, id],
        )?;

        let details = format!(
            "Benutzer '{}' (ID {}) aktualisiert | Rolle: {} | Aktiv: {}",
            target_username, id, role, active
        );
        self.write_audit_log(&conn, &username, "UPDATE", "user", Some(id), &details, true, None)?;

        Ok(())
    }

    pub fn setze_user_passwort(&self, id: i64, new_password: &str) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        if new_password.len() < 8 {
            return Err(rusqlite::Error::InvalidParameterName(
                "Passwort muss mindestens 8 Zeichen haben".to_string()
            ));
        }

        let target_username: String = conn.query_row(
            "SELECT username FROM users WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;

        let hashed_password = hash(new_password, BCRYPT_COST)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

        conn.execute(
            "UPDATE users SET password_hash = ?1 WHERE id = ?2",
            rusqlite::params![&hashed_password, id],
        )?;

        let details = format!(
            "Passwort zurückgesetzt für Benutzer '{}' (ID {})",
            target_username, id
        );
        self.write_audit_log(&conn, &username, "UPDATE", "user_password", Some(id), &details, true, None)?;

        Ok(())
    }

    pub fn loesche_user(&self, id: i64) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let deleted_username: String = conn.query_row(
            "SELECT username FROM users WHERE id = ?1",
            [id],
            |row| row.get(0),
        )?;

        // Verhindere, dass der letzte Admin sich selbst löscht
        if deleted_username == username {
            return Err(rusqlite::Error::InvalidParameterName(
                "Der eigene Account kann nicht gelöscht werden".to_string()
            ));
        }

        // Prüfe ob es der letzte Admin ist
        let admin_count: i32 = conn.query_row(
            "SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?1",
            [id],
            |row| row.get(0),
        )?;
        let is_admin: bool = conn.query_row(
            "SELECT role FROM users WHERE id = ?1",
            [id],
            |row| row.get::<_, String>(0),
        ).map(|r| r == "admin").unwrap_or(false);
        if is_admin && admin_count == 0 {
            return Err(rusqlite::Error::InvalidParameterName(
                "Der letzte Administrator kann nicht gelöscht werden".to_string()
            ));
        }

        let details = format!(
            "Benutzer '{}' (ID {}) gelöscht",
            deleted_username, id
        );
        self.write_audit_log(&conn, &username, "DELETE", "user", Some(id), &details, true, None)?;

        conn.execute("DELETE FROM users WHERE id = ?1", [id])?;

        Ok(())
    }

    // ========================================================================
    // Audit-Log Methoden
    // ========================================================================

    pub fn lade_audit_log(&self, limit: i32) -> SqlResult<Vec<AuditLogEntry>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let has_success: bool = conn
            .prepare("SELECT COUNT(*) FROM pragma_table_info('audit_log') WHERE name='success'")
            .and_then(|mut stmt| stmt.query_row([], |row| row.get::<_, i32>(0).map(|c| c > 0)))
            .unwrap_or(false);

        let query = if has_success {
            "SELECT id, user_id, username, action, entity_type, entity_id, details, timestamp, success, COALESCE(error_message, '') as error_message FROM audit_log ORDER BY timestamp DESC LIMIT ?1"
        } else {
            "SELECT id, user_id, username, action, entity_type, entity_id, details, timestamp FROM audit_log ORDER BY timestamp DESC LIMIT ?1"
        };

        let mut stmt = conn.prepare(query)?;

        let entries: Vec<AuditLogEntry> = if has_success {
            stmt.query_map([limit], |row| {
                Ok(AuditLogEntry {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    username: row.get(2)?,
                    action: row.get(3)?,
                    entity_type: row.get(4)?,
                    entity_id: row.get(5)?,
                    details: row.get(6)?,
                    timestamp: row.get(7)?,
                    success: row.get::<_, i32>(8)? == 1,
                    error_message: Some(row.get(9)?),
                })
            })?.collect::<Result<Vec<_>, _>>()?
        } else {
            stmt.query_map([limit], |row| {
                Ok(AuditLogEntry {
                    id: row.get(0)?,
                    user_id: row.get(1)?,
                    username: row.get(2)?,
                    action: row.get(3)?,
                    entity_type: row.get(4)?,
                    entity_id: row.get(5)?,
                    details: row.get(6)?,
                    timestamp: row.get(7)?,
                    success: true,
                    error_message: None,
                })
            })?.collect::<Result<Vec<_>, _>>()?
        };

        Ok(entries)
    }

    /// Berechnet Start, Ende und Name des aktuellen Quartals
    fn get_current_quarter(datum: &str) -> (String, String, String) {
        let parts: Vec<&str> = datum.split('-').collect();
        if parts.len() != 3 {
            return ("".to_string(), "".to_string(), "Q?".to_string());
        }

        let year: i32 = parts[0].parse().unwrap_or(2024);
        let month: u32 = parts[1].parse().unwrap_or(1);

        let (quarter, start_month, end_month) = match month {
            1..=3 => (1, 1, 3),
            4..=6 => (2, 4, 6),
            7..=9 => (3, 7, 9),
            10..=12 => (4, 10, 12),
            _ => (1, 1, 3),
        };

        let start = format!("{:04}-{:02}-01", year, start_month);
        let end = format!("{:04}-{:02}-31", year, end_month);
        let name = format!("Q{} {}", quarter, year);

        (start, end, name)
    }

    // ========================================================================
    // Vorquartal-Maßnahmen
    // ========================================================================

    pub fn lade_vorquartal_massnahmen(&self, lieferant_id: i64, datum: &str) -> SqlResult<Option<VorquartalMassnahmen>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let letzte_massnahme: Option<VorquartalMassnahmen> = {
            let mut stmt = conn.prepare(
                "SELECT b.massnahmen, b.datum, b.ergebnis, COALESCE(l.name, b.lieferant) as lieferant
                 FROM bewertungen b
                 LEFT JOIN lieferanten l ON b.lieferant_id = l.id
                 WHERE b.lieferant_id = ?1 AND b.datum < ?2
                 AND b.massnahmen IS NOT NULL AND b.massnahmen != ''
                 ORDER BY b.datum DESC"
            )?;

            let mut rows = stmt.query(rusqlite::params![lieferant_id, datum])?;
            let mut found: Option<VorquartalMassnahmen> = None;

            while let Some(row) = rows.next()? {
                let massnahmen: String = row.get(0)?;

                // Bereinige Status-Tags
                let massnahmen_clean = massnahmen
                    .replace("[VQ-Maßnahmen umgesetzt]", "")
                    .replace("[VQ-Maßnahmen nicht umgesetzt]", "")
                    .trim()
                    .to_string();

                // Nur wenn echte Maßnahmen vorhanden sind (nicht nur Status-Tags)
                if !massnahmen_clean.is_empty() {
                    found = Some(VorquartalMassnahmen {
                        massnahmen: massnahmen_clean,
                        datum: row.get(1)?,
                        ergebnis: row.get(2)?,
                        lieferant: row.get(3)?,
                    });
                    break;
                }
            }
            found
        };

        // Wenn keine echte Maßnahme gefunden wurde, nichts anzeigen
        let massnahme = match letzte_massnahme {
            Some(m) => m,
            None => return Ok(None),
        };

        // Schritt 2: Prüfe, ob es eine SPÄTERE Bewertung gibt, die [VQ-Maßnahmen umgesetzt] enthält
        // (d.h. die Maßnahme wurde in einer späteren Bewertung als erledigt markiert)
        let wurde_explizit_umgesetzt: bool = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen
             WHERE lieferant_id = ?1
             AND datum > ?2 AND datum < ?3
             AND massnahmen LIKE '%[VQ-Maßnahmen umgesetzt]%'",
            rusqlite::params![lieferant_id, &massnahme.datum, datum],
            |row| row.get::<_, i64>(0),
        ).unwrap_or(0) > 0;

        if wurde_explizit_umgesetzt {
            return Ok(None);
        }

        // Schritt 3: Fallback für alte Bewertungen ohne Status-Tag
        // Wenn es eine spätere Bewertung gibt, die KEINEN "[VQ-Maßnahmen nicht umgesetzt]" Tag hat
        // UND ein gutes Ergebnis (>= threshold_success) zeigt, betrachte die Maßnahme als implizit umgesetzt
        let threshold_success = Self::read_setting_f32(&conn, "threshold_success", 75.0);
        let wurde_implizit_umgesetzt: bool = conn.query_row(
            "SELECT COUNT(*) FROM bewertungen
             WHERE lieferant_id = ?1
             AND datum > ?2 AND datum < ?3
             AND ergebnis >= ?4
             AND (massnahmen IS NULL OR massnahmen = '' OR massnahmen NOT LIKE '%[VQ-Maßnahmen nicht umgesetzt]%')",
            rusqlite::params![lieferant_id, &massnahme.datum, datum, threshold_success],
            |row| row.get::<_, i64>(0),
        ).unwrap_or(0) > 0;

        if wurde_implizit_umgesetzt {
            return Ok(None);
        }

        // Maßnahme ist noch offen - anzeigen
        Ok(Some(massnahme))
    }

    // ================================================================
    // Strukturiertes Maßnahmen-Tracking (Phase 2)
    // ================================================================

    /// Alle Maßnahmen einer Bewertung laden
    pub fn get_massnahmen(&self, bewertung_id: i64) -> SqlResult<Vec<Massnahme>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut stmt = conn.prepare(
            "SELECT m.id, m.bewertung_id, m.beschreibung, m.verantwortlich, m.faellig_am,
                    m.status, m.erledigt_am, m.erstellt_am, m.erstellt_von
             FROM massnahmen m WHERE m.bewertung_id = ?1
             ORDER BY m.erstellt_am ASC"
        )?;
        let items = stmt.query_map([bewertung_id], |row| {
            Ok(Massnahme {
                id: row.get(0)?,
                bewertung_id: row.get(1)?,
                beschreibung: row.get(2)?,
                verantwortlich: row.get(3)?,
                faellig_am: row.get(4)?,
                status: row.get(5)?,
                erledigt_am: row.get(6)?,
                erstellt_am: row.get(7)?,
                erstellt_von: row.get(8)?,
                lieferant: None,
                se_team: None,
                bewertung_datum: None,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    /// Offene Maßnahmen laden (optional nach Lieferant/SE-Team gefiltert per ID)
    pub fn get_offene_massnahmen(&self, lieferant_id: Option<i64>, se_team_id: Option<i64>) -> SqlResult<Vec<Massnahme>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let mut query = String::from(
            "SELECT m.id, m.bewertung_id, m.beschreibung, m.verantwortlich, m.faellig_am,
                    m.status, m.erledigt_am, m.erstellt_am, m.erstellt_von,
                    COALESCE(l.name, b.lieferant) as lieferant, COALESCE(st.name, b.se_team, '') as se_team, b.datum
             FROM massnahmen m
             JOIN bewertungen b ON m.bewertung_id = b.id
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             LEFT JOIN se_teams st ON b.se_team_id = st.id
             WHERE m.status IN ('offen', 'in_bearbeitung', 'ueberfaellig')"
        );
        let mut params: Vec<i64> = Vec::new();

        if let Some(lid) = lieferant_id {
            params.push(lid);
            query.push_str(&format!(" AND b.lieferant_id = ?{}", params.len()));
        }
        if let Some(sid) = se_team_id {
            params.push(sid);
            query.push_str(&format!(" AND b.se_team_id = ?{}", params.len()));
        }
        query.push_str(" ORDER BY CASE m.status WHEN 'ueberfaellig' THEN 0 WHEN 'offen' THEN 1 ELSE 2 END, m.faellig_am ASC");

        let mut stmt = conn.prepare(&query)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p as &dyn rusqlite::types::ToSql).collect();
        let items = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(Massnahme {
                id: row.get(0)?,
                bewertung_id: row.get(1)?,
                beschreibung: row.get(2)?,
                verantwortlich: row.get(3)?,
                faellig_am: row.get(4)?,
                status: row.get(5)?,
                erledigt_am: row.get(6)?,
                erstellt_am: row.get(7)?,
                erstellt_von: row.get(8)?,
                lieferant: row.get(9)?,
                se_team: row.get(10)?,
                bewertung_datum: row.get(11)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(items)
    }

    /// Neue Maßnahme anlegen
    pub fn create_massnahme(&self, massnahme: &NeueMassnahme) -> SqlResult<i64> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute(
            "INSERT INTO massnahmen (bewertung_id, beschreibung, verantwortlich, faellig_am, erstellt_von)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                massnahme.bewertung_id,
                massnahme.beschreibung,
                massnahme.verantwortlich,
                massnahme.faellig_am,
                username,
            ],
        )?;
        let id = conn.last_insert_rowid();
        let details = format!("Maßnahme für Bewertung #{}: {}", massnahme.bewertung_id, massnahme.beschreibung);
        self.write_audit_log(&conn, &username, "CREATE", "massnahme", Some(id), &details, true, None)?;
        Ok(id)
    }

    /// Maßnahmen-Status ändern
    pub fn update_massnahme_status(&self, id: i64, status: &str) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let erledigt_am = if status == "erledigt" {
            Some(Local::now().format("%Y-%m-%d").to_string())
        } else {
            None
        };

        conn.execute(
            "UPDATE massnahmen SET status = ?1, erledigt_am = ?2 WHERE id = ?3",
            rusqlite::params![status, erledigt_am, id],
        )?;

        let details = format!("Status → {}", status);
        self.write_audit_log(&conn, &username, "UPDATE", "massnahme", Some(id), &details, true, None)?;
        Ok(())
    }

    /// Maßnahme löschen
    pub fn delete_massnahme(&self, id: i64) -> SqlResult<()> {
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.execute("DELETE FROM massnahmen WHERE id = ?1", [id])?;
        self.write_audit_log(&conn, &username, "DELETE", "massnahme", Some(id), "Maßnahme gelöscht", true, None)?;
        Ok(())
    }

    /// Übersicht: Zählt Maßnahmen nach Status
    pub fn get_massnahmen_uebersicht(&self) -> SqlResult<MassnahmenUebersicht> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let offen: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen WHERE status = 'offen'", [], |r| r.get(0))?;
        let in_bearbeitung: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen WHERE status = 'in_bearbeitung'", [], |r| r.get(0))?;
        let ueberfaellig: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen WHERE status = 'ueberfaellig'", [], |r| r.get(0))?;
        let erledigt: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen WHERE status = 'erledigt'", [], |r| r.get(0))?;
        let gesamt: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen", [], |r| r.get(0))?;
        Ok(MassnahmenUebersicht { offen, in_bearbeitung, ueberfaellig, erledigt, gesamt })
    }

    /// Überfällige Maßnahmen automatisch markieren
    pub fn check_ueberfaellige_massnahmen(&self) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let heute = Local::now().format("%Y-%m-%d").to_string();
        let updated = conn.execute(
            "UPDATE massnahmen SET status = 'ueberfaellig'
             WHERE status IN ('offen', 'in_bearbeitung')
             AND faellig_am IS NOT NULL AND faellig_am < ?1",
            [&heute],
        )?;
        Ok(updated as i64)
    }

    // ====================================================================
    // Phase 3: Erweiterte Analytik
    // ====================================================================

    /// Kategorie-Trend: Per-Gruppe Scores pro Bewertung für einen Lieferanten
    pub fn get_kategorie_trend(&self, lieferant_id: i64) -> SqlResult<Vec<KategorieTrendEntry>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Fragen laden (für Gruppen-Zuordnung + Gewichtung)
        let mut fragen_stmt = conn.prepare(
            "SELECT id, gruppe, COALESCE(gewichtung, 1) as gewichtung FROM fragen ORDER BY sort_index"
        )?;
        let fragen: Vec<(i64, String, i32)> = fragen_stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        // Bewertungen des Lieferanten laden
        let mut stmt = conn.prepare(
            "SELECT id, datum, ergebnis, antworten FROM bewertungen WHERE lieferant_id = ?1 ORDER BY datum ASC"
        )?;

        let rows: Vec<(i64, String, f32, String)> = stmt
            .query_map([lieferant_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut result = Vec::new();

        for (_id, datum, ergebnis, antworten_str) in rows {
            let antworten: serde_json::Value = serde_json::from_str(&antworten_str)
                .unwrap_or_else(|_| serde_json::json!({}));

            // Per Gruppe aggregieren
            let mut gruppen: std::collections::HashMap<String, (f64, f64, usize)> = std::collections::HashMap::new();

            for (frage_id, gruppe, gewichtung) in &fragen {
                let entry = gruppen.entry(gruppe.clone()).or_insert((0.0, 0.0, 0));
                entry.2 += 1; // fragen_count

                // Antwort-Wert lesen (Format: {"frage_id": answer_value})
                let answer = antworten.get(frage_id.to_string())
                    .and_then(|v| v.as_i64())
                    .unwrap_or(-1);

                if answer >= 0 {
                    let w = *gewichtung as f64;
                    entry.0 += answer as f64 * w; // gewichteter score
                    entry.1 += 2.0 * w;           // max score
                }
            }

            let categories: Vec<KategorieTrendScore> = gruppen.into_iter()
                .filter(|(_, (_, max, _))| *max > 0.0)
                .map(|(gruppe, (sum, max, count))| KategorieTrendScore {
                    gruppe,
                    score: ((sum / max) * 100.0) as f32,
                    fragen_count: count,
                })
                .collect();

            result.push(KategorieTrendEntry {
                datum,
                ergebnis,
                categories,
            });
        }

        Ok(result)
    }

    /// SE-Team-Vergleich: Durchschnittliche Bewertung pro Lieferant × SE-Team
    pub fn get_se_team_vergleich(&self) -> SqlResult<Vec<SeTeamVergleichEntry>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let mut stmt = conn.prepare(
            "SELECT COALESCE(l.name, b.lieferant) as lieferant, COALESCE(st.name, b.se_team) as se_team,
             AVG(b.ergebnis) as avg_score, COUNT(*) as cnt
             FROM bewertungen b
             LEFT JOIN lieferanten l ON b.lieferant_id = l.id
             LEFT JOIN se_teams st ON b.se_team_id = st.id
             WHERE b.se_team_id IS NOT NULL
             GROUP BY b.lieferant_id, b.se_team_id
             ORDER BY lieferant, se_team"
        )?;

        let entries: Vec<SeTeamVergleichEntry> = stmt
            .query_map([], |row| {
                Ok(SeTeamVergleichEntry {
                    lieferant: row.get(0)?,
                    se_team: row.get(1)?,
                    avg_score: row.get::<_, f64>(2)? as f32,
                    count: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(entries)
    }

    // ====================================================================
    // Phase 4: Import
    // ====================================================================

    pub fn import_bewertungen(&self, bewertungen: &[ImportBewertung], skip_duplicates: bool) -> SqlResult<ImportResult> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());

        let mut imported = 0i32;
        let mut skipped_duplicate = 0i32;
        let mut errors = Vec::new();

        // Gesamter Import in EINER Transaktion: deutlich schneller (kein fsync pro Zeile)
        // und atomar. Fehlerhafte Einzelzeilen werden weiterhin übersprungen und gesammelt;
        // alle gültigen Zeilen werden am Ende gemeinsam committet.
        conn.execute("BEGIN TRANSACTION", [])?;

        for (idx, b) in bewertungen.iter().enumerate() {
            let row_num = idx + 1;

            // Validierung
            if b.lieferant.trim().is_empty() {
                errors.push(format!("Zeile {}: Lieferant fehlt", row_num));
                continue;
            }
            if b.datum.trim().is_empty() {
                errors.push(format!("Zeile {}: Datum fehlt", row_num));
                continue;
            }
            if b.ergebnis < 0.0 || b.ergebnis > 100.0 {
                errors.push(format!("Zeile {}: Ergebnis ungültig ({})", row_num, b.ergebnis));
                continue;
            }

            // Lieferant-ID auflösen (auto-erstellen falls nötig)
            if let Err(e) = conn.execute("INSERT OR IGNORE INTO lieferanten (name) VALUES (?1)", [b.lieferant.trim()]) {
                errors.push(format!("Zeile {}: Lieferant konnte nicht angelegt werden: {}", row_num, e));
                continue;
            }
            let lid: i64 = match conn.query_row(
                "SELECT id FROM lieferanten WHERE name = ?1", [b.lieferant.trim()], |r| r.get(0)
            ) {
                Ok(id) => id,
                Err(e) => {
                    errors.push(format!("Zeile {}: Lieferant-ID nicht gefunden: {}", row_num, e));
                    continue;
                }
            };

            let sid: Option<i64> = if !b.se_team.trim().is_empty() {
                if let Err(e) = conn.execute("INSERT OR IGNORE INTO se_teams (name) VALUES (?1)", [b.se_team.trim()]) {
                    errors.push(format!("Zeile {}: SE-Team konnte nicht angelegt werden: {}", row_num, e));
                    continue;
                }
                conn.query_row("SELECT id FROM se_teams WHERE name = ?1", [b.se_team.trim()], |r| r.get(0)).ok()
            } else {
                None
            };

            // Duplikat-Check (per ID)
            if skip_duplicates {
                let existing: i32 = conn.query_row(
                    "SELECT COUNT(*) FROM bewertungen WHERE lieferant_id = ?1 AND COALESCE(se_team_id, 0) = ?2 AND datum = ?3",
                    rusqlite::params![lid, sid.unwrap_or(0), b.datum.trim()],
                    |row| row.get(0),
                ).unwrap_or(0);

                if existing > 0 {
                    skipped_duplicate += 1;
                    continue;
                }
            }

            // Insert mit IDs
            let result = conn.execute(
                "INSERT INTO bewertungen (lieferant, se_team, lieferant_id, se_team_id, datum, ergebnis, antworten, kommentare_json, bestellnummer, massnahmen)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, '{}', '{}', ?7, ?8)",
                rusqlite::params![
                    b.lieferant.trim(),
                    b.se_team.trim(),
                    lid,
                    sid,
                    b.datum.trim(),
                    b.ergebnis,
                    b.bestellnummer.trim(),
                    b.massnahmen.trim()
                ],
            );

            match result {
                Ok(_) => {
                    imported += 1;
                }
                Err(e) => {
                    errors.push(format!("Zeile {}: {}", row_num, e));
                }
            }
        }

        // Audit-Log (innerhalb der Transaktion, damit alles gemeinsam persistiert wird)
        let details = format!("CSV-Import: {} importiert, {} Duplikate übersprungen, {} Fehler",
            imported, skipped_duplicate, errors.len());
        self.write_audit_log(&conn, &username, "IMPORT_CSV", "import", None, &details, true, None).ok();

        // Gemeinsamer Commit aller gültigen Zeilen; bei Commit-Fehler sauber zurückrollen.
        if let Err(e) = conn.execute("COMMIT", []) {
            conn.execute("ROLLBACK", []).ok();
            return Err(e);
        }

        Ok(ImportResult { imported, skipped_duplicate, errors })
    }

    // ====================================================================
    // Phase 6: Ziele & Sollwerte
    // ====================================================================

    /// Alle Ziele laden, optional gefiltert nach Lieferant-ID und/oder Quartal
    pub fn lade_ziele(&self, lieferant_id: Option<i64>, quartal: Option<&str>) -> SqlResult<Vec<Ziel>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let mut sql = "SELECT z.id, z.lieferant_id, COALESCE(l.name, z.lieferant) as lieferant, z.se_team, z.quartal, z.zielwert, z.beschreibung, z.erstellt_am, z.erstellt_von FROM ziele z LEFT JOIN lieferanten l ON z.lieferant_id = l.id WHERE 1=1".to_string();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(lid) = lieferant_id {
            params.push(Box::new(lid));
            sql.push_str(&format!(" AND z.lieferant_id = ?{}", params.len()));
        }
        if let Some(q) = quartal
            && !q.is_empty() {
                params.push(Box::new(q.to_string()));
                sql.push_str(&format!(" AND z.quartal = ?{}", params.len()));
            }
        sql.push_str(" ORDER BY z.quartal DESC, lieferant ASC");

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let ziele = stmt.query_map(param_refs.as_slice(), |row| {
            Ok(Ziel {
                id: row.get(0)?,
                lieferant_id: row.get(1)?,
                lieferant: row.get(2)?,
                se_team: row.get(3)?,
                quartal: row.get(4)?,
                zielwert: row.get::<_, f64>(5)? as f32,
                beschreibung: row.get(6)?,
                erstellt_am: row.get::<_, String>(7).unwrap_or_default(),
                erstellt_von: row.get(8)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(ziele)
    }

    /// Ein einzelnes Ziel für einen Lieferanten in einem bestimmten Quartal laden
    pub fn get_ziel_fuer_lieferant(&self, lieferant_id: i64, quartal: &str) -> SqlResult<Option<Ziel>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let result = conn.query_row(
            "SELECT z.id, z.lieferant_id, COALESCE(l.name, z.lieferant) as lieferant, z.se_team, z.quartal, z.zielwert, z.beschreibung, z.erstellt_am, z.erstellt_von
             FROM ziele z LEFT JOIN lieferanten l ON z.lieferant_id = l.id
             WHERE z.lieferant_id = ?1 AND z.quartal = ?2",
            rusqlite::params![lieferant_id, quartal],
            |row| {
                Ok(Ziel {
                    id: row.get(0)?,
                    lieferant_id: row.get(1)?,
                    lieferant: row.get(2)?,
                    se_team: row.get(3)?,
                    quartal: row.get(4)?,
                    zielwert: row.get::<_, f64>(5)? as f32,
                    beschreibung: row.get(6)?,
                    erstellt_am: row.get::<_, String>(7).unwrap_or_default(),
                    erstellt_von: row.get(8)?,
                })
            },
        );

        match result {
            Ok(z) => Ok(Some(z)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Neues Ziel erstellen
    pub fn erstelle_ziel(&self, ziel: &NeuesZiel) -> SqlResult<i64> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());

        // Lieferant-Name aus ID auflösen
        let lieferant_name: String = if let Some(lid) = ziel.lieferant_id {
            conn.query_row("SELECT name FROM lieferanten WHERE id = ?1", [lid], |row| row.get(0))
                .unwrap_or_else(|_| ziel.lieferant.clone())
        } else {
            ziel.lieferant.clone()
        };

        conn.execute(
            "INSERT INTO ziele (lieferant_id, lieferant, se_team, quartal, zielwert, beschreibung, erstellt_von)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                ziel.lieferant_id, lieferant_name, ziel.se_team, ziel.quartal,
                ziel.zielwert, ziel.beschreibung, username
            ],
        )?;

        let id = conn.last_insert_rowid();

        self.write_audit_log(
            &conn, &username, "CREATE_ZIEL", "ziele", Some(id),
            &format!("Ziel erstellt: {} {} → {}%", lieferant_name, ziel.quartal, ziel.zielwert),
            true, None
        ).ok();

        Ok(id)
    }

    /// Ziel aktualisieren
    pub fn aktualisiere_ziel(&self, id: i64, zielwert: f32, beschreibung: Option<&str>) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());

        conn.execute(
            "UPDATE ziele SET zielwert = ?1, beschreibung = ?2 WHERE id = ?3",
            rusqlite::params![zielwert, beschreibung, id],
        )?;

        self.write_audit_log(
            &conn, &username, "UPDATE_ZIEL", "ziele", Some(id),
            &format!("Ziel aktualisiert: {}%", zielwert),
            true, None
        ).ok();

        Ok(())
    }

    /// Ziel löschen
    pub fn loesche_ziel(&self, id: i64) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());

        // Details für Audit-Log laden
        let details: String = conn.query_row(
            "SELECT lieferant || ' ' || quartal FROM ziele WHERE id = ?1",
            [id],
            |row| row.get(0),
        ).unwrap_or_else(|_| format!("ID {}", id));

        conn.execute("DELETE FROM ziele WHERE id = ?1", [id])?;

        self.write_audit_log(
            &conn, &username, "DELETE_ZIEL", "ziele", Some(id),
            &format!("Ziel gelöscht: {}", details),
            true, None
        ).ok();

        Ok(())
    }

    /// Ziele-Summary: Für jedes Ziel den Ist-Wert ermitteln und Ampel berechnen
    pub fn lade_ziele_summary(&self, quartal: Option<&str>) -> SqlResult<ZieleSummary> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        // Aktuelles Quartal bestimmen falls nicht angegeben
        let heute = Local::now().format("%Y-%m-%d").to_string();
        let (_, _, quartal_name) = Self::get_current_quarter(&heute);
        let q = quartal.unwrap_or(&quartal_name);

        let mut stmt = conn.prepare(
            "SELECT z.id, z.lieferant_id, COALESCE(l.name, z.lieferant) as lieferant, z.quartal, z.zielwert
             FROM ziele z LEFT JOIN lieferanten l ON z.lieferant_id = l.id
             WHERE z.quartal = ?1 ORDER BY lieferant"
        )?;

        let ziele: Vec<(i64, Option<i64>, String, String, f64)> = stmt
            .query_map([q], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut erreicht = 0i32;
        let mut knapp = 0i32;
        let mut verfehlt = 0i32;
        let mut ohne_bewertung = 0i32;
        let mut details = Vec::new();

        for (_id, lieferant_id, lieferant, quartal_val, zielwert) in &ziele {
            // Quartal-Zeitraum berechnen: "Q1 2026" → Datumsrange
            let (q_start, q_end) = Self::quartal_name_to_range(quartal_val);

            // Neueste Bewertung im Quartal für diesen Lieferanten (via lieferant_id)
            let ist_wert: Option<f64> = if let Some(lid) = lieferant_id {
                conn.query_row(
                    "SELECT ergebnis FROM bewertungen
                     WHERE lieferant_id = ?1 AND datum >= ?2 AND datum <= ?3
                     ORDER BY datum DESC LIMIT 1",
                    rusqlite::params![lid, q_start, q_end],
                    |row| row.get(0),
                ).ok()
            } else {
                conn.query_row(
                    "SELECT ergebnis FROM bewertungen
                     WHERE lieferant = ?1 AND datum >= ?2 AND datum <= ?3
                     ORDER BY datum DESC LIMIT 1",
                    rusqlite::params![lieferant, q_start, q_end],
                    |row| row.get(0),
                ).ok()
            };

            let (ampel, differenz) = if let Some(ist) = ist_wert {
                let diff = ist - zielwert;
                let ampel = if ist >= *zielwert {
                    erreicht += 1;
                    "gruen".to_string()
                } else if ist >= zielwert - 5.0 {
                    knapp += 1;
                    "gelb".to_string()
                } else {
                    verfehlt += 1;
                    "rot".to_string()
                };
                (ampel, Some(diff as f32))
            } else {
                ohne_bewertung += 1;
                ("keine".to_string(), None)
            };

            details.push(ZielStatus {
                lieferant_id: *lieferant_id,
                lieferant: lieferant.clone(),
                quartal: quartal_val.clone(),
                zielwert: *zielwert as f32,
                ist_wert: ist_wert.map(|v| v as f32),
                ampel,
                differenz,
            });
        }

        Ok(ZieleSummary { erreicht, knapp, verfehlt, ohne_bewertung, details })
    }

    /// Hilfsfunktion: Quartal-Name (z.B. "Q1 2026") in Datumsrange umwandeln
    fn quartal_name_to_range(quartal: &str) -> (String, String) {
        // Unterstützt Formate: "Q1 2026", "2026-Q1", "Q1/2026"
        let cleaned = quartal.replace(['/', '-'], " ");
        let parts: Vec<&str> = cleaned.split_whitespace().collect();

        let (q_num, year) = if parts.len() == 2 {
            if parts[0].starts_with('Q') || parts[0].starts_with('q') {
                let q: u32 = parts[0][1..].parse().unwrap_or(1);
                let y: i32 = parts[1].parse().unwrap_or(2026);
                (q, y)
            } else {
                let y: i32 = parts[0].parse().unwrap_or(2026);
                let q: u32 = parts[1].trim_start_matches(|c: char| !c.is_ascii_digit()).parse().unwrap_or(1);
                (q, y)
            }
        } else {
            (1, 2026)
        };

        let (start_month, end_month, end_day) = match q_num {
            1 => (1, 3, 31),
            2 => (4, 6, 30),
            3 => (7, 9, 30),
            4 => (10, 12, 31),
            _ => (1, 3, 31),
        };

        (
            format!("{:04}-{:02}-01", year, start_month),
            format!("{:04}-{:02}-{:02}", year, end_month, end_day),
        )
    }

    /// Gibt Liste der Lieferanten zurück, die im aktuellen Quartal noch nicht bewertet wurden
    pub fn lade_fehlende_bewertungen(&self) -> SqlResult<Vec<String>> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());

        let heute = Local::now().format("%Y-%m-%d").to_string();
        let (quartal_start, quartal_end, _) = Self::get_current_quarter(&heute);

        let mut stmt = conn.prepare(
            "SELECT name FROM lieferanten
             WHERE id NOT IN (
                 SELECT DISTINCT lieferant_id FROM bewertungen
                 WHERE lieferant_id IS NOT NULL AND datum >= ?1 AND datum <= ?2
             )
             ORDER BY name"
        )?;

        let fehlende: Vec<String> = stmt
            .query_map([&quartal_start, &quartal_end], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(fehlende)
    }

    // ====================================================================
    // Phase 7: Rename-Funktionen (FK-basiert)
    // ====================================================================

    /// Lieferant umbenennen — ändert nur lieferanten.name, alle Bewertungen/Ziele folgen via JOIN
    pub fn rename_lieferant(&self, id: i64, new_name: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());

        let old_name: String = conn.query_row(
            "SELECT name FROM lieferanten WHERE id = ?1", [id], |row| row.get(0)
        )?;

        // Alle Updates in Transaktion
        conn.execute("BEGIN TRANSACTION", [])?;

        let result = (|| -> SqlResult<()> {
            conn.execute("UPDATE lieferanten SET name = ?1 WHERE id = ?2", rusqlite::params![new_name, id])?;
            // Text-Spalten synchronisieren für Backward-Compatibility
            conn.execute("UPDATE bewertungen SET lieferant = ?1 WHERE lieferant_id = ?2", rusqlite::params![new_name, id])?;
            conn.execute("UPDATE ziele SET lieferant = ?1 WHERE lieferant_id = ?2", rusqlite::params![new_name, id])?;
            Ok(())
        })();

        match result {
            Ok(_) => {
                conn.execute("COMMIT", [])?;
                self.write_audit_log(
                    &conn, &username, "RENAME_LIEFERANT", "lieferanten", Some(id),
                    &format!("Lieferant umbenannt: '{}' → '{}'", old_name, new_name),
                    true, None
                ).ok();
                Ok(())
            }
            Err(e) => {
                conn.execute("ROLLBACK", []).ok();
                Err(e)
            }
        }
    }

    /// SE-Team umbenennen — ändert nur se_teams.name, alle Bewertungen folgen via JOIN
    pub fn rename_se_team(&self, id: i64, new_name: &str) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap_or_else(|e| e.into_inner());
        let username = self.get_current_username().unwrap_or_else(|| "unknown".to_string());

        let old_name: String = conn.query_row(
            "SELECT name FROM se_teams WHERE id = ?1", [id], |row| row.get(0)
        )?;

        // Alle Updates in Transaktion
        conn.execute("BEGIN TRANSACTION", [])?;

        let result = (|| -> SqlResult<()> {
            conn.execute("UPDATE se_teams SET name = ?1 WHERE id = ?2", rusqlite::params![new_name, id])?;
            // Text-Spalten synchronisieren
            conn.execute("UPDATE bewertungen SET se_team = ?1 WHERE se_team_id = ?2", rusqlite::params![new_name, id])?;
            Ok(())
        })();

        match result {
            Ok(_) => {
                conn.execute("COMMIT", [])?;
                self.write_audit_log(
                    &conn, &username, "RENAME_SE_TEAM", "se_teams", Some(id),
                    &format!("SE-Team umbenannt: '{}' → '{}'", old_name, new_name),
                    true, None
                ).ok();
                Ok(())
            }
            Err(e) => {
                conn.execute("ROLLBACK", []).ok();
                Err(e)
            }
        }
    }

}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
fn get_lieferanten(db: State<Database>) -> Result<Vec<LieferantInfo>, String> {
    db.require_login()?;
    db.lade_lieferanten().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_lieferant(db: State<Database>, name: String) -> Result<(), String> {
    db.require_member_or_admin()?;
    let name = name.trim();
    if name.is_empty() {
        return Err("Name darf nicht leer sein".to_string());
    }
    if name.len() > 200 {
        return Err("Name zu lang (max 200 Zeichen)".to_string());
    }
    db.fuege_lieferant_hinzu(name).map_err(|e| e.to_string())
}

#[tauri::command]
fn count_bewertungen_for_lieferant_cmd(db: State<Database>, id: i64) -> Result<i64, String> {
    db.require_login()?;
    db.count_bewertungen_for_lieferant(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn count_bewertungen_for_se_team_cmd(db: State<Database>, id: i64) -> Result<i64, String> {
    db.require_login()?;
    db.count_bewertungen_for_se_team(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_lieferant(db: State<Database>, id: i64) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Lieferanten löschen".to_string());
    }
    db.loesche_lieferant(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_fragen_cmd(db: State<Database>) -> Result<Vec<Frage>, String> {
    db.require_login()?;
    db.lade_fragen().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_frage_cmd(db: State<Database>, frage: NeueFrage) -> Result<i64, String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Fragen hinzufügen".to_string());
    }
    let text = frage.text.trim();
    let gruppe = frage.gruppe.trim();
    if text.is_empty() {
        return Err("Fragetext darf nicht leer sein".to_string());
    }
    if text.len() > 1000 {
        return Err("Fragetext zu lang (max 1000 Zeichen)".to_string());
    }
    if gruppe.is_empty() {
        return Err("Gruppe darf nicht leer sein".to_string());
    }
    if gruppe.len() > 200 {
        return Err("Gruppenname zu lang (max 200 Zeichen)".to_string());
    }
    if frage.gewichtung < 1 || frage.gewichtung > 10 {
        return Err("Gewichtung muss zwischen 1 und 10 liegen".to_string());
    }
    let validated_frage = NeueFrage {
        text: text.to_string(),
        gruppe: gruppe.to_string(),
        gewichtung: frage.gewichtung,
        position: frage.position,
    };
    db.fuege_frage_hinzu(&validated_frage).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_frage_cmd(db: State<Database>, id: i64, text: String, gewichtung: i32) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Fragen bearbeiten".to_string());
    }
    let text = text.trim();
    if text.is_empty() {
        return Err("Fragetext darf nicht leer sein".to_string());
    }
    if text.len() > 1000 {
        return Err("Fragetext zu lang (max 1000 Zeichen)".to_string());
    }
    if !((1..=10).contains(&gewichtung)) {
        return Err("Gewichtung muss zwischen 1 und 10 liegen".to_string());
    }
    db.aktualisiere_frage(id, text, gewichtung).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_frage_cmd(db: State<Database>, id: i64) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Fragen löschen".to_string());
    }
    db.loesche_frage(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_gruppen_cmd(db: State<Database>) -> Result<Vec<String>, String> {
    db.require_login()?;
    db.lade_gruppen().map_err(|e| e.to_string())
}

// ============================================================================
// Settings Commands
// ============================================================================

#[tauri::command]
fn get_settings_cmd(db: State<Database>) -> Result<Settings, String> {
    db.require_login()?;
    db.lade_settings().map_err(|e| e.to_string())
}

#[tauri::command]
fn update_settings_cmd(db: State<Database>, settings: Settings) -> Result<(), String> {
    // Admin-Check
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Einstellungen ändern".to_string());
    }

    // Validierung
    if settings.threshold_success <= settings.threshold_warning {
        return Err("Erfolgs-Schwellenwert muss größer als Warn-Schwellenwert sein".to_string());
    }
    if settings.threshold_success > 100.0 || settings.threshold_success < 0.0 {
        return Err("Erfolgs-Schwellenwert muss zwischen 0 und 100 liegen".to_string());
    }
    if settings.threshold_warning > 100.0 || settings.threshold_warning < 0.0 {
        return Err("Warn-Schwellenwert muss zwischen 0 und 100 liegen".to_string());
    }
    if settings.dashboard_top_limit < 1 || settings.dashboard_top_limit > 50 {
        return Err("Dashboard Top-Limit muss zwischen 1 und 50 liegen".to_string());
    }
    if settings.dashboard_recent_limit < 1 || settings.dashboard_recent_limit > 50 {
        return Err("Dashboard Letzte-Limit muss zwischen 1 und 50 liegen".to_string());
    }
    if settings.dashboard_critical_limit < 1 || settings.dashboard_critical_limit > 50 {
        return Err("Dashboard Kritische-Limit muss zwischen 1 und 50 liegen".to_string());
    }
    if settings.backup_retention_days < 1 || settings.backup_retention_days > 365 {
        return Err("Backup-Aufbewahrung muss zwischen 1 und 365 Tagen liegen".to_string());
    }
    db.speichere_settings(&settings).map_err(|e| e.to_string())
}

// ============================================================================
// Dashboard Commands
// ============================================================================

#[tauri::command]
fn get_dashboard_data_cmd(
    db: State<Database>,
    timeframe: Option<String>,
    custom_start: Option<String>,
    custom_end: Option<String>
) -> Result<DashboardData, String> {
    db.require_login()?;
    db.lade_dashboard_data(
        timeframe.as_deref(),
        custom_start.as_deref(),
        custom_end.as_deref()
    ).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_fehlende_bewertungen_cmd(db: State<Database>) -> Result<Vec<String>, String> {
    db.require_login()?;
    db.lade_fehlende_bewertungen().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_vorquartal_massnahmen_cmd(
    db: State<Database>,
    lieferant_id: i64,
    datum: String,
) -> Result<Option<VorquartalMassnahmen>, String> {
    db.require_login()?;
    db.lade_vorquartal_massnahmen(lieferant_id, &datum)
        .map_err(|e| e.to_string())
}

// ================================================================
// Phase 2: Maßnahmen-Tracking Commands
// ================================================================

#[tauri::command]
fn get_massnahmen_cmd(db: State<Database>, bewertung_id: i64) -> Result<Vec<Massnahme>, String> {
    db.require_login()?;
    db.get_massnahmen(bewertung_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_offene_massnahmen_cmd(
    db: State<Database>,
    lieferant_id: Option<i64>,
    se_team_id: Option<i64>,
) -> Result<Vec<Massnahme>, String> {
    db.require_login()?;
    db.get_offene_massnahmen(lieferant_id, se_team_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn create_massnahme_cmd(db: State<Database>, massnahme: NeueMassnahme) -> Result<i64, String> {
    db.require_member_or_admin()?;
    if massnahme.beschreibung.trim().is_empty() {
        return Err("Beschreibung darf nicht leer sein".to_string());
    }
    db.create_massnahme(&massnahme).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_massnahme_status_cmd(db: State<Database>, id: i64, status: String) -> Result<(), String> {
    // Alle Rollen (Admin, Member, Controlling) dürfen den Status aktualisieren
    // Controlling: Prüf-/Freigabefunktion; Member: eigene Maßnahmen abarbeiten
    db.require_login()?;
    let valid = ["offen", "in_bearbeitung", "erledigt", "ueberfaellig"];
    if !valid.contains(&status.as_str()) {
        return Err(format!("Ungültiger Status: {}. Erlaubt: {}", status, valid.join(", ")));
    }
    db.update_massnahme_status(id, &status).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_massnahme_cmd(db: State<Database>, id: i64) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Maßnahmen löschen".to_string());
    }
    db.delete_massnahme(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_massnahmen_uebersicht_cmd(db: State<Database>) -> Result<MassnahmenUebersicht, String> {
    db.require_login()?;
    db.get_massnahmen_uebersicht().map_err(|e| e.to_string())
}

#[tauri::command]
fn check_ueberfaellige_massnahmen_cmd(db: State<Database>) -> Result<i64, String> {
    db.require_login()?;
    db.check_ueberfaellige_massnahmen().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_kategorie_trend_cmd(db: State<Database>, lieferant_id: i64) -> Result<Vec<KategorieTrendEntry>, String> {
    db.require_login()?;
    db.get_kategorie_trend(lieferant_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_se_team_vergleich_cmd(db: State<Database>) -> Result<Vec<SeTeamVergleichEntry>, String> {
    db.require_login()?;
    db.get_se_team_vergleich().map_err(|e| e.to_string())
}

#[tauri::command]
fn check_duplicate_bewertung_cmd(
    db: State<Database>,
    lieferant_id: i64,
    se_team_id: Option<i64>,
    datum: String,
) -> Result<Option<DuplicateInfo>, String> {
    db.require_login()?;
    db.check_duplicate_bewertung(lieferant_id, se_team_id, &datum)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn speichere_bewertung_cmd(db: State<Database>, bewertung: Bewertung) -> Result<i64, String> {
    db.require_member_or_admin()?;
    // Datum validieren (YYYY-MM-DD)
    if bewertung.datum.len() != 10 || NaiveDate::parse_from_str(&bewertung.datum, "%Y-%m-%d").is_err() {
        return Err("Ungültiges Datum. Format: YYYY-MM-DD".to_string());
    }
    if bewertung.lieferant.trim().is_empty() {
        return Err("Lieferant darf nicht leer sein".to_string());
    }
    db.speichere_bewertung(&bewertung).map_err(|e| e.to_string())
}

#[tauri::command]
fn aktualisiere_bewertung_cmd(db: State<Database>, bewertung: Bewertung) -> Result<(), String> {
    db.require_login()?;
    // Admin und Controlling dürfen alle Bewertungen bearbeiten
    if db.is_current_user_admin() || db.is_current_user_controlling() {
        return db.aktualisiere_bewertung(&bewertung).map_err(|e| e.to_string());
    }
    // Member darf nur eigene Bewertungen bearbeiten (created_by == username)
    if db.is_current_user_member() {
        let bew_id = bewertung.id.ok_or("Bewertungs-ID fehlt")?;
        let username = db.get_current_username().unwrap_or_default();
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        let created_by: Option<String> = conn.query_row(
            "SELECT created_by FROM bewertungen WHERE id = ?1",
            [bew_id],
            |row| row.get(0),
        ).map_err(|e| format!("Bewertung nicht gefunden: {}", e))?;
        if created_by.as_deref() == Some(username.as_str()) {
            drop(conn);
            return db.aktualisiere_bewertung(&bewertung).map_err(|e| e.to_string());
        }
        return Err("Member können nur eigene Bewertungen bearbeiten".to_string());
    }
    Err("Keine Berechtigung für diese Aktion".to_string())
}

#[tauri::command]
fn lade_historie_cmd(
    db: State<Database>,
    lieferant_filter: Option<i64>,
    se_team_filter: Option<i64>,
) -> Result<Vec<HistorieEintrag>, String> {
    db.require_login()?;
    db.lade_historie(lieferant_filter, se_team_filter)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_historie_count_cmd(db: State<Database>) -> Result<i64, String> {
    db.require_login()?;
    let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
    conn.query_row("SELECT COUNT(*) FROM bewertungen", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn lade_bewertung_cmd(db: State<Database>, id: i64) -> Result<Option<Bewertung>, String> {
    db.require_login()?;
    db.lade_bewertung(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn loesche_bewertung_cmd(db: State<Database>, id: i64) -> Result<(), String> {
    // Sicherheitsprüfung: Nur Admins dürfen löschen
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Bewertungen löschen".to_string());
    }
    db.loesche_bewertung(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_se_teams(db: State<Database>) -> Result<Vec<SeTeamInfo>, String> {
    db.require_login()?;
    db.lade_se_teams().map_err(|e| e.to_string())
}

#[tauri::command]
fn add_se_team(db: State<Database>, name: String) -> Result<(), String> {
    db.require_member_or_admin()?;
    let name = name.trim();
    if name.is_empty() {
        return Err("Name darf nicht leer sein".to_string());
    }
    if name.len() > 200 {
        return Err("Name zu lang (max 200 Zeichen)".to_string());
    }
    db.fuege_se_team_hinzu(name).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_se_team(db: State<Database>, id: i64) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können SE-Teams löschen".to_string());
    }
    db.loesche_se_team(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn login_cmd(db: State<Database>, username: String, password: String) -> Result<Option<User>, String> {
    let user = db.login(&username, &password).map_err(|e| e.to_string())?;
    if user.is_some() {
        db.set_current_user(user.clone());
    }
    Ok(user)
}

#[tauri::command]
fn logout_cmd(db: State<Database>) -> Result<(), String> {
    let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
    {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        db.write_audit_log(&conn, &username, "LOGOUT", "session", None, "Benutzer abgemeldet", true, None).ok();
    } // conn wird hier freigegeben, bevor current_user gesperrt wird
    db.set_current_user(None);
    Ok(())
}

#[tauri::command]
fn change_password_cmd(
    db: State<Database>,
    username: String,
    old_password: String,
    new_password: String,
) -> Result<bool, String> {
    db.require_login()?;
    // Sicherheit: Username muss dem eingeloggten Benutzer entsprechen
    let current_username = db.get_current_username().unwrap_or_default();
    if username != current_username {
        return Err("Passwort kann nur für den eigenen Account geändert werden".to_string());
    }
    if new_password.len() < 8 {
        return Err("Neues Passwort muss mindestens 8 Zeichen haben".to_string());
    }
    if new_password.len() > 100 {
        return Err("Passwort zu lang (max 100 Zeichen)".to_string());
    }
    db.change_password(&username, &old_password, &new_password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_heute() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

#[tauri::command]
fn check_default_password(db: State<Database>, username: String) -> Result<bool, String> {
    db.require_login()?;
    // Nur den eigenen Account prüfen
    let current_username = db.get_current_username().unwrap_or_default();
    if username != current_username {
        return Err("Kann nur den eigenen Account prüfen".to_string());
    }
    db.is_default_password(&username).map_err(|e| e.to_string())
}

// ============================================================================
// Config File Management (für DB-Pfad)
// ============================================================================

fn get_config_path() -> PathBuf {
    if let Some(proj_dirs) = ProjectDirs::from("de", "sevalsystem", "SEVALSystem") {
        proj_dirs.config_dir().join("config.json")
    } else {
        PathBuf::from("seval_config.json")
    }
}

fn get_configured_db_path() -> Option<String> {
    let config_path = get_config_path();
    if config_path.exists()
        && let Ok(content) = std::fs::read_to_string(&config_path)
        && let Ok(config) = serde_json::from_str::<serde_json::Value>(&content)
        && let Some(db_path) = config.get("db_path").and_then(|v| v.as_str())
        && !db_path.is_empty()
    {
        return Some(db_path.to_string());
    }
    None
}

fn save_config(db_path: &str) -> Result<(), String> {
    let config_path = get_config_path();

    // Create config directory if it doesn't exist
    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create config directory: {}", e))?;
    }

    let config = serde_json::json!({
        "db_path": db_path,
        "first_launch_complete": true
    });

    let config_json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(&config_path, config_json)
        .map_err(|e| format!("Could not write config file: {}", e))?;

    Ok(())
}

#[tauri::command]
fn is_first_launch() -> bool {
    let config_path = get_config_path();
    !config_path.exists()
}

#[tauri::command]
fn get_db_path() -> String {
    Database::get_db_path().display().to_string()
}

#[tauri::command]
fn get_default_db_path() -> String {
    Database::get_default_db_path().display().to_string()
}

#[tauri::command]
fn set_db_path(path: String) -> Result<(), String> {
    // Kein Login erforderlich - wird bei der Ersteinrichtung verwendet
    save_config(&path)
}

#[tauri::command]
async fn select_db_location(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Show save file dialog for new database
    let folder_path = app.dialog()
        .file()
        .set_file_name("bewertungen.db")
        .add_filter("SQLite Datenbank", &["db"])
        .blocking_save_file();

    match folder_path {
        Some(path) => {
            let path_str = path.to_string();
            Ok(Some(path_str))
        }
        None => Ok(None)
    }
}

#[tauri::command]
async fn select_existing_db(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Show open file dialog for existing database
    let file_path = app.dialog()
        .file()
        .add_filter("SQLite Datenbank", &["db"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            Ok(Some(path_str))
        }
        None => Ok(None)
    }
}

#[tauri::command]
fn switch_database(db: State<Database>, path: String) -> Result<String, String> {
    // Bei Ersteinrichtung (niemand eingeloggt) erlauben, sonst Admin/Controlling erforderlich
    let is_logged_in = db.get_current_username().is_some();
    if is_logged_in && !(db.is_current_user_admin() || db.is_current_user_controlling()) {
        return Err("Nur Administratoren und Controlling können die Datenbank wechseln".to_string());
    }
    let username = db.get_current_username().unwrap_or_else(|| "system".to_string());
    let details = format!("Neue Datenbank: {}", path);
    match db.switch_to(&path) {
        Ok(_) => {
            {
                let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
                db.write_audit_log(&conn, &username, "SWITCH_DB", "database", None, &details, true, None).ok();
            }
            Ok(db.get_current_path())
        }
        Err(e) => {
            let error_message = e.to_string();
            {
                let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
                db.write_audit_log(&conn, &username, "SWITCH_DB", "database", None, &details, false, Some(error_message.as_str())).ok();
            }
            Err(format!("Fehler beim Wechseln der Datenbank: {}", error_message))
        }
    }
}

#[tauri::command]
fn get_current_db_path(db: State<Database>) -> Result<String, String> {
    db.require_login()?;
    Ok(db.get_current_path())
}

// ============================================================================
// Backup-Verwaltung Commands
// ============================================================================

#[tauri::command]
fn list_backups_cmd(db: State<Database>) -> Result<Vec<BackupEntry>, String> {
    db.require_admin()?;
    let db_path = db.get_current_path();
    let db_dir = std::path::Path::new(&db_path).parent().unwrap_or_else(|| std::path::Path::new("."));
    let backup_dir = db_dir.join("backups");

    if !backup_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries: Vec<BackupEntry> = Vec::new();
    let dir_entries = std::fs::read_dir(&backup_dir)
        .map_err(|e| format!("Backup-Verzeichnis konnte nicht gelesen werden: {}", e))?;

    for entry in dir_entries.flatten() {
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|ext| ext == "bak")
            && let Ok(metadata) = std::fs::metadata(&path) {
                let filename = path.file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();
                let size = metadata.len();
                let created = metadata.modified()
                    .map(|t| {
                        let dt: chrono::DateTime<chrono::Local> = t.into();
                        dt.format("%Y-%m-%d %H:%M").to_string()
                    })
                    .unwrap_or_else(|_| "Unbekannt".to_string());
                entries.push(BackupEntry {
                    filename,
                    size_bytes: size,
                    created_at: created,
                });
            }
    }

    // Neueste zuerst
    entries.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(entries)
}

#[tauri::command]
fn create_backup_cmd(db: State<Database>) -> Result<String, String> {
    db.require_admin()?;
    let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
    let db_path = db.get_current_path();

    // Manuelles Backup immer mit Zeitstempel erstellen (unabhängig vom täglichen Auto-Backup)
    let db_file = std::path::Path::new(&db_path);
    let db_dir = db_file.parent().unwrap_or_else(|| std::path::Path::new("."));
    let backup_dir = db_dir.join("backups");
    std::fs::create_dir_all(&backup_dir)
        .map_err(|e| format!("Backup-Verzeichnis konnte nicht erstellt werden: {}", e))?;

    let now = chrono::Local::now();
    let result_filename = format!("bewertungen_{}_{}.db.bak", now.format("%Y-%m-%d"), now.format("%H%M%S"));
    let backup_path = backup_dir.join(&result_filename);
    std::fs::copy(db_file, &backup_path)
        .map_err(|e| format!("Manuelles Backup fehlgeschlagen: {}", e))?;

    let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
    let details = format!("Backup erstellt: {}", result_filename);
    db.write_audit_log(&conn, &username, "CREATE", "backup", None, &details, true, None).ok();

    Ok(result_filename)
}

#[tauri::command]
fn restore_backup_cmd(db: State<Database>, filename: String) -> Result<(), String> {
    db.require_admin()?;
    let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());

    // Sicherheitsprüfung: Dateiname darf keine Pfad-Traversal enthalten
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Ungültiger Dateiname".to_string());
    }

    let db_path = db.get_current_path();
    let db_dir = std::path::Path::new(&db_path).parent().unwrap_or_else(|| std::path::Path::new("."));
    let backup_dir = db_dir.join("backups");
    let backup_path = backup_dir.join(&filename);

    if !backup_path.exists() {
        return Err("Backup-Datei nicht gefunden".to_string());
    }

    // Audit-Log VOR dem Restore schreiben (danach ist die DB überschrieben)
    {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        let details = format!("Backup wiederhergestellt: {}", filename);
        db.write_audit_log(&conn, &username, "UPDATE", "backup", None, &details, true, None).ok();
    }

    // Vor dem Restore ein Sicherheitsbackup erstellen
    let now = chrono::Local::now();
    let safety_filename = format!("bewertungen_pre_restore_{}.db.bak", now.format("%Y%m%d_%H%M%S"));
    let safety_path = backup_dir.join(&safety_filename);
    std::fs::copy(&db_path, &safety_path)
        .map_err(|e| format!("Sicherheitsbackup konnte nicht erstellt werden: {}", e))?;

    // Alte DB-Verbindung schließen, Backup kopieren, neu öffnen — atomar im selben Lock
    {
        let mut conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        // WAL-Checkpoint und alte Connection schließen (durch Ersetzen mit In-Memory DB)
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").ok();
        // Alte Connection durch temporäre In-Memory DB ersetzen, damit Datei-Lock freigegeben wird
        let temp_conn = Connection::open_in_memory()
            .map_err(|e| format!("Temporäre Verbindung fehlgeschlagen: {}", e))?;
        *conn = temp_conn;

        // Jetzt ist die DB-Datei nicht mehr gesperrt — sicher überschreiben
        std::fs::copy(&backup_path, &db_path)
            .map_err(|e| format!("Wiederherstellung fehlgeschlagen: {}", e))?;

        // Neue Verbindung zur wiederhergestellten DB öffnen
        let new_conn = Connection::open(&db_path)
            .map_err(|e| format!("Datenbank konnte nach Wiederherstellung nicht geöffnet werden: {}", e))?;

        // Migrationen auf die wiederhergestellte DB anwenden
        new_conn.execute_batch("BEGIN TRANSACTION")
            .map_err(|e| format!("Migration-Transaktion fehlgeschlagen: {}", e))?;

        match db.init_tables_inner(&new_conn) {
            Ok(()) => {
                new_conn.execute_batch("COMMIT")
                    .map_err(|e| format!("Migration-Commit fehlgeschlagen: {}", e))?;
            }
            Err(e) => {
                new_conn.execute_batch("ROLLBACK").ok();
                return Err(format!("Migrationen nach Wiederherstellung fehlgeschlagen: {}", e));
            }
        }

        *conn = new_conn;
    }

    Ok(())
}

#[tauri::command]
fn delete_backup_cmd(db: State<Database>, filename: String) -> Result<(), String> {
    db.require_admin()?;
    let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());

    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Ungültiger Dateiname".to_string());
    }

    let db_path = db.get_current_path();
    let db_dir = std::path::Path::new(&db_path).parent().unwrap_or_else(|| std::path::Path::new("."));
    let backup_path = db_dir.join("backups").join(&filename);

    if !backup_path.exists() {
        return Err("Backup-Datei nicht gefunden".to_string());
    }

    std::fs::remove_file(&backup_path)
        .map_err(|e| format!("Backup konnte nicht gelöscht werden: {}", e))?;

    let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
    let details = format!("Backup gelöscht: {}", filename);
    db.write_audit_log(&conn, &username, "DELETE", "backup", None, &details, true, None).ok();

    Ok(())
}

#[tauri::command]
fn get_app_info_cmd(db: State<Database>) -> Result<AppInfo, String> {
    db.require_login()?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let bewertungen_count: i32 = conn.query_row("SELECT COUNT(*) FROM bewertungen", [], |r| r.get(0))
        .unwrap_or(0);
    let lieferanten_count: i32 = conn.query_row("SELECT COUNT(*) FROM lieferanten", [], |r| r.get(0))
        .unwrap_or(0);
    let fragen_count: i32 = conn.query_row("SELECT COUNT(*) FROM fragen", [], |r| r.get(0))
        .unwrap_or(0);
    let users_count: i32 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap_or(0);

    let db_path = db.get_current_path();
    let db_size = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);

    let os_info = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        db_path,
        db_size_bytes: db_size,
        bewertungen_count,
        lieferanten_count,
        fragen_count,
        users_count,
        os_info,
    })
}

// ============================================================================
// Phase 6: Ziele & Sollwerte Commands
// ============================================================================

#[tauri::command]
fn get_ziele_cmd(db: State<Database>, lieferant_id: Option<i64>, quartal: Option<String>) -> Result<Vec<Ziel>, String> {
    db.require_login()?;
    db.lade_ziele(lieferant_id, quartal.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_ziel_fuer_lieferant_cmd(db: State<Database>, lieferant_id: i64, quartal: String) -> Result<Option<Ziel>, String> {
    db.require_login()?;
    db.get_ziel_fuer_lieferant(lieferant_id, &quartal).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_ziel_cmd(db: State<Database>, ziel: NeuesZiel) -> Result<i64, String> {
    db.require_admin()?;

    // Validierung
    if ziel.zielwert < 0.0 || ziel.zielwert > 100.0 {
        return Err("Zielwert muss zwischen 0 und 100 liegen".to_string());
    }
    if ziel.lieferant.trim().is_empty() {
        return Err("Lieferant darf nicht leer sein".to_string());
    }
    if ziel.quartal.trim().is_empty() {
        return Err("Quartal darf nicht leer sein".to_string());
    }
    // Quartal-Format prüfen: "Q1 2026" oder ähnlich
    let q = ziel.quartal.trim();
    let has_q = q.contains('Q') || q.contains('q');
    if !has_q {
        return Err("Quartal muss im Format 'Q1 2026' angegeben werden".to_string());
    }

    db.erstelle_ziel(&ziel).map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            "Für diesen Lieferanten existiert bereits ein Ziel in diesem Quartal".to_string()
        } else {
            e.to_string()
        }
    })
}

#[tauri::command]
fn update_ziel_cmd(db: State<Database>, id: i64, zielwert: f32, beschreibung: Option<String>) -> Result<(), String> {
    db.require_admin()?;

    if !(0.0..=100.0).contains(&zielwert) {
        return Err("Zielwert muss zwischen 0 und 100 liegen".to_string());
    }

    db.aktualisiere_ziel(id, zielwert, beschreibung.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_ziel_cmd(db: State<Database>, id: i64) -> Result<(), String> {
    db.require_admin()?;
    db.loesche_ziel(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_ziele_summary_cmd(db: State<Database>, quartal: Option<String>) -> Result<ZieleSummary, String> {
    db.require_login()?;
    db.lade_ziele_summary(quartal.as_deref()).map_err(|e| e.to_string())
}

// ============================================================================
// Cross-DB Vergleich Commands
// ============================================================================

#[tauri::command]
fn validate_external_db(db: State<Database>, path: String) -> Result<CrossDbSource, String> {
    db.require_login()?;
    let path_buf = PathBuf::from(&path);

    // Sicherheitsprüfung: Nur erlaubte Erweiterungen
    if let Some(ext) = path_buf.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        if ext_str != "db" && ext_str != "sqlite" && ext_str != "sqlite3" {
            return Err("Nur .db, .sqlite oder .sqlite3 Dateien sind erlaubt".into());
        }
    } else {
        return Err("Datei muss eine gültige Erweiterung haben".into());
    }

    // Prüfung: Externe DB darf nicht die aktuell geöffnete DB sein
    if !path_buf.exists() {
        return Err("Datei existiert nicht".into());
    }
    // canonicalize() liefert einen absoluten Pfad mit bereits aufgelösten ".."-Segmenten,
    // daher wäre ein anschließender contains("..")-Check wirkungslos. Die echten Schutzmaßnahmen
    // sind die Endungs-Whitelist, exists(), das Read-only-Öffnen und der Selbe-DB-Vergleich unten.
    let canonical = path_buf.canonicalize().map_err(|e| format!("Pfad konnte nicht aufgelöst werden: {}", e))?;

    let current_path = PathBuf::from(db.get_current_path());
    if let Ok(current_canonical) = current_path.canonicalize()
        && canonical == current_canonical {
            return Err("Die aktuell geöffnete Datenbank kann nicht als Vergleichs-DB hinzugefügt werden".into());
        }

    // Read-only öffnen
    let conn = Connection::open_with_flags(
        &canonical,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ).map_err(|e| format!("Kann Datenbank nicht öffnen: {}", e))?;

    // SE-Team-Label aus der DB lesen, Fallback auf Dateiname
    let label = conn.query_row(
        "SELECT name FROM se_teams LIMIT 1",
        [],
        |row| row.get::<_, String>(0),
    ).unwrap_or_else(|_| {
        path_buf.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Unbekannt".to_string())
    });

    // Lieferantenliste aus der DB lesen
    let mut stmt = conn.prepare(
        "SELECT DISTINCT lieferant FROM bewertungen ORDER BY lieferant"
    ).map_err(|e| format!("Fehler beim Lesen der Lieferanten: {}", e))?;

    let lieferanten: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| format!("Fehler: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Fehler: {}", e))?;

    Ok(CrossDbSource { path, label, lieferanten })
}

#[tauri::command]
fn load_cross_db_historie(
    db: State<Database>,
    external_paths: Vec<String>,
    lieferant_filter: Option<String>,
) -> Result<CrossDbCompareResult, String> {
    // Berechtigungsprüfung: Nur Admins
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können den datenbankübergreifenden Vergleich nutzen".into());
    }

    let mut all_entries: Vec<CrossDbHistorieEintrag> = Vec::new();
    let mut sources: Vec<CrossDbSource> = Vec::new();

    // 1. Daten aus aktueller DB laden
    let current_path = db.get_current_path();
    let current_label = {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row("SELECT name FROM se_teams LIMIT 1", [], |row| row.get::<_, String>(0))
            .unwrap_or_else(|_| "Aktuelle DB".to_string())
    };

    // Cross-DB: lieferant_filter ist ein Name (String), muss in ID aufgelöst werden für aktuelle DB
    let lieferant_id_filter: Option<i64> = if let Some(ref name) = lieferant_filter {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        conn.query_row(
            "SELECT id FROM lieferanten WHERE name = ?1", [name.as_str()], |row| row.get(0)
        ).ok()
    } else {
        None
    };

    let current_historie = db.lade_historie(
        lieferant_id_filter, None
    ).map_err(|e| e.to_string())?;

    let current_lieferanten: Vec<String> = {
        let mut set = std::collections::HashSet::new();
        current_historie.iter().for_each(|h| { set.insert(h.lieferant.clone()); });
        let mut v: Vec<String> = set.into_iter().collect();
        v.sort();
        v
    };

    sources.push(CrossDbSource {
        path: current_path.clone(),
        label: current_label.clone(),
        lieferanten: current_lieferanten,
    });

    for entry in current_historie {
        all_entries.push(CrossDbHistorieEintrag {
            id: entry.id,
            lieferant: entry.lieferant,
            se_team: entry.se_team,
            datum: entry.datum,
            ergebnis: entry.ergebnis,
            bestellnummer: entry.bestellnummer,
            has_open_massnahmen: entry.has_open_massnahmen,
            is_resolution: entry.is_resolution,
            db_label: current_label.clone(),
        });
    }

    // 2. Daten aus externen DBs laden (read-only)
    for ext_path in &external_paths {
        let path_buf = PathBuf::from(ext_path);
        if !path_buf.exists() {
            continue;
        }
        let canonical = match path_buf.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let ext_conn = match Connection::open_with_flags(
            &canonical,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let label = ext_conn.query_row(
            "SELECT name FROM se_teams LIMIT 1", [], |row| row.get::<_, String>(0)
        ).unwrap_or_else(|_| {
            path_buf.file_stem().map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unbekannt".to_string())
        });

        let query = match &lieferant_filter {
            Some(_) => "SELECT id, lieferant, COALESCE(se_team,'') as se_team, datum, ergebnis, \
                         COALESCE(bestellnummer,'') as bestellnummer, \
                         (massnahmen IS NOT NULL AND massnahmen != '' AND massnahmen NOT LIKE '%[VQ-Maßnahmen umgesetzt]%') as has_new_massnahmen, \
                         (massnahmen LIKE '%[VQ-Maßnahmen umgesetzt]%') as is_resolution \
                         FROM bewertungen WHERE lieferant = ?1 ORDER BY datum DESC",
            None => "SELECT id, lieferant, COALESCE(se_team,'') as se_team, datum, ergebnis, \
                     COALESCE(bestellnummer,'') as bestellnummer, \
                     (massnahmen IS NOT NULL AND massnahmen != '' AND massnahmen NOT LIKE '%[VQ-Maßnahmen umgesetzt]%') as has_new_massnahmen, \
                     (massnahmen LIKE '%[VQ-Maßnahmen umgesetzt]%') as is_resolution \
                     FROM bewertungen ORDER BY datum DESC",
        };

        let ext_entries: Vec<CrossDbHistorieEintrag> = match &lieferant_filter {
            Some(filter) => {
                let mut stmt = match ext_conn.prepare(query) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                stmt.query_map(rusqlite::params![filter], |row| {
                    Ok(CrossDbHistorieEintrag {
                        id: row.get(0)?,
                        lieferant: row.get(1)?,
                        se_team: row.get(2)?,
                        datum: row.get(3)?,
                        ergebnis: row.get(4)?,
                        bestellnummer: row.get(5)?,
                        has_open_massnahmen: row.get::<_, i32>(6)? != 0,
                        is_resolution: row.get::<_, i32>(7)? != 0,
                        db_label: label.clone(),
                    })
                }).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            },
            None => {
                let mut stmt = match ext_conn.prepare(query) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                stmt.query_map([], |row| {
                    Ok(CrossDbHistorieEintrag {
                        id: row.get(0)?,
                        lieferant: row.get(1)?,
                        se_team: row.get(2)?,
                        datum: row.get(3)?,
                        ergebnis: row.get(4)?,
                        bestellnummer: row.get(5)?,
                        has_open_massnahmen: row.get::<_, i32>(6)? != 0,
                        is_resolution: row.get::<_, i32>(7)? != 0,
                        db_label: label.clone(),
                    })
                }).map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            },
        };

        // Lieferantenliste für diese externe DB
        let ext_lieferanten: Vec<String> = {
            let mut stmt = match ext_conn.prepare("SELECT DISTINCT lieferant FROM bewertungen ORDER BY lieferant") {
                Ok(s) => s,
                Err(_) => continue,
            };
            match stmt.query_map([], |row| row.get(0)) {
                Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
                Err(_) => continue,
            }
        };

        sources.push(CrossDbSource {
            path: ext_path.clone(),
            label: label.clone(),
            lieferanten: ext_lieferanten,
        });

        all_entries.extend(ext_entries);
    }

    // Audit-Log schreiben
    let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
    let db_names: Vec<String> = sources.iter().map(|s| s.label.clone()).collect();
    let details = format!(
        "Cross-DB Vergleich: Lieferant='{}', Datenbanken=[{}], Ergebnisse={}",
        lieferant_filter.as_deref().unwrap_or("alle"),
        db_names.join(", "),
        all_entries.len()
    );
    {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        db.write_audit_log(&conn, &username, "CROSS_DB_COMPARE", "comparison", None, &details, true, None).ok();
    }

    Ok(CrossDbCompareResult { sources, entries: all_entries })
}

/// Berechnet per-Kategorie-Scores für einen Lieferanten über alle DBs hinweg
fn compute_category_scores_from_db(conn: &Connection, lieferant: &str) -> Option<CrossDbCategoryEntry> {
    // Letzte Bewertung für den Lieferanten laden
    let (antworten_json, datum, ergebnis): (String, String, f32) = conn.query_row(
        "SELECT antworten, datum, ergebnis FROM bewertungen WHERE lieferant = ?1 ORDER BY datum DESC LIMIT 1",
        [lieferant],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    ).ok()?;

    // Fragen laden (mit Fallback für fehlende gewichtung-Spalte)
    let fragen: Vec<(i64, String, i32)> = {
        let mut stmt = conn.prepare(
            "SELECT id, gruppe, COALESCE(gewichtung, 1) FROM fragen ORDER BY sort_index"
        ).ok()?;
        stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i32>(2)?))
        }).ok()?
        .filter_map(|r| r.ok())
        .collect()
    };

    // Antworten parsen
    let antworten: serde_json::Value = serde_json::from_str(&antworten_json).ok()?;

    // Per-Kategorie-Scores berechnen
    let mut gruppen: std::collections::HashMap<String, (f64, f64, usize)> = std::collections::HashMap::new();

    if let Some(obj) = antworten.as_object() {
        // Object-Format: { "frage_id": answer_value }
        for (frage_id, gruppe, gewichtung) in &fragen {
            let key = frage_id.to_string();
            if let Some(answer_val) = obj.get(&key) {
                let answer = answer_val.as_i64().unwrap_or(-1);
                if answer < 0 { continue; }
                let base_points = match answer { 2 => 100.0, 1 => 50.0, 0 => 0.0, _ => continue };
                let entry = gruppen.entry(gruppe.clone()).or_insert((0.0, 0.0, 0));
                entry.0 += base_points * *gewichtung as f64;
                entry.1 += 100.0 * *gewichtung as f64;
                entry.2 += 1;
            }
        }
    } else if let Some(arr) = antworten.as_array() {
        // Fallback: Array-Format (Index = sort_index)
        for (idx, (_, gruppe, gewichtung)) in fragen.iter().enumerate() {
            if let Some(answer_val) = arr.get(idx) {
                let answer = answer_val.as_i64().unwrap_or(-1);
                if answer < 0 { continue; }
                let base_points = match answer { 2 => 100.0, 1 => 50.0, 0 => 0.0, _ => continue };
                let entry = gruppen.entry(gruppe.clone()).or_insert((0.0, 0.0, 0));
                entry.0 += base_points * *gewichtung as f64;
                entry.1 += 100.0 * *gewichtung as f64;
                entry.2 += 1;
            }
        }
    }

    let mut categories: Vec<CrossDbCategoryScore> = gruppen.into_iter()
        .map(|(gruppe, (achieved, max, count))| {
            let score = if max > 0.0 { (achieved / max * 100.0) as f32 } else { 0.0 };
            CrossDbCategoryScore { gruppe, score, fragen_count: count }
        })
        .collect();

    // Sortieren nach der Reihenfolge der Gruppen in fragen-Tabelle
    let gruppe_order: Vec<String> = {
        let mut seen = Vec::new();
        for (_, gruppe, _) in &fragen {
            if !seen.contains(gruppe) {
                seen.push(gruppe.clone());
            }
        }
        seen
    };
    categories.sort_by_key(|c| {
        gruppe_order.iter().position(|g| g == &c.gruppe).unwrap_or(999)
    });

    // DB-Label ermitteln
    let label = conn.query_row("SELECT name FROM se_teams LIMIT 1", [], |row| row.get::<_, String>(0))
        .unwrap_or_else(|_| "Unbekannt".to_string());

    Some(CrossDbCategoryEntry {
        db_label: label,
        datum,
        ergebnis,
        categories,
    })
}

#[tauri::command]
fn load_cross_db_category_scores(
    db: State<Database>,
    external_paths: Vec<String>,
    lieferant: String,
) -> Result<CrossDbCategoryResult, String> {
    db.require_login()?;
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können den Kategorien-Vergleich nutzen".into());
    }

    let mut entries: Vec<CrossDbCategoryEntry> = Vec::new();

    // 1. Aktuelle DB
    {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = compute_category_scores_from_db(&conn, &lieferant) {
            entries.push(entry);
        }
    }

    // 2. Externe DBs
    for ext_path in &external_paths {
        let path_buf = PathBuf::from(ext_path);
        if !path_buf.exists() { continue; }
        let canonical = match path_buf.canonicalize() {
            Ok(p) => p,
            Err(_) => continue,
        };

        let ext_conn = match Connection::open_with_flags(
            &canonical,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if let Some(mut entry) = compute_category_scores_from_db(&ext_conn, &lieferant) {
            // Label aus DB oder Dateiname
            let label = ext_conn.query_row("SELECT name FROM se_teams LIMIT 1", [], |row| row.get::<_, String>(0))
                .unwrap_or_else(|_| {
                    canonical.file_stem().map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Unbekannt".to_string())
                });
            entry.db_label = label;
            entries.push(entry);
        }
    }

    Ok(CrossDbCategoryResult { entries })
}

#[tauri::command]
fn factory_reset(db: State<Database>) -> Result<(), String> {
    if !db.is_current_user_admin() {
        let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        db.write_audit_log(&conn, &username, "FACTORY_RESET_DENIED", "system", None, "Factory Reset verweigert - kein Admin", false, Some("Not an admin")).ok();
        return Err("Nur Administratoren können einen Factory Reset durchführen".to_string());
    }

    let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
    let db_path = db.get_current_path();

    // Beide Audit-Log-Einträge VOR dem Schließen der Verbindung schreiben
    {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        db.write_audit_log(&conn, &username, "FACTORY_RESET", "system", None, &format!("Factory Reset durchgeführt: {}", db_path), true, None).ok();
    }

    use std::fs;

    let config_path = get_config_path();

    if config_path.exists() {
        fs::remove_file(&config_path)
            .map_err(|e| format!("Fehler beim Löschen der Konfiguration: {}", e))?;
    }

    // Verbindung schließen und erst dann Datei löschen
    db.close_connection()
        .map_err(|e| format!("Fehler beim Schließen der Datenbank: {}", e))?;

    if !db_path.is_empty() {
        let db_path_buf = PathBuf::from(&db_path);
        if db_path_buf.exists() {
            fs::remove_file(&db_path_buf)
                .map_err(|e| format!("Fehler beim Löschen der Datenbank: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
fn save_pdf_file(db: State<Database>, path: String, base64_data: String) -> Result<(), String> {
    db.require_login()?;
    use std::fs::File;
    use std::io::Write;
    use base64::{Engine as _, engine::general_purpose};

    // Größenlimit: 50 MB Base64 ≈ ~37 MB Datei
    const MAX_BASE64_SIZE: usize = 50 * 1024 * 1024;
    if base64_data.len() > MAX_BASE64_SIZE {
        return Err(format!("Datei zu groß (max. {} MB)", MAX_BASE64_SIZE / 1024 / 1024));
    }

    // Pfad-Validierung
    if path.contains("..") {
        return Err("Ungültiger Dateipfad".to_string());
    }
    let path_buf = PathBuf::from(&path);
    match path_buf.extension().and_then(|e| e.to_str()) {
        Some("pdf") => {}
        _ => return Err("Nur PDF-Dateien erlaubt".to_string()),
    }

    let bytes = general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;

    let mut file = File::create(&path)
        .map_err(|e| format!("Could not create file: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("Could not write file: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn save_pdf_with_dialog(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    default_filename: String,
    base64_data: String
) -> Result<Option<String>, String> {
    if !(db.is_current_user_admin() || db.is_current_user_member() || db.is_current_user_controlling()) {
        return Err("Nur angemeldete Benutzer dürfen PDF-Exporte durchführen".to_string());
    }
    use std::fs::File;
    use std::io::Write;
    use base64::{Engine as _, engine::general_purpose};
    use tauri_plugin_dialog::DialogExt;

    const MAX_BASE64_SIZE: usize = 50 * 1024 * 1024;
    if base64_data.len() > MAX_BASE64_SIZE {
        return Err(format!("Datei zu groß (max. {} MB)", MAX_BASE64_SIZE / 1024 / 1024));
    }

    let file_path = app.dialog()
        .file()
        .set_file_name(&default_filename)
        .add_filter("PDF", &["pdf"])
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            // Audit-Log in eigenem Scope, damit Lock vor File-I/O freigegeben wird
            {
                let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
                let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
                let details = format!("PDF exportiert: {}", path_str);
                db.write_audit_log(&conn, &username, "EXPORT_PDF", "export", None, &details, true, None).ok();
            }

            let bytes = general_purpose::STANDARD
                .decode(&base64_data)
                .map_err(|e| format!("Base64 decode error: {}", e))?;

            let mut file = File::create(&path_str)
                .map_err(|e| format!("Could not create file: {}", e))?;

            file.write_all(&bytes)
                .map_err(|e| format!("Could not write file: {}", e))?;

            Ok(Some(path_str))
        }
        None => Ok(None)
    }
}

// ============================================================================
// Phase 4: Import Commands
// ============================================================================

#[tauri::command]
async fn open_csv_with_dialog(
    app: tauri::AppHandle,
    db: State<'_, Database>,
) -> Result<Option<String>, String> {
    db.require_login()?;
    use tauri_plugin_dialog::DialogExt;

    let file_path = app.dialog()
        .file()
        .add_filter("CSV Dateien", &["csv", "txt"])
        .blocking_pick_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            let content = std::fs::read_to_string(&path_str)
                .map_err(|e| format!("Datei lesen fehlgeschlagen: {}", e))?;
            Ok(Some(content))
        }
        None => Ok(None)
    }
}

#[tauri::command]
fn import_bewertungen_cmd(
    db: State<Database>,
    bewertungen: Vec<ImportBewertung>,
    skip_duplicates: bool,
) -> Result<ImportResult, String> {
    db.require_member_or_admin()?;
    db.import_bewertungen(&bewertungen, skip_duplicates).map_err(|e| e.to_string())
}

// ============================================================================
// Phase 4.3: XLSX Export
// ============================================================================

#[tauri::command]
async fn export_xlsx_with_dialog(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    default_filename: String,
) -> Result<Option<String>, String> {
    db.require_login()?;

    use rust_xlsxwriter::*;
    use tauri_plugin_dialog::DialogExt;

    // Load data while lock is held
    let (bewertungen, threshold_success, threshold_warning) = {
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());

        let threshold_success: f32 = conn.query_row(
            "SELECT value FROM settings WHERE key = 'threshold_success'", [],
            |row| { let v: String = row.get(0)?; Ok(v.parse().unwrap_or(75.0)) }
        ).unwrap_or(75.0);
        let threshold_warning: f32 = conn.query_row(
            "SELECT value FROM settings WHERE key = 'threshold_warning'", [],
            |row| { let v: String = row.get(0)?; Ok(v.parse().unwrap_or(50.0)) }
        ).unwrap_or(50.0);

        let mut stmt = conn.prepare(
            "SELECT id, lieferant, COALESCE(se_team, '') as se_team, datum, ergebnis,
             COALESCE(bestellnummer, '') as bestellnummer,
             COALESCE(massnahmen, '') as massnahmen
             FROM bewertungen ORDER BY datum DESC, id DESC"
        ).map_err(|e| e.to_string())?;

        let rows: Vec<(i64, String, String, String, f32, String, String)> = stmt
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        (rows, threshold_success, threshold_warning)
    };

    // File dialog
    let file_path = app.dialog()
        .file()
        .set_file_name(&default_filename)
        .add_filter("Excel Datei", &["xlsx"])
        .blocking_save_file();

    let path = match file_path {
        Some(p) => p.to_string(),
        None => return Ok(None),
    };

    // Create workbook
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("Bewertungen").map_err(|e| e.to_string())?;

    // Formats
    let header_fmt = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0x1e293b))
        .set_font_color(Color::White)
        .set_font_size(11.0)
        .set_border(FormatBorder::Thin);
    let normal_fmt = Format::new()
        .set_font_size(10.0)
        .set_border(FormatBorder::Thin);
    let green_fmt = Format::new()
        .set_font_size(10.0)
        .set_bold()
        .set_font_color(Color::RGB(0x166534))
        .set_background_color(Color::RGB(0xdcfce7))
        .set_border(FormatBorder::Thin);
    let yellow_fmt = Format::new()
        .set_font_size(10.0)
        .set_bold()
        .set_font_color(Color::RGB(0x92400e))
        .set_background_color(Color::RGB(0xfef3c7))
        .set_border(FormatBorder::Thin);
    let red_fmt = Format::new()
        .set_font_size(10.0)
        .set_bold()
        .set_font_color(Color::RGB(0x991b1b))
        .set_background_color(Color::RGB(0xfee2e2))
        .set_border(FormatBorder::Thin);

    // Column widths
    sheet.set_column_width(0, 12).map_err(|e| e.to_string())?;  // ID
    sheet.set_column_width(1, 28).map_err(|e| e.to_string())?;  // Lieferant
    sheet.set_column_width(2, 20).map_err(|e| e.to_string())?;  // SE-Team
    sheet.set_column_width(3, 14).map_err(|e| e.to_string())?;  // Datum
    sheet.set_column_width(4, 14).map_err(|e| e.to_string())?;  // Ergebnis
    sheet.set_column_width(5, 20).map_err(|e| e.to_string())?;  // Bestellnummer
    sheet.set_column_width(6, 40).map_err(|e| e.to_string())?;  // Maßnahmen

    // Headers
    let headers = ["SEVALSystem-ID", "Lieferant", "SE-Team", "Datum", "Ergebnis (%)", "Bestellnummer", "Maßnahmen"];
    for (col, h) in headers.iter().enumerate() {
        sheet.write_with_format(0, col as u16, *h, &header_fmt).map_err(|e| e.to_string())?;
    }

    // Data rows
    for (row_idx, (id, lieferant, se_team, datum, ergebnis, bestellnummer, massnahmen)) in bewertungen.iter().enumerate() {
        let row = (row_idx + 1) as u32;

        sheet.write_with_format(row, 0, format!("SEVALSystem-{}", id), &normal_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(row, 1, lieferant.as_str(), &normal_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(row, 2, se_team.as_str(), &normal_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(row, 3, datum.as_str(), &normal_fmt).map_err(|e| e.to_string())?;

        // Color-coded result cell
        let result_fmt = if *ergebnis >= threshold_success {
            &green_fmt
        } else if *ergebnis >= threshold_warning {
            &yellow_fmt
        } else {
            &red_fmt
        };
        sheet.write_number_with_format(row, 4, *ergebnis as f64, result_fmt).map_err(|e| e.to_string())?;
        sheet.write_with_format(row, 5, bestellnummer.as_str(), &normal_fmt).map_err(|e| e.to_string())?;

        let massnahmen_clean = massnahmen.replace("[VQ-Maßnahmen umgesetzt]", "").trim().to_string();
        sheet.write_with_format(row, 6, massnahmen_clean.as_str(), &normal_fmt).map_err(|e| e.to_string())?;
    }

    // Auto-filter
    sheet.autofilter(0, 0, bewertungen.len() as u32, 6).map_err(|e| e.to_string())?;

    // Save
    workbook.save(&path).map_err(|e| format!("XLSX speichern fehlgeschlagen: {}", e))?;

    // Audit log
    {
        let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        let details = format!("XLSX exportiert: {} ({} Zeilen)", path, bewertungen.len());
        db.write_audit_log(&conn, &username, "EXPORT_XLSX", "export", None, &details, true, None).ok();
    }

    Ok(Some(path))
}

// ============================================================================
// User-Management Commands
// ============================================================================

#[tauri::command]
fn get_users(db: State<Database>) -> Result<Vec<UserForList>, String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Benutzerlisten einsehen".to_string());
    }
    db.lade_users().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_user(db: State<Database>, username: String, password: String, role: String) -> Result<i64, String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Benutzer anlegen".to_string());
    }
    let new_user = NewUser { username, password, role };
    db.erstelle_user(&new_user).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_user(db: State<Database>, id: i64, role: String, active: bool) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Benutzer bearbeiten".to_string());
    }
    db.aktualisiere_user(id, &role, active).map_err(|e| e.to_string())
}

#[tauri::command]
fn reset_user_password(db: State<Database>, id: i64, new_password: String) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Passwörter zurücksetzen".to_string());
    }
    db.setze_user_passwort(id, &new_password).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_user(db: State<Database>, id: i64) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Benutzer löschen".to_string());
    }
    db.loesche_user(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_audit_log(db: State<Database>, limit: i32) -> Result<Vec<AuditLogEntry>, String> {
    if !(db.is_current_user_admin() || db.is_current_user_member() || db.is_current_user_controlling()) {
        return Err("Keine Berechtigung für Audit-Log".to_string());
    }
    // Limit begrenzen um OOM zu verhindern
    let limit = limit.clamp(1, 10000);
    let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
    let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());

    let details = format!("Audit-Log abgefragt (Limit: {})", limit);
    let _ = db.write_audit_log(&conn, &username, "VIEW", "audit_log", None, &details, true, None);

    drop(conn);

    let all_entries = db.lade_audit_log(limit).map_err(|e| {
        format!("Fehler beim Laden des Audit-Logs: {}", e)
    })?;

    if (db.is_current_user_member() || db.is_current_user_controlling()) && !db.is_current_user_admin() {
        let username = db.get_current_username().unwrap_or_default();
        let filtered: Vec<_> = all_entries
            .into_iter()
            .filter(|entry| entry.username == username)
            .collect();
        return Ok(filtered);
    }

    Ok(all_entries)
}

#[tauri::command]
fn get_current_user(db: State<Database>) -> Result<Option<User>, String> {
    let current = db.current_user.lock().unwrap_or_else(|e| e.into_inner());
    Ok(current.clone())
}

// ============================================================================
// Unit Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // Nachbau der Berechnungslogik aus dem Frontend für Verifikationszwecke
    // 2 = Erfüllt (100%), 1 = Teilweise (50%), 0 = Nicht Erfüllt (0%), -1 = Unbeantwortet (ignoriert)
    fn berechne_score_test(antworten: Vec<i32>) -> f32 {
        let mut total_score = 0.0;
        let mut total_max = 0.0;

        for antwort in antworten {
            match antwort {
                2 => { // Erfüllt
                    total_score += 100.0;
                    total_max += 100.0;
                }
                1 => { // Teilweise
                    total_score += 50.0;
                    total_max += 100.0;
                }
                0 => { // Nicht erfüllt
                    total_score += 0.0;
                    total_max += 100.0;
                }
                _ => {} // Unbeantwortet (-1) wird ignoriert
            }
        }

        if total_max == 0.0 {
            0.0
        } else {
            (total_score / total_max) * 100.0
        }
    }

    #[test]
    fn test_quartals_berechnung_basis() {
        // Teste Q1
        let (start, end, name) = Database::get_current_quarter("2024-02-15");
        assert_eq!(start, "2024-01-01");
        assert_eq!(end, "2024-03-31");
        assert_eq!(name, "Q1 2024");

        // Teste Q4
        let (start, end, name) = Database::get_current_quarter("2024-12-01");
        assert_eq!(start, "2024-10-01");
        assert_eq!(end, "2024-12-31");
        assert_eq!(name, "Q4 2024");
    }

    #[test]
    fn test_vorquartal_jahreswechsel() {
        // Januar 2024 -> Vorquartal sollte Q4 2023 sein
        let result = Database::get_previous_quarter("2024-01-15");
        assert!(result.is_some());
        let (start, end) = result.unwrap();
        assert_eq!(start, "2023-10-01");
        assert_eq!(end, "2023-12-31");
    }

    #[test]
    fn test_score_berechnung_perfekt() {
        // Alles erfüllt
        let antworten = vec![2, 2, 2, 2];
        assert_eq!(berechne_score_test(antworten), 100.0);
    }

    #[test]
    fn test_score_berechnung_gemischt() {
        // 1x Erfüllt (100), 1x Teilweise (50), 2x Nicht (0)
        // Score: 150 / 400 = 37.5%
        let antworten = vec![2, 1, 0, 0];
        assert_eq!(berechne_score_test(antworten), 37.5);
    }

    #[test]
    fn test_score_berechnung_mit_unbeantwortet() {
        // 1x Erfüllt (100), 1x Unbeantwortet (ignoriert)
        // Score: 100 / 100 = 100%
        let antworten = vec![2, -1];
        assert_eq!(berechne_score_test(antworten), 100.0);
    }

    #[test]
    fn test_score_berechnung_alles_leer() {
        let antworten = vec![-1, -1];
        assert_eq!(berechne_score_test(antworten), 0.0);
    }

    /// Baut eine vollständig initialisierte In-Memory-DB für Integrationstests.
    fn make_test_db() -> Database {
        let conn = Connection::open_in_memory().expect("in-memory DB");
        let db = Database {
            conn: Mutex::new(conn),
            current_path: Mutex::new(PathBuf::from(":memory:")),
            current_user: Mutex::new(None),
        };
        db.init_tables().expect("init_tables");
        db
    }

    #[test]
    fn test_loesche_bewertung_kaskadiert_massnahmen() {
        // Fix #1: Beim Löschen einer Bewertung müssen ihre Maßnahmen per
        // ON DELETE CASCADE mitgelöscht werden (foreign_keys = ON).
        let db = make_test_db();

        let bewertung_id: i64;
        {
            let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
            conn.execute(
                "INSERT INTO bewertungen (lieferant, datum, antworten, ergebnis) VALUES ('L', '2024-01-01', '{}', 50.0)",
                [],
            ).unwrap();
            bewertung_id = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO massnahmen (bewertung_id, beschreibung, status) VALUES (?1, 'Test', 'offen')",
                [bewertung_id],
            ).unwrap();
            let vorher: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen", [], |r| r.get(0)).unwrap();
            assert_eq!(vorher, 1);
        }

        db.loesche_bewertung(bewertung_id).unwrap();

        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        let nachher: i64 = conn.query_row("SELECT COUNT(*) FROM massnahmen", [], |r| r.get(0)).unwrap();
        assert_eq!(nachher, 0, "Maßnahmen müssen per ON DELETE CASCADE mit der Bewertung gelöscht werden");
    }

    #[test]
    fn test_letzter_admin_schutz() {
        // Fix #2: Der letzte aktive Admin darf nicht herabgestuft/deaktiviert werden.
        let db = make_test_db();

        // init_tables seedet genau einen Admin ('admin').
        let admin_id: i64 = {
            let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
            conn.query_row("SELECT id FROM users WHERE username = 'admin'", [], |r| r.get(0)).unwrap()
        };

        // Herabstufen bzw. Deaktivieren des einzigen Admins -> muss fehlschlagen.
        assert!(db.aktualisiere_user(admin_id, "member", true).is_err(),
            "Der letzte Admin darf nicht herabgestuft werden können");
        assert!(db.aktualisiere_user(admin_id, "admin", false).is_err(),
            "Der letzte Admin darf nicht deaktiviert werden können");

        // Zustand muss unverändert admin + aktiv sein.
        {
            let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
            let (role, active): (String, i64) = conn.query_row(
                "SELECT role, active FROM users WHERE id = ?1", [admin_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            ).unwrap();
            assert_eq!(role, "admin");
            assert_eq!(active, 1);
        }

        // Mit einem zweiten Admin darf der erste herabgestuft werden.
        {
            let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
            conn.execute(
                "INSERT INTO users (username, password_hash, role, active) VALUES ('admin2', 'x', 'admin', 1)",
                [],
            ).unwrap();
        }
        assert!(db.aktualisiere_user(admin_id, "member", true).is_ok(),
            "Mit einem zweiten Admin darf der erste herabgestuft werden");
    }

    #[test]
    fn test_import_transaktional() {
        // Kleinkram #1: Import läuft in einer Transaktion. Gültige Zeilen werden committet,
        // ungültige übersprungen, und Duplikate im selben Batch werden erkannt (setzt voraus,
        // dass der Duplikat-Check die noch nicht committeten Inserts sieht).
        let db = make_test_db();
        let rows = vec![
            ImportBewertung { lieferant: "Alpha".into(), se_team: "T1".into(), datum: "2024-01-15".into(), ergebnis: 80.0, bestellnummer: String::new(), massnahmen: String::new() },
            ImportBewertung { lieferant: "   ".into(), se_team: String::new(), datum: "2024-01-15".into(), ergebnis: 50.0, bestellnummer: String::new(), massnahmen: String::new() }, // ungültig: Lieferant leer
            ImportBewertung { lieferant: "Alpha".into(), se_team: "T1".into(), datum: "2024-01-15".into(), ergebnis: 80.0, bestellnummer: String::new(), massnahmen: String::new() }, // Duplikat der 1. Zeile im selben Batch
        ];

        let res = db.import_bewertungen(&rows, true).unwrap();
        assert_eq!(res.imported, 1, "nur die erste gültige Zeile wird importiert");
        assert_eq!(res.skipped_duplicate, 1, "die Duplikatzeile im selben Batch wird erkannt");
        assert_eq!(res.errors.len(), 1, "die leere Lieferant-Zeile wird als Fehler gemeldet");

        let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM bewertungen", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "Commit muss genau eine Bewertung persistiert haben");
        let trimmed: i64 = conn.query_row("SELECT COUNT(*) FROM lieferanten WHERE name = 'Alpha'", [], |r| r.get(0)).unwrap();
        assert_eq!(trimmed, 1, "Lieferant 'Alpha' wurde getrimmt angelegt");
    }
}

#[tauri::command]
async fn save_image_with_dialog(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    default_filename: String,
    base64_data: String
) -> Result<Option<String>, String> {
    if !(db.is_current_user_admin() || db.is_current_user_member() || db.is_current_user_controlling()) {
        return Err("Nur angemeldete Benutzer dürfen Bild-Exporte durchführen".to_string());
    }
    use std::fs::File;
    use std::io::Write;
    use base64::{Engine as _, engine::general_purpose};
    use tauri_plugin_dialog::DialogExt;

    const MAX_BASE64_SIZE: usize = 50 * 1024 * 1024;
    if base64_data.len() > MAX_BASE64_SIZE {
        return Err(format!("Datei zu groß (max. {} MB)", MAX_BASE64_SIZE / 1024 / 1024));
    }

    let file_path = app.dialog()
        .file()
        .set_file_name(&default_filename)
        .add_filter("PNG Bild", &["png"])
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            {
                let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
                let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
                let details = format!("Image exportiert: {}", path_str);
                db.write_audit_log(&conn, &username, "EXPORT_IMAGE", "export", None, &details, true, None).ok();
            }

            let bytes = general_purpose::STANDARD
                .decode(&base64_data)
                .map_err(|e| format!("Base64 decode error: {}", e))?;

            let mut file = File::create(&path_str)
                .map_err(|e| format!("Could not create file: {}", e))?;

            file.write_all(&bytes)
                .map_err(|e| format!("Could not write file: {}", e))?;

            Ok(Some(path_str))
        }
        None => Ok(None)
    }
}

#[tauri::command]
async fn save_csv_with_dialog(
    app: tauri::AppHandle,
    db: State<'_, Database>,
    default_filename: String,
    base64_data: String
) -> Result<Option<String>, String> {
    if !(db.is_current_user_admin() || db.is_current_user_member() || db.is_current_user_controlling()) {
        return Err("Nur angemeldete Benutzer dürfen CSV-Exporte durchführen".to_string());
    }
    use std::fs::File;
    use std::io::Write;
    use base64::{Engine as _, engine::general_purpose};
    use tauri_plugin_dialog::DialogExt;

    const MAX_BASE64_SIZE: usize = 50 * 1024 * 1024;
    if base64_data.len() > MAX_BASE64_SIZE {
        return Err(format!("Datei zu groß (max. {} MB)", MAX_BASE64_SIZE / 1024 / 1024));
    }

    let file_path = app.dialog()
        .file()
        .set_file_name(&default_filename)
        .add_filter("CSV Datei", &["csv"])
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            {
                let username = db.get_current_username().unwrap_or_else(|| "unknown".to_string());
                let conn = db.conn.lock().unwrap_or_else(|e| e.into_inner());
                let details = format!("CSV exportiert: {}", path_str);
                db.write_audit_log(&conn, &username, "EXPORT_CSV", "export", None, &details, true, None).ok();
            }

            let bytes = general_purpose::STANDARD
                .decode(&base64_data)
                .map_err(|e| format!("Base64 decode error: {}", e))?;

            let mut file = File::create(&path_str)
                .map_err(|e| format!("Could not create file: {}", e))?;

            file.write_all(&bytes)
                .map_err(|e| format!("Could not write file: {}", e))?;

            Ok(Some(path_str))
        }
        None => Ok(None)
    }
}

// ============================================================================
// App Setup
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ============================================================================
// Phase 7: Rename Commands
// ============================================================================

#[tauri::command]
fn rename_lieferant_cmd(db: State<Database>, id: i64, new_name: String) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können Lieferanten umbenennen".to_string());
    }
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("Name darf nicht leer sein".to_string());
    }
    if new_name.len() > 200 {
        return Err("Name zu lang (max 200 Zeichen)".to_string());
    }
    db.rename_lieferant(id, new_name).map_err(|e| e.to_string())
}

#[tauri::command]
fn rename_se_team_cmd(db: State<Database>, id: i64, new_name: String) -> Result<(), String> {
    if !db.is_current_user_admin() {
        return Err("Nur Administratoren können SE-Teams umbenennen".to_string());
    }
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("Name darf nicht leer sein".to_string());
    }
    if new_name.len() > 200 {
        return Err("Name zu lang (max 200 Zeichen)".to_string());
    }
    db.rename_se_team(id, new_name).map_err(|e| e.to_string())
}

pub fn run() {
    let db = match Database::new() {
        Ok(db) => db,
        Err(e) => {
            let msg = format!(
                "SEVALSystem konnte die Datenbank nicht initialisieren:\n\n{}\n\nBitte prüfen Sie Dateiberechtigungen und Speicherplatz.",
                e
            );
            eprintln!("[SEVALSystem] FATAL: {}", msg);
            // Nativer Fehlerdialog anzeigen bevor die App beendet wird
            #[cfg(target_os = "linux")]
            {
                let _ = std::process::Command::new("zenity")
                    .args(["--error", "--title=SEVALSystem", "--text", &msg])
                    .status();
            }
            #[cfg(target_os = "windows")]
            {
                let _ = std::process::Command::new("msg")
                    .args(["*", &msg])
                    .status();
            }
            std::process::exit(1);
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(db)
        .invoke_handler(tauri::generate_handler![
            get_lieferanten,
            add_lieferant,
            count_bewertungen_for_lieferant_cmd,
            count_bewertungen_for_se_team_cmd,
            delete_lieferant,
            get_fragen_cmd,
            add_frage_cmd,
            update_frage_cmd,
            delete_frage_cmd,
            get_gruppen_cmd,
            check_duplicate_bewertung_cmd,
            speichere_bewertung_cmd,
            aktualisiere_bewertung_cmd,
            lade_historie_cmd,
            get_historie_count_cmd,
            lade_bewertung_cmd,
            loesche_bewertung_cmd,
            get_se_teams,
            add_se_team,
            delete_se_team,
            login_cmd,
            logout_cmd,
            change_password_cmd,
            get_heute,
            check_default_password,
            get_db_path,
            get_default_db_path,
            get_current_db_path,
            is_first_launch,
            set_db_path,
            select_db_location,
            select_existing_db,
            switch_database,
            factory_reset,
            save_pdf_file,
            save_pdf_with_dialog,
            save_image_with_dialog,
            save_csv_with_dialog,
            // Neue Commands für Settings, Dashboard, Maßnahmen-Tracking
            get_settings_cmd,
            update_settings_cmd,
            get_dashboard_data_cmd,
            get_fehlende_bewertungen_cmd,
            get_vorquartal_massnahmen_cmd,
            get_massnahmen_cmd,
            get_offene_massnahmen_cmd,
            create_massnahme_cmd,
            update_massnahme_status_cmd,
            delete_massnahme_cmd,
            get_massnahmen_uebersicht_cmd,
            check_ueberfaellige_massnahmen_cmd,
            // Phase 3: Erweiterte Analytik
            get_kategorie_trend_cmd,
            get_se_team_vergleich_cmd,
            // Phase 4: Import & Export
            open_csv_with_dialog,
            import_bewertungen_cmd,
            export_xlsx_with_dialog,
            // Phase 5: Backup-Verwaltung & App-Info
            list_backups_cmd,
            create_backup_cmd,
            restore_backup_cmd,
            delete_backup_cmd,
            get_app_info_cmd,
            // Phase 6: Ziele & Sollwerte
            get_ziele_cmd,
            get_ziel_fuer_lieferant_cmd,
            create_ziel_cmd,
            update_ziel_cmd,
            delete_ziel_cmd,
            get_ziele_summary_cmd,
            // User-Management Commands
            get_users,
            create_user,
            update_user,
            reset_user_password,
            delete_user,
            get_audit_log,
            get_current_user,
            // Cross-DB Vergleich
            validate_external_db,
            load_cross_db_historie,
            load_cross_db_category_scores,
            // Phase 7: Rename Commands
            rename_lieferant_cmd,
            rename_se_team_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Anwendung");
}
