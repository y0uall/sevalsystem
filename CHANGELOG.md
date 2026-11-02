# Changelog

Alle nennenswerten Änderungen an SEVALSystem werden in dieser Datei dokumentiert.
Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionsnummern folgen [Semantic Versioning](https://semver.org/lang/de/).

## [2.0.1] – 2026-11-02

### Geändert
- Erste öffentliche Veröffentlichung unter der MIT-Lizenz.
- Rust-Abhängigkeiten aktualisiert: Tauri 2.12, tauri-plugin-dialog 2.8, tauri-plugin-shell 2.6,
  rusqlite 0.41, bcrypt 0.19, base64 0.23, rust_xlsxwriter 0.102, chrono 0.4.45, serde_json 1.0.154.
- Frontend-Bibliotheken aktualisiert: Chart.js 4.6.1 und jsPDF 4.2.1 (schließt mehrere
  Sicherheitslücken in jsPDF, u. a. ReDoS in `addImage` und Injection in den Ausgabefunktionen).
- Dokumentation überarbeitet und in `docs/` zusammengeführt (Benutzerhandbuch, IT-Handbuch,
  Features & Berechtigungen, Berechnungslogik); README mit Screenshots.
- Demo-Datenbanken mit frei erfundenen Daten (`demo/build_demo_dbs.py`) zum Ausprobieren.
- GitHub Actions: CI (Tests, Clippy) sowie Release-Builds für Windows und Linux bei Tags `v*`.

### Entfernt
- Generierte Tauri-Schemas (`src-tauri/gen/schemas`) und ein veraltetes Prüfskript aus dem Repository entfernt.

## [2.0.0] – 2026-03-07

### Hinzugefügt
- Strukturiertes Maßnahmen-Tracking mit Verantwortlichem, Fälligkeitsdatum, Status und automatischer Überfälligkeitserkennung.
- Ziele & Sollwerte je Lieferant und Quartal inklusive Ampel-Auswertung und Ziellinie im Trenddiagramm.
- Kategorie-Trend-Analyse, SE-Team-Vergleich, erweiterte Statistik (Median, Standardabweichung, Perzentile, Jahresvergleich).
- CSV-Import mit Validierung und Duplikaterkennung, XLSX-Export, Quartalsbericht als PDF.
- Backup-Verwaltung in der Oberfläche, konfigurierbare Dashboard-Limits und Aufbewahrungsdauer.
- Pagination in der Historie, Duplikaterkennung bei Bewertungen, Löschschutz für Stammdaten.
- Splash Screen, App-Informationen, Audit-Logging für Backups.

### Geändert
- Lieferanten und SE-Teams werden per Fremdschlüssel verknüpft (Umbenennen und kaskadierendes Löschen möglich).
- Dreistufiges Rollenmodell (`admin`, `member`, `controlling`), serverseitig im Rust-Backend durchgesetzt.
- Alte Kommentarfelder in ein JSON-Format migriert.

### Behoben
- Deadlock bei der Anzeige von Vorquartals-Maßnahmen.
- Audit-Log: vollständige Aktionsbezeichnungen, neue Filter, korrigierte Anzeige.
- Größenlimit für Exporte, transaktionale Schreibvorgänge, zusätzliche Null-Prüfungen.

## [1.0.2] – 2026-02

### Hinzugefügt
- Datenbankübergreifender Vergleich mehrerer Bewertungsdatenbanken (schreibgeschützt, nur Administrator).

## [1.0.0] – 2026-01

### Hinzugefügt
- Erste Version: geführter Bewertungsbogen, Historie mit Timeline und Trends, PDF-/CSV-/PNG-Export,
  Benutzerverwaltung mit bcrypt, Audit-Log, automatische Backups.
