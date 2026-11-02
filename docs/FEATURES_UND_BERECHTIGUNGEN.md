# SEVALSystem – Features & Berechtigungen

## Inhaltsverzeichnis

1. [Feature-Übersicht](#feature-übersicht)
2. [Berechtigungsmatrix](#berechtigungsmatrix)
3. [Rollenübersicht](#rollenübersicht)
4. [Hinweise zur Rollenlogik](#hinweise-zur-rollenlogik)

---

## Feature-Übersicht

### 1. Dashboard
- Echtzeit-KPIs: Bewertungen im aktuellen Quartal, Durchschnittsnoten, Lieferantenanzahl
- Kritische Lieferanten-Warnliste mit letzten Bewertungsergebnissen
- Top-Performer-Ranking (höchste Durchschnittsnoten)
- Lieferantenstatus-Verteilung (Ampelsystem: Grün/Gelb/Rot)
- Offene Maßnahmen-Übersicht mit Fortschrittsverfolgung
- Fehlende Bewertungen-Banner (noch nicht bewertete Lieferanten im Quartal)
- Lieferanten-Kategorieaufteilung nach Status
- Zeitraumfilter: Aktuelles Quartal, benutzerdefinierte Datumsbereiche
- Drill-Down: Klick auf KPI-Karten zeigt detaillierte Listen
- Ziel-Zusammenfassung mit Erreichungstracking

### 2. Bewertungserfassung
- Geführter Fragebogen mit hierarchischen Fragengruppen
- Mitgelieferter Beispielkatalog mit 3 Kategorien (frei anpassbar):
  - „Zusammenarbeit & Kommunikation"
  - „Entwicklung & Technik"
  - „Qualität & Lieferung"
- Bewertungssystem:
  - Erfüllt = 100 Punkte
  - Teilweise erfüllt = 50 Punkte
  - Nicht erfüllt = 0 Punkte
  - Keine Angabe = wird aus Berechnung ausgeschlossen
- Gewichtete Bewertung: Fragen haben individuelle Gewichtungen (1–10)
- Berechnung: Summe erreichter Punkte ÷ Summe möglicher Punkte × 100
- Lieferanten- und SE-Team-Auswahl (neu anlegen möglich während Bewertung)
- Bewertungsdatum und Bestellnummer
- Maßnahmen-Panel: Beschreibung, Verantwortlicher, Fälligkeitsdatum, Status
- Kommentare pro Kategorie
- Vorquartal-Maßnahmen und -Ergebnisse als Vergleich
- Echtzeit-Fortschrittsanzeige
- Speichern/Entwurf-Funktion
- Duplikaterkennung (gleicher Lieferant/SE-Team/Quartal)

### 3. Historie & Auswertungen
- **Tabellenansicht**: Bewertungsübersicht mit Paginierung (50 pro Seite), filterbar, sortierbar
- **Zeitstrahl-Ansicht**: Chronologische Darstellung, farbcodiert nach Ergebnis
- **Trendanalyse**: Liniendiagramme über Zeitverlauf, Multi-Lieferanten-Vergleich
- **Vergleichsansicht**: Seite-an-Seite-Vergleich zweier Lieferanten mit Radardiagramm
- **Audit-Log-Ansicht**: Revisionsprotokoll aller Datenänderungen

### 4. Kategorietrend-Analyse
- Bewertungsverlauf pro Fragengruppe über Zeit
- SE-Team-Vergleichs-Heatmap (Lieferanten × SE-Teams)
- Standardabweichung und Perzentilberechnungen
- Jahresvergleich (Year-over-Year)

### 5. Maßnahmen-Management
- Strukturierte Maßnahmen-Datenbank mit Status-Tracking
- Felder: Beschreibung, Verantwortlicher, Fälligkeitsdatum, Status
- Status-Workflow: offen → in Bearbeitung → erledigt (oder überfällig)
- Automatische Überfälligkeitserkennung beim App-Start
- Dashboard-Widget mit Übersicht offener/überfälliger Maßnahmen
- Lieferantenübergreifende Maßnahmen-Übersicht

### 6. Export-Funktionen
- **PDF-Export**: Einzelbewertung mit Diagramm, Quartalsbericht-Bundle
- **CSV-Export**: Deutsches Format (Semikolon-getrennt, UTF-8 mit BOM), Excel-kompatibel
- **PNG-Export**: Trenddiagramme als Bilder (Chart.js / html2canvas)
- **XLSX-Export**: Vollständige Tabelle mit Formatierung und farbcodierten Status-Indikatoren

### 7. CSV-Import
- Batch-Import von Bewertungen aus CSV/TXT-Dateien
- Optionaler Duplikat-Überspringen-Modus
- Detaillierte Fehlerberichte pro Zeile

### 8. Multi-Datenbank-Verwaltung
- Wechsel zwischen verschiedenen Datenbankdateien
- Pfadauswahl mit Sicherheitsprüfungen (nur .db, .sqlite, .sqlite3)
- Path-Traversal-Schutz
- Automatischer Audit-Log-Eintrag bei Datenbankwechsel
- Session-Reset bei Datenbankwechsel (Sicherheitsmaßnahme)

### 9. Datenbankübergreifender Vergleich
- Externe Datenbanken laden und validieren
- Lieferantenvergleich über mehrere SE-Team-Datenbanken
- Kategorie-Bewertungsvergleich datenbankübergreifend
- Nur-Lese-Zugriff auf externe Datenbanken

### 10. Backup & Wiederherstellung
- Automatisches Backup beim App-Start (max. 1 pro Kalendertag)
- Manuelles Backup auf Knopfdruck
- Backup-Verwaltung: Auflisten, Wiederherstellen, Löschen
- Konfigurierbare Aufbewahrungsdauer (Standard: 30 Tage, max. 365 Tage)

### 11. Benutzerverwaltung
- Benutzer erstellen mit Rollen-Zuweisung (Admin / Member / Controlling)
- Benutzer aktivieren/deaktivieren
- Passwort zurücksetzen
- Benutzer löschen
- Übersicht: Benutzername, Rolle, Erstelldatum, Aktivstatus

### 12. Stammdatenverwaltung
- **Lieferanten**: Anlegen, Umbenennen, Löschen (mit Warnhinweis über verknüpfte Bewertungen)
- **SE-Teams**: Anlegen, Umbenennen, Löschen (mit Warnhinweis über verknüpfte Bewertungen)
- Dropdown-Autovervollständigung in Bewertungsformularen

### 13. Fragenkatalog-Verwaltung
- Fragen anzeigen mit Gruppe, Gewichtung, Erstelldatum, Custom-Flag
- Neue Fragen hinzufügen mit Gewichtung und Gruppenzuordnung
- Fragen bearbeiten (Text und Gewichtung)
- Fragen löschen
- Standard-Fragen beim ersten Start automatisch geladen

### 14. Einstellungen & Konfiguration
- **Schwellenwerte**: Erfolg (Standard 75%), Warnung (Standard 50%)
- **Dashboard-Limits**: Top-Performer, Letzte Bewertungen, Kritische Lieferanten
- **Backup-Aufbewahrungsdauer** (1–365 Tage)
- **Datenbankpfad-Konfiguration**
- **Theme**: Hell/Dunkel-Modus

### 15. Ziele & Sollwerte
- Lieferantenspezifische Ziele pro Quartal setzen
- Optionale SE-Team-Zuordnung
- Beschreibung und Notizen pro Ziel
- Ampelsystem:
  - Grün: Ziel erreicht oder übertroffen
  - Gelb: Innerhalb 5 % des Zielwerts
  - Rot: Mehr als 5 % unter Zielwert
- Zusammenfassung: Erreicht, Knapp, Verfehlt, Ohne Bewertung
- Ziellinie im Trenddiagramm

### 16. Authentifizierung & Sicherheit
- Login mit Benutzername/Passwort
- BCrypt-Passwort-Hashing (Kostenfaktor 10)
- Passwortanforderungen: min. 8, max. 100 Zeichen
- Automatische Aufforderung zur Passwortänderung beim Erstlogin (Standard: admin/admin123)
- Session-Verwaltung (In-Memory, Mutex-basiert)
- Content Security Policy (CSP) gegen XSS
- SQL-Injection-Schutz durch parametrisierte Queries
- Keine externe Kommunikation (Offline-fähig, Air-Gap-kompatibel)

### 17. Audit-Trail (Revisionsprotokoll)
- Lückenlose Protokollierung aller Aktionen (20+ Aktionstypen)
- Felder: Benutzer, Aktionstyp, Entitätstyp, Zeitstempel, Erfolg/Fehler, Fehlermeldung
- Filterbar nach Aktionstyp und Ergebnis
- Rollenbasierter Zugriff
- Max. 10.000 Einträge pro Abfrage (OOM-Schutz)

### 18. System-Informationen
- App-Version, Datenbankpfad, Dateigröße
- Statistiken: Bewertungsanzahl, Lieferantenanzahl, Fragenanzahl, Benutzeranzahl
- Betriebssystem-Informationen

---

## Berechtigungsmatrix

> Stand: Version 2.0.1

| Feature / Aktion | Admin | Member | Controlling |
|---|:---:|:---:|:---:|
| **Authentifizierung** | | | |
| Anmelden / Abmelden | ✅ | ✅ | ✅ |
| Eigenes Passwort ändern | ✅ | ✅ | ✅ |
| Fremdes Passwort zurücksetzen | ✅ | ❌ | ❌ |
| **Dashboard** | | | |
| Dashboard anzeigen | ✅ | ✅ | ✅ |
| KPIs & Statistiken einsehen | ✅ | ✅ | ✅ |
| Fehlende Bewertungen einsehen | ✅ | ✅ | ✅ |
| **Bewertungen** | | | |
| Bewertungen anzeigen | ✅ | ✅ | ✅ |
| Bewertung erstellen | ✅ | ✅ | ❌ |
| Bewertung bearbeiten | ✅ | ✅ ³ | ✅ |
| Bewertung löschen | ✅ | ❌ | ❌ |
| Duplikaterkennung | ✅ | ✅ | ✅ |
| **Historie & Auswertungen** | | | |
| Tabellenansicht | ✅ | ✅ | ✅ |
| Zeitstrahl-Ansicht | ✅ | ✅ | ✅ |
| Trendanalyse | ✅ | ✅ | ✅ |
| Vergleichsansicht | ✅ | ✅ | ✅ |
| Kategorietrend-Analyse | ✅ | ✅ | ✅ |
| SE-Team-Vergleich | ✅ | ✅ | ✅ |
| **Export / Import** | | | |
| PDF exportieren | ✅ | ✅ | ✅ |
| CSV exportieren | ✅ | ✅ | ✅ |
| PNG exportieren | ✅ | ✅ | ✅ |
| XLSX exportieren | ✅ | ✅ | ✅ |
| CSV importieren | ✅ | ✅ | ❌ |
| **Stammdaten – Lieferanten** | | | |
| Lieferanten anzeigen | ✅ | ✅ | ✅ |
| Lieferant anlegen | ✅ | ✅ | ❌ |
| Lieferant umbenennen | ✅ | ❌ | ❌ |
| Lieferant löschen | ✅ | ❌ | ❌ |
| **Stammdaten – SE-Teams** | | | |
| SE-Teams anzeigen | ✅ | ✅ | ✅ |
| SE-Team anlegen | ✅ | ✅ | ❌ |
| SE-Team umbenennen | ✅ | ❌ | ❌ |
| SE-Team löschen | ✅ | ❌ | ❌ |
| **Maßnahmen** | | | |
| Maßnahmen anzeigen | ✅ | ✅ | ✅ |
| Maßnahme erstellen | ✅ | ✅ | ❌ |
| Maßnahmen-Status aktualisieren | ✅ | ✅ | ✅ ¹ |
| Maßnahme löschen | ✅ | ❌ | ❌ |
| **Fragenkatalog** | | | |
| Fragen anzeigen | ✅ | ✅ | ✅ |
| Frage hinzufügen | ✅ | ❌ | ❌ |
| Frage bearbeiten | ✅ | ❌ | ❌ |
| Frage löschen | ✅ | ❌ | ❌ |
| **Ziele & Sollwerte** | | | |
| Ziele anzeigen | ✅ | ✅ | ✅ |
| Ziel erstellen | ✅ | ❌ | ❌ |
| Ziel bearbeiten | ✅ | ❌ | ❌ |
| Ziel löschen | ✅ | ❌ | ❌ |
| **Benutzerverwaltung** | | | |
| Benutzer anzeigen | ✅ | ❌ | ❌ |
| Benutzer erstellen | ✅ | ❌ | ❌ |
| Rolle ändern | ✅ | ❌ | ❌ |
| Benutzer aktivieren/deaktivieren | ✅ | ❌ | ❌ |
| Benutzer löschen | ✅ | ❌ | ❌ |
| **Backup & Wiederherstellung** | | | |
| Backups anzeigen | ✅ | ❌ | ❌ |
| Manuelles Backup erstellen | ✅ | ❌ | ❌ |
| Backup wiederherstellen | ✅ | ❌ | ❌ |
| Backup löschen | ✅ | ❌ | ❌ |
| **Einstellungen** | | | |
| Einstellungen anzeigen | ✅ | ✅ | ✅ |
| Einstellungen bearbeiten | ✅ | ❌ | ❌ |
| Theme wechseln (Hell/Dunkel) | ✅ | ✅ | ✅ |
| **Datenbank** | | | |
| Datenbank wechseln | ✅ | ❌ | ✅ |
| Datenbankpfad konfigurieren | ✅ | ✅ | ✅ |
| Externe DB validieren | ✅ | ✅ | ✅ |
| Datenbankübergreifender Vergleich | ✅ | ❌ | ❌ |
| **Audit-Trail** | | | |
| Komplettes Audit-Log einsehen | ✅ | ❌ | ❌ |
| Eigene Audit-Einträge einsehen | ✅ | ✅ | ✅ |
| **System** | | | |
| App-Informationen anzeigen | ✅ | ✅ | ✅ |
| Werksreset (alle Daten löschen) | ✅ | ❌ | ❌ |

**Fußnoten:**

¹ Alle Rollen dürfen den Maßnahmen-Status aktualisieren. Controlling nutzt dies als Prüf-/Freigabefunktion, Member zum Abarbeiten eigener Maßnahmen.

³ Member können nur **eigene** Bewertungen bearbeiten (Prüfung über `created_by`-Feld). Admin und Controlling können alle Bewertungen bearbeiten.

---

## Rollenübersicht

### Admin
Vollzugriff auf alle Funktionen. Kann Benutzer, Einstellungen, Backups, Fragenkatalog, Ziele und Stammdaten verwalten. Sieht das komplette Audit-Log aller Benutzer. Kann den Werksreset und den datenbankübergreifenden Vergleich durchführen.

### Member
Operativer Benutzer für den täglichen Bewertungsbetrieb. Kann Bewertungen **erstellen** und **eigene Bewertungen bearbeiten** (nicht die anderer Benutzer). Kann Lieferanten und SE-Teams **anlegen** (nicht umbenennen oder löschen), Maßnahmen erstellen und deren Status aktualisieren, sowie Daten in allen Formaten exportieren und CSV-Dateien importieren. Kein Zugriff auf Benutzerverwaltung, Einstellungen, Backups, Fragenkatalog, Ziele oder Datenbankwechsel. Sieht im Audit-Log nur eigene Einträge.

### Controlling
Prüf- und Korrekturrolle. Kann alle Bewertungen, Historien, Trends und Auswertungen **einsehen**, bestehende Bewertungen **bearbeiten** (Korrektur-/Prüffunktion) und den **Maßnahmen-Status aktualisieren** (Freigabefunktion). Kann Daten in allen Formaten exportieren und die **Datenbank wechseln**. Kann jedoch **keine** neuen Bewertungen, Lieferanten, SE-Teams oder Maßnahmen erstellen und keine Daten löschen. Sieht im Audit-Log nur eigene Einträge.

---

## Hinweise zur Rollenlogik

### Design-Entscheidungen
1. **Member kann eigene Bewertungen bearbeiten:** `aktualisiere_bewertung_cmd` prüft für Member das `created_by`-Feld. Admin und Controlling dürfen alle Bewertungen bearbeiten.
2. **Maßnahmen-Status für alle Rollen:** `update_massnahme_status_cmd` erlaubt allen eingeloggten Benutzern die Statusänderung. Controlling nutzt dies als Prüf-/Freigabefunktion, Member zum Abarbeiten eigener Maßnahmen.
3. **Datenbankwechsel nur Admin + Controlling:** `switch_database` ist auf Admin und Controlling beschränkt. Member arbeiten ausschließlich in der zugewiesenen Datenbank.
