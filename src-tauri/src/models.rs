use serde::{Deserialize, Serialize};

// ============================================================================
// Datenmodelle
// ============================================================================

// Phase 7: FK-basierte Entitäten
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct LieferantInfo {
    pub id: i64,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SeTeamInfo {
    pub id: i64,
    pub name: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Bewertung {
    pub id: Option<i64>,
    #[serde(default)]
    pub lieferant_id: Option<i64>,
    pub lieferant: String,
    #[serde(default)]
    pub se_team_id: Option<i64>,
    pub se_team: String,
    pub datum: String,
    pub antworten: serde_json::Value,
    pub kommentare: serde_json::Value,
    pub ergebnis: f32,
    #[serde(default)]
    pub bestellnummer: String,
    #[serde(default)]
    pub massnahmen: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct HistorieEintrag {
    pub id: i64,
    #[serde(default)]
    pub lieferant_id: Option<i64>,
    pub lieferant: String,
    #[serde(default)]
    pub se_team_id: Option<i64>,
    pub se_team: String,
    pub datum: String,
    pub ergebnis: f32,
    #[serde(default)]
    pub bestellnummer: String,
    #[serde(default)]
    pub vorquartal_ergebnis: Option<f32>,
    #[serde(default)]
    pub vorquartal_diff: Option<f32>,
    #[serde(default)]
    pub has_open_massnahmen: bool,
    #[serde(default)]
    pub is_resolution: bool,
    #[serde(default)]
    pub massnahmen_total: i32,
    #[serde(default)]
    pub massnahmen_offen: i32,
    #[serde(default)]
    pub massnahmen_erledigt: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DuplicateInfo {
    pub id: i64,
    pub datum: String,
    pub ergebnis: f32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct User {
    pub id: i64,
    pub username: String,
    #[serde(default = "default_role")]
    pub role: String,
    #[serde(default = "default_active")]
    pub active: bool,
}

fn default_role() -> String {
    "member".to_string()
}
fn default_active() -> bool {
    true
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct UserForList {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub active: bool,
    pub erstellt_am: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NewUser {
    pub username: String,
    pub password: String,
    pub role: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AuditLogEntry {
    pub id: i64,
    pub user_id: Option<i64>,
    pub username: String,
    pub action: String,
    pub entity_type: String,
    pub entity_id: Option<i64>,
    pub details: String,
    pub timestamp: String,
    pub success: bool,
    pub error_message: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Frage {
    pub id: i64,
    pub index: usize,
    pub text: String,
    pub gruppe: String,
    pub gewichtung: i32,
    pub is_custom: bool,
    pub erstellt_am: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NeueFrage {
    pub text: String,
    pub gruppe: String,
    pub gewichtung: i32,
    pub position: Option<usize>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Settings {
    pub threshold_success: f32,
    pub threshold_warning: f32,
    pub dashboard_top_limit: i32,
    pub dashboard_recent_limit: i32,
    pub dashboard_critical_limit: i32,
    pub backup_retention_days: i32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            threshold_success: 75.0,
            threshold_warning: 50.0,
            dashboard_top_limit: 5,
            dashboard_recent_limit: 5,
            dashboard_critical_limit: 10,
            backup_retention_days: 30,
        }
    }
}

// Phase 5: App Info & Backup
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct AppInfo {
    pub version: String,
    pub db_path: String,
    pub db_size_bytes: u64,
    pub bewertungen_count: i32,
    pub lieferanten_count: i32,
    pub fragen_count: i32,
    pub users_count: i32,
    pub os_info: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BackupEntry {
    pub filename: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct VorquartalMassnahmen {
    pub massnahmen: String,
    pub datum: String,
    pub ergebnis: f32,
    pub lieferant: String,
}

// Strukturiertes Maßnahmen-Tracking (Phase 2)
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Massnahme {
    pub id: i64,
    pub bewertung_id: i64,
    pub beschreibung: String,
    #[serde(default)]
    pub verantwortlich: Option<String>,
    #[serde(default)]
    pub faellig_am: Option<String>,
    pub status: String,
    #[serde(default)]
    pub erledigt_am: Option<String>,
    pub erstellt_am: String,
    #[serde(default)]
    pub erstellt_von: Option<String>,
    // Joined fields für Übersicht
    #[serde(default)]
    pub lieferant: Option<String>,
    #[serde(default)]
    pub se_team: Option<String>,
    #[serde(default)]
    pub bewertung_datum: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NeueMassnahme {
    pub bewertung_id: i64,
    pub beschreibung: String,
    #[serde(default)]
    pub verantwortlich: Option<String>,
    #[serde(default)]
    pub faellig_am: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct MassnahmenUebersicht {
    pub offen: i64,
    pub in_bearbeitung: i64,
    pub ueberfaellig: i64,
    pub erledigt: i64,
    pub gesamt: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct DashboardData {
    pub bewertungen_quartal: i32,
    pub bewertungen_gesamt: i32,
    pub lieferanten_gesamt: i32,
    pub durchschnitt_quartal: Option<f32>,
    pub kritische_lieferanten: Vec<KritischerLieferant>,
    pub fehlende_bewertungen: Vec<String>,
    pub letzte_bewertungen: Vec<HistorieEintrag>,
    pub aktuelles_quartal: String,
    pub offene_massnahmen: Vec<OffeneMassnahme>,
    pub bewertungsverteilung: BewertungsVerteilung,
    pub top_performer: Vec<TopPerformer>,
    pub lieferanten_nach_kategorie: LieferantenNachKategorie,
    #[serde(default)]
    pub ziele_summary: Option<ZieleSummary>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct KritischerLieferant {
    pub name: String,
    pub letztes_ergebnis: f32,
    pub datum: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct OffeneMassnahme {
    pub lieferant: String,
    pub massnahmen: String,
    pub datum: String,
    pub bewertung_id: i64,
    #[serde(default)]
    pub action_due_date: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct BewertungsVerteilung {
    pub gruen: i32,
    pub gelb: i32,
    pub rot: i32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TopPerformer {
    pub rang: i32,
    pub name: String,
    pub durchschnitt: f32,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct KategorieLieferant {
    pub name: String,
    pub score: f32,
    pub datum: String,
    #[serde(rename = "scoreClass")]
    pub score_class: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct LieferantenNachKategorie {
    pub gruen: Vec<KategorieLieferant>,
    pub gelb: Vec<KategorieLieferant>,
    pub rot: Vec<KategorieLieferant>,
}

// ============================================================================
// Cross-DB Vergleich
// ============================================================================

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrossDbSource {
    pub path: String,
    pub label: String,
    pub lieferanten: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrossDbHistorieEintrag {
    pub id: i64,
    pub lieferant: String,
    pub se_team: String,
    pub datum: String,
    pub ergebnis: f32,
    #[serde(default)]
    pub bestellnummer: String,
    #[serde(default)]
    pub has_open_massnahmen: bool,
    #[serde(default)]
    pub is_resolution: bool,
    pub db_label: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrossDbCompareResult {
    pub sources: Vec<CrossDbSource>,
    pub entries: Vec<CrossDbHistorieEintrag>,
}

// Kategorien-Vergleich (per-Gruppe Scores über DBs hinweg)
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrossDbCategoryScore {
    pub gruppe: String,
    pub score: f32,
    pub fragen_count: usize,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrossDbCategoryEntry {
    pub db_label: String,
    pub datum: String,
    pub ergebnis: f32,
    pub categories: Vec<CrossDbCategoryScore>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct CrossDbCategoryResult {
    pub entries: Vec<CrossDbCategoryEntry>,
}

// ============================================================================
// Phase 3: Erweiterte Analytik
// ============================================================================

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct KategorieTrendEntry {
    pub datum: String,
    pub ergebnis: f32,
    pub categories: Vec<KategorieTrendScore>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct KategorieTrendScore {
    pub gruppe: String,
    pub score: f32,
    pub fragen_count: usize,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct SeTeamVergleichEntry {
    pub lieferant: String,
    pub se_team: String,
    pub avg_score: f32,
    pub count: i32,
}

// Phase 4: Import
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ImportBewertung {
    pub lieferant: String,
    pub se_team: String,
    pub datum: String,
    pub ergebnis: f32,
    #[serde(default)]
    pub bestellnummer: String,
    #[serde(default)]
    pub massnahmen: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ImportResult {
    pub imported: i32,
    pub skipped_duplicate: i32,
    pub errors: Vec<String>,
}

// ============================================================================
// Phase 6: Ziele & Sollwerte
// ============================================================================

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Ziel {
    pub id: i64,
    #[serde(default)]
    pub lieferant_id: Option<i64>,
    pub lieferant: String,
    pub se_team: Option<String>,
    pub quartal: String,
    pub zielwert: f32,
    pub beschreibung: Option<String>,
    pub erstellt_am: String,
    pub erstellt_von: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct NeuesZiel {
    #[serde(default)]
    pub lieferant_id: Option<i64>,
    pub lieferant: String,
    pub se_team: Option<String>,
    pub quartal: String,
    pub zielwert: f32,
    pub beschreibung: Option<String>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ZielStatus {
    #[serde(default)]
    pub lieferant_id: Option<i64>,
    pub lieferant: String,
    pub quartal: String,
    pub zielwert: f32,
    pub ist_wert: Option<f32>,
    pub ampel: String,
    pub differenz: Option<f32>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct ZieleSummary {
    pub erreicht: i32,
    pub knapp: i32,
    pub verfehlt: i32,
    pub ohne_bewertung: i32,
    pub details: Vec<ZielStatus>,
}
