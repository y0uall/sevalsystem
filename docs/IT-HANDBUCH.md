# SEVALSystem – IT-Handbuch

Zielgruppe: Administratoren, IT-Betrieb und IT-Sicherheit. Dieses Dokument beschreibt
Installation, Speicherorte, Sicherheitskonzept, Betrieb im Team sowie Backup und Problembehandlung.
Die fachliche Bedienung steht im [Benutzerhandbuch](BENUTZERHANDBUCH.md), die Rechte je Rolle in
[Features & Berechtigungen](FEATURES_UND_BERECHTIGUNGEN.md).

---

## 1. Überblick

SEVALSystem ist eine Desktop-Anwendung zur strukturierten Lieferantenbewertung. Sie läuft vollständig
lokal, benötigt keine Internetverbindung und speichert alle Daten in einer einzigen SQLite-Datei.

| Komponente | Technologie |
|---|---|
| Framework | [Tauri 2](https://tauri.app) (Rust-Backend, systemeigene WebView) |
| Backend | Rust, SQLite über `rusqlite` (statisch gebündelt) |
| Frontend | HTML5, CSS3, Vanilla JavaScript (lokal gebündelt: Chart.js, jsPDF, html2canvas) |
| Passwort-Hashing | bcrypt, Kostenfaktor 10 |
| Excel-Export | `rust_xlsxwriter` |
| Rendering | WebView2 (Windows), WebKitGTK (Linux), WebKit (macOS) |

Es gibt **keine Telemetrie, kein Auto-Update und keine Netzwerkkommunikation** durch die Anwendung.
Sie ist damit auch in abgeschotteten Netzen (Air Gap) einsetzbar.

---

## 2. Installation

### Windows
- Installer `SEVALSystem_<Version>_x64_de-DE.msi` ausführen (Installation pro Rechner, kein Administrator
  für den Betrieb nötig).
- Voraussetzung ist die **WebView2-Runtime**, die auf aktuellen Windows-10/11-Systemen bereits vorhanden ist.
  Falls nicht, stellt Microsoft den "Evergreen Bootstrapper" bereit. Prüfung über die Registry:
  `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
- Verteilung per Softwareverteilung oder manuell; ein Update überschreibt die bisherige Version.
  Konfiguration und Datenbank liegen außerhalb des Installationsverzeichnisses und bleiben erhalten.

### Linux
- `.deb`-Paket (Debian/Ubuntu) oder `.AppImage` verwenden. Laufzeitabhängigkeit ist WebKitGTK 4.1
  (`libwebkit2gtk-4.1-0`), auf Desktop-Systemen in der Regel vorhanden.

### macOS
- `.dmg` öffnen und die App in den Programme-Ordner ziehen.

### Aus dem Quellcode bauen
Siehe Abschnitt *Bauen & Starten* in der [README](../README.md).

---

## 3. Speicherorte

### Konfigurationsdatei

Die Anwendung merkt sich nur den Pfad zur Datenbank. Die Datei `config.json` liegt hier:

| Betriebssystem | Pfad |
|---|---|
| Windows | `%APPDATA%\sevalsystem\SEVALSystem\config\config.json` |
| Linux | `~/.config/sevalsystem/config.json` |
| macOS | `~/Library/Application Support/de.sevalsystem.SEVALSystem/config.json` |

Inhalt:

```json
{
  "db_path": "/pfad/zur/bewertungen.db",
  "first_launch_complete": true
}
```

Wird die Datei gelöscht, fragt die App beim nächsten Start erneut nach dem Speicherort (Ersteinrichtung).

### Datenbank

Standardpfad der SQLite-Datenbank `bewertungen.db` (beim ersten Start oder später unter
*Einstellungen → Datenbank* änderbar, z. B. auf ein Netzlaufwerk):

| Betriebssystem | Standardpfad |
|---|---|
| Windows | `%APPDATA%\sevalsystem\SEVALSystem\data\bewertungen.db` |
| Linux | `~/.local/share/sevalsystem/bewertungen.db` |
| macOS | `~/Library/Application Support/de.sevalsystem.SEVALSystem/bewertungen.db` |

### Backups

Automatische Sicherungen liegen im Unterordner `backups/` neben der Datenbank:

```
<Datenbank-Ordner>/backups/
├── bewertungen_2026-11-02.db.bak
├── bewertungen_2026-11-01.db.bak
└── ...
```

Pro Kalendertag wird beim Programmstart höchstens ein Backup erzeugt. Ältere Sicherungen werden nach
Ablauf der konfigurierten Aufbewahrungsdauer (Standard 30 Tage, maximal 365) automatisch gelöscht.

### Protokolle

Die Anwendung schreibt keine Log-Dateien. Hinweise und Fehler werden in der Oberfläche angezeigt;
beim Start aus einem Terminal erscheinen zusätzliche Meldungen auf der Standardfehlerausgabe.

---

## 4. Sicherheitskonzept

### Authentifizierung
- Passwörter werden ausschließlich als **bcrypt-Hash** (Kostenfaktor 10, zufälliger Salt) gespeichert.
- Mindestlänge für Passwörter: 8 Zeichen.
- Deaktivierte Konten werden beim Login serverseitig abgelehnt.
- Die Sitzung wird im Speicher des Rust-Backends gehalten; bei einem Datenbankwechsel wird sie zurückgesetzt.
- Hinweis zur Migration: Klartext-Passwörter aus sehr alten Datenbankständen werden beim ersten Login
  erkannt und automatisch durch einen bcrypt-Hash ersetzt.

### Rechteprüfung
Alle Berechtigungen werden **im Backend** geprüft, nicht nur in der Oberfläche. Die vollständige Matrix
steht in [Features & Berechtigungen](FEATURES_UND_BERECHTIGUNGEN.md).

### SQL-Injection
Sämtliche Datenbankzugriffe verwenden Prepared Statements mit Parameterbindung; es wird kein SQL aus
Benutzereingaben zusammengesetzt.

```rust
conn.execute("SELECT id FROM users WHERE username = ?1", [username])
```

### Cross-Site-Scripting (XSS)
Benutzereingaben (Lieferantennamen, Kommentare, Maßnahmen) werden vor der Anzeige über eine zentrale
Escape-Funktion in Text umgewandelt. Zusätzlich gilt eine restriktive Content Security Policy:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ipc: tauri:
```

Externe Skripte, Inline-Skripte und `eval()` sind damit technisch blockiert.

### Dateisystem
- Datenbankpfade werden geprüft: nur die Endungen `.db`, `.sqlite`, `.sqlite3`; Pfade mit `..` werden abgelehnt.
- Externe Datenbanken für den datenbankübergreifenden Vergleich werden **schreibgeschützt** geöffnet.
- Backup-Dateinamen werden gegen Pfadbestandteile (`..`, `/`, `\`) geprüft.
- Exporte laufen über den systemeigenen Speichern-Dialog; die Dateigröße ist auf 50 MB begrenzt.
- Die Tauri-Capabilities (`src-tauri/capabilities/default.json`) erlauben dem Frontend nur das Öffnen
  des Speichern-Dialogs und das Öffnen von Dateien mit der Standardanwendung.

### Netzwerk
Die Anwendung öffnet keine Ports und baut keine Verbindungen auf. Firewall-Regeln sind nur für den
Zugriff auf ein eventuell genutztes Netzlaufwerk relevant.

---

## 5. Benutzer und Rollen

### Standard-Administrator

Beim ersten Start wird automatisch ein Administrator angelegt:

| Feld | Wert |
|---|---|
| Benutzername | `admin` |
| Passwort | `admin123` |

Beim ersten Login erscheint eine Aufforderung, das Passwort zu ändern. Empfehlung: persönliche
Administratorkonten anlegen und das Konto `admin` anschließend deaktivieren oder löschen.

### Rollen

| Rolle | Kurzbeschreibung |
|---|---|
| `admin` | Vollzugriff: Benutzer, Einstellungen, Fragenkatalog, Ziele, Backups, Datenbankwechsel, datenbankübergreifender Vergleich, gesamtes Audit-Log |
| `member` | Operativer Bewerter: Bewertungen und Maßnahmen anlegen, eigene Bewertungen bearbeiten, Stammdaten anlegen, Exporte und CSV-Import |
| `controlling` | Prüf- und Korrekturrolle: alle Bewertungen einsehen und bearbeiten, Maßnahmenstatus pflegen, Exporte, Datenbankwechsel |

Passwörter können vom Benutzer selbst geändert und vom Administrator zurückgesetzt werden.

---

## 6. Datenbank

### Tabellen

| Tabelle | Inhalt |
|---|---|
| `users` | Benutzerkonten mit bcrypt-Hash, Rolle und Aktiv-Kennzeichen |
| `lieferanten` | Lieferanten-Stammdaten |
| `se_teams` | Teams/Organisationseinheiten, denen Bewertungen zugeordnet werden |
| `fragen` | Fragenkatalog mit Kategorie und Gewichtung (1–10) |
| `bewertungen` | Bewertungen mit Antworten (JSON), Kommentaren, Ergebnis und Verknüpfungen |
| `massnahmen` | Maßnahmen zu Bewertungen (Verantwortlicher, Fälligkeit, Status) |
| `ziele` | Zielwerte je Lieferant und Quartal |
| `settings` | Schwellenwerte, Dashboard-Limits, Backup-Aufbewahrung |
| `audit_log` | Revisionsprotokoll aller Aktionen |

Fremdschlüssel sind aktiviert (`PRAGMA foreign_keys = ON`); das Löschen einer Bewertung entfernt
zugehörige Maßnahmen kaskadierend.

### Schema-Migrationen
Beim Start werden fehlende Spalten und Tabellen automatisch ergänzt (abwärtskompatibel, keine
manuelle Migration nötig). Datenbanken älterer Versionen können daher direkt weiterverwendet werden.

### Audit-Log
Protokolliert werden u. a. `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `CREATE`, `UPDATE`, `DELETE`,
`CREATE_ZIEL`, `UPDATE_ZIEL`, `DELETE_ZIEL`, `EXPORT_PDF`, `EXPORT_CSV`, `EXPORT_XLSX`, `EXPORT_IMAGE`,
`IMPORT_CSV`, `RENAME_LIEFERANT`, `RENAME_SE_TEAM`, `SWITCH_DB`, `CROSS_DB_COMPARE`, Backup-Aktionen
sowie `FACTORY_RESET`. Jeder Eintrag enthält Benutzer, Zeitstempel, Objekttyp, Details und
Erfolg/Fehler. Administratoren sehen das gesamte Protokoll, andere Rollen nur ihre eigenen Einträge.
Eine Abfrage liefert maximal 10.000 Einträge.

### Kapazität
Für den typischen Einsatz (einige hundert Bewertungen pro Jahr) bleibt die Datenbank über viele Jahre
unter wenigen Megabyte; Leistungsgrenzen sind erst bei sechsstelligen Datensatzzahlen zu erwarten.

---

## 7. Betrieb im Team (gemeinsame Datenbank)

1. Datenbankdatei auf ein Netzlaufwerk legen (z. B. `\\server\freigabe\seval\bewertungen.db`).
2. Jeder Arbeitsplatz wählt diesen Pfad bei der Ersteinrichtung oder unter *Einstellungen → Datenbank*.
3. Schreibrechte auf der Freigabe nur für autorisierte Benutzer vergeben.

Hinweise zu SQLite:
- Gleichzeitiges **Lesen** ist unproblematisch. Beim **Schreiben** sperrt SQLite die Datei kurzzeitig;
  gleichzeitige Schreibzugriffe werden nacheinander ausgeführt oder mit der Meldung
  *Database is locked* abgewiesen.
- Empfohlen für kleine Teams (wenige gleichzeitige Schreiber). Der Fileserver muss Dateisperren (SMB-Locking)
  korrekt unterstützen; eine geringe Netzwerklatenz sorgt für flüssige Bedienung.
- Alternativ je Team eine eigene Datenbank führen und Auswertungen über den **datenbankübergreifenden
  Vergleich** (Administrator) zusammenführen.

---

## 8. Backup & Wiederherstellung

- **Automatisch:** einmal täglich beim Start in `backups/` (siehe Abschnitt 3), Aufbewahrung konfigurierbar.
- **Manuell in der App:** *Einstellungen → Datensicherung* – Backups auflisten, erstellen, wiederherstellen
  und löschen (nur Administrator). Diese Aktionen werden im Audit-Log protokolliert.
- **Manuell per Datei:** Die Datenbank ist eine einzelne Datei; eine Kopie von `bewertungen.db` genügt.
  Zur Wiederherstellung eine `.db.bak`-Datei in `.db` umbenennen und über den Datenbankwechsel auswählen.
- Empfehlung: Datenbank- und Backup-Ordner zusätzlich in die zentrale Datensicherung aufnehmen.

---

## 9. Problembehandlung

| Symptom | Vorgehen |
|---|---|
| App startet nicht / bleibt leer | Aus einem Terminal starten und Meldungen prüfen; `config.json` löschen, damit die Ersteinrichtung erneut läuft |
| Datenbankpfad nicht mehr erreichbar | Beim Login über *Datenbank wechseln* eine lokale oder andere Datenbank wählen |
| "Database is locked" | Mehrfachstart der App prüfen, andere Programme mit geöffneter DB schließen, bei Netzlaufwerken kurz warten und erneut versuchen |
| Passwort vergessen | Administrator setzt unter *Einstellungen → Benutzerverwaltung* ein neues Passwort |
| Alle Administratoren ausgesperrt | Backup einspielen oder neue Datenbank anlegen (Werksreset löscht alle Daten) |
| Export schlägt fehl | Schreibrechte auf Zielordner prüfen; Größenlimit 50 MB beachten |

---

## 10. Systemanforderungen

| Komponente | Anforderung |
|---|---|
| Windows | Windows 10 (ab 20H2) oder 11, 64-bit, WebView2-Runtime |
| Linux | Aktuelle Distribution mit WebKitGTK 4.1 (z. B. Ubuntu 22.04+, Debian 12+) |
| macOS | macOS 11 oder neuer |
| Arbeitsspeicher | 512 MB frei (empfohlen 1 GB) |
| Festplatte | ca. 30 MB für die Anwendung plus Datenbank und Backups |
| Bildschirm | mindestens 1024 × 700 Pixel, empfohlen 1400 × 900 |
| Netzwerk | nicht erforderlich (optional Netzlaufwerk für die gemeinsame Datenbank) |
