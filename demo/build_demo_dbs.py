#!/usr/bin/env python3
"""
Erzeugt zwei gefüllte Demo-Datenbanken für SEVALSystem.

Zweck: Screenshots, Ausprobieren der Anwendung und der datenbankübergreifende
Vergleich (beide Datenbanken enthalten dieselben Lieferanten, aber ein anderes
SE-Team und abweichende Bewertungen).

Alle Daten sind frei erfunden. Die Quartale werden relativ zum heutigen Datum
erzeugt, damit das Dashboard immer ein gefülltes "aktuelles Quartal" zeigt.
Die erzeugten .db-Dateien sind per .gitignore vom Repository ausgeschlossen.

Login in der App:  admin / admin123   (ebenso m.weber und s.fischer)

Erneut erzeugen:   python3 demo/build_demo_dbs.py
Voraussetzung:     pip install bcrypt
"""
import datetime as dt
import json
import os
import random
import sqlite3

import bcrypt

random.seed(42)
HERE = os.path.dirname(os.path.abspath(__file__))
PWHASH = bcrypt.hashpw(b"admin123", bcrypt.gensalt(rounds=10)).decode()
TODAY = dt.date.today()

# --- Vollständiges Schema (Stand nach allen App-Migrationen) ------------------
SCHEMA = """
CREATE TABLE bewertungen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lieferant TEXT NOT NULL, se_team TEXT DEFAULT '', datum TEXT NOT NULL,
  antworten TEXT NOT NULL, kommentar1 TEXT, kommentar2 TEXT, kommentar3 TEXT,
  ergebnis REAL NOT NULL, erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP,
  kommentare_json TEXT, bestellnummer TEXT DEFAULT '', massnahmen TEXT DEFAULT '',
  action_due_date TEXT, action_completed INTEGER DEFAULT 0,
  created_by TEXT, modified_by TEXT, lieferant_id INTEGER, se_team_id INTEGER);
CREATE TABLE lieferanten (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE se_teams (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, is_admin INTEGER DEFAULT 0,
  erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP, role TEXT, active INTEGER DEFAULT 1);
CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username TEXT NOT NULL,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id INTEGER, details TEXT NOT NULL,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP, ip_address TEXT, user_agent TEXT,
  success INTEGER DEFAULT 1, error_message TEXT);
CREATE TABLE massnahmen (id INTEGER PRIMARY KEY AUTOINCREMENT, bewertung_id INTEGER NOT NULL,
  beschreibung TEXT NOT NULL, verantwortlich TEXT, faellig_am TEXT, status TEXT DEFAULT 'offen',
  erledigt_am TEXT, erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP, erstellt_von TEXT,
  FOREIGN KEY (bewertung_id) REFERENCES bewertungen(id) ON DELETE CASCADE);
CREATE TABLE ziele (id INTEGER PRIMARY KEY AUTOINCREMENT, lieferant TEXT NOT NULL, se_team TEXT,
  quartal TEXT NOT NULL, zielwert REAL NOT NULL, beschreibung TEXT,
  erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP, erstellt_von TEXT, lieferant_id INTEGER, se_team_id INTEGER);
CREATE TABLE fragen (id INTEGER PRIMARY KEY AUTOINCREMENT, sort_index INTEGER NOT NULL, text TEXT NOT NULL,
  gruppe TEXT NOT NULL, is_custom INTEGER DEFAULT 0, erstellt_am TEXT DEFAULT CURRENT_TIMESTAMP,
  gewichtung INTEGER DEFAULT 1);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE UNIQUE INDEX idx_ziele_unique ON ziele(lieferant, quartal);
"""

# Identisch zum Standard-Fragenkatalog der App (IDs 1..12)
FRAGEN = [
 ("Zusammenarbeit & Kommunikation", "Erreichbarkeit und Reaktionszeit bei Anfragen => zeitnah, verbindlich"),
 ("Zusammenarbeit & Kommunikation", "Qualität der Abstimmung mit Schnittstellen => klar, lösungsorientiert"),
 ("Zusammenarbeit & Kommunikation", "Proaktive Information bei Abweichungen => frühzeitig, transparent"),
 ("Entwicklung & Technik", "Fachliches Know-how => kompetent, problemlösungsorientiert"),
 ("Entwicklung & Technik", "Termintreue bei Arbeitspaketen => zuverlässig, planbar"),
 ("Entwicklung & Technik", "Qualität der gelieferten Arbeitsergebnisse => vollständig, fehlerarm"),
 ("Entwicklung & Technik", "Umgang mit Änderungen => flexibel, nachvollziehbar dokumentiert"),
 ("Entwicklung & Technik", "Einhaltung vereinbarter Standards und Vorgaben => konsequent"),
 ("Entwicklung & Technik", "Eigenständige Bearbeitung von Sonderthemen => zuverlässig"),
 ("Entwicklung & Technik", "Dokumentation und Nachvollziehbarkeit => vollständig, aktuell"),
 ("Qualität & Lieferung", "Umsetzung vereinbarter Maßnahmen => termingerecht, wirksam"),
 ("Qualität & Lieferung", "Liefer- und Anlieferqualität => einwandfrei, verlässlich"),
]
GRUPPEN = ["Zusammenarbeit & Kommunikation", "Entwicklung & Technik", "Qualität & Lieferung"]

SUPPLIERS = ["Muster GmbH", "Technik Nord AG", "Süd-Components GmbH",
             "Bauteile Becker", "Elektro Vogt KG", "Kunststoff Lehmann"]

# --- Quartale relativ zum heutigen Datum --------------------------------------
def quarter_of(d):
    return (d.month - 1) // 3 + 1

def quarter_start(y, q):
    return dt.date(y, 3 * (q - 1) + 1, 1)

def prev_quarter(y, q):
    return (y - 1, 4) if q == 1 else (y, q - 1)

def build_quarters(n=5):
    """Liefert [(datum, 'Qn JJJJ'), ...] für die letzten n Quartale, das letzte = aktuelles."""
    y, q = TODAY.year, quarter_of(TODAY)
    out = []
    for i in range(n):
        start = quarter_start(y, q)
        datum = start + dt.timedelta(days=45)             # Mitte des Quartals
        if i == 0:                                        # aktuelles Quartal: nicht in der Zukunft
            datum = max(start, min(datum, TODAY - dt.timedelta(days=3)))
        out.append((datum.isoformat(), f"Q{q} {y}"))
        y, q = prev_quarter(y, q)
    return list(reversed(out))

QUARTERS = build_quarters()
CUR_LABEL = QUARTERS[-1][1]
PREV_LABEL = QUARTERS[-2][1]
CUR_DATE = dt.date.fromisoformat(QUARTERS[-1][0])

def iso(d):
    return d.isoformat()

# Ziel-Scores je Lieferant je Quartal (None = in dem Quartal nicht bewertet)
TARGETS = {
 "Muster GmbH":        [82, 85, 88, 90, 92],   # stark, steigend -> Top-Performer
 "Technik Nord AG":    [74, 77, 76, 80, 79],   # gut
 "Süd-Components GmbH":[66, 60, 68, 63, 70],   # mittel, schwankend
 "Bauteile Becker":    [58, 52, 47, 44, 41],   # fallend -> kritisch (rot)
 "Elektro Vogt KG":    [38, 45, 55, 64, 73],   # Erholung rot -> grün
 "Kunststoff Lehmann": [69, 71, 68, 72, None], # aktuelles Quartal fehlt -> "fehlende Bewertung"
}
TEAM2_DELTA = {"Muster GmbH": -6, "Technik Nord AG": -4, "Süd-Components GmbH": 5,
               "Bauteile Becker": 8, "Elektro Vogt KG": -3, "Kunststoff Lehmann": 0}
ZIEL_WUNSCH = {"Muster GmbH": "erreicht", "Technik Nord AG": "knapp", "Süd-Components GmbH": "knapp",
               "Bauteile Becker": "verfehlt", "Elektro Vogt KG": "erreicht"}

# Maßnahmen: (lieferant, quartal_label, beschreibung, verantwortlich, faellig_am, status, erledigt_am)
MASSNAHMEN = [
 ("Bauteile Becker", CUR_LABEL, "Eskalationsgespräch zur Liefertreue vereinbaren", "M. Weber",
  iso(max(CUR_DATE, TODAY - dt.timedelta(days=6))), "ueberfaellig", None),
 ("Bauteile Becker", CUR_LABEL, "Maßnahmenplan zur Qualitätssteigerung anfordern", "S. Fischer",
  iso(TODAY + dt.timedelta(days=25)), "in_bearbeitung", None),
 ("Süd-Components GmbH", CUR_LABEL, "Quartalsreview-Termin abstimmen", "M. Weber",
  iso(TODAY + dt.timedelta(days=40)), "offen", None),
 ("Technik Nord AG", CUR_LABEL, "Kommunikationsschnittstelle optimieren", "M. Weber",
  iso(TODAY + dt.timedelta(days=55)), "offen", None),
 ("Süd-Components GmbH", PREV_LABEL, "Dokumentation der Prüfprozesse nachfordern", "S. Fischer",
  iso(CUR_DATE - dt.timedelta(days=60)), "erledigt", iso(CUR_DATE - dt.timedelta(days=63))),
 ("Elektro Vogt KG", QUARTERS[-3][1], "Verbesserungsplan zur Termintreue nachhalten", "M. Weber",
  iso(CUR_DATE - dt.timedelta(days=150)), "erledigt", iso(CUR_DATE - dt.timedelta(days=154))),
]
KURZTEXT = {"Bauteile Becker": "Liefertreue und Qualität kritisch – Eskalation eingeleitet.",
            "Süd-Components GmbH": "Quartalsreview und Prüfdokumentation offen.",
            "Technik Nord AG": "Kommunikationsschnittstelle wird optimiert."}

def build_answers(target):
    """Antworten so wählen, dass der Score nahe am Ziel liegt (12 Fragen, Gewichtung 1)."""
    target = max(2, min(99, target))
    if target >= 50:
        n_hi = round((target - 50) / 50 * 12)          # Anzahl "erfüllt" (100), Rest "teilweise" (50)
        vals = [100] * n_hi + [50] * (12 - n_hi)
    else:
        n_mid = round(target / 50 * 12)                # Anzahl "teilweise" (50), Rest "nicht erfüllt" (0)
        vals = [50] * n_mid + [0] * (12 - n_mid)
    random.shuffle(vals)
    ans = {str(i + 1): (2 if v == 100 else 1 if v == 50 else 0) for i, v in enumerate(vals)}
    return ans, round(sum(vals) / 12.0, 1)

def kommentare(score):
    if score >= 75:
        tenor = ("Sehr gute Abstimmung, kurze Reaktionszeiten.", "Überzeugende Qualität der Arbeitsergebnisse.", "Anlieferung durchgehend einwandfrei.")
    elif score >= 50:
        tenor = ("Solide Zusammenarbeit, teils verzögerte Rückmeldungen.", "Termintreue schwankt, Nacharbeit nötig.", "Anlieferqualität meist stabil.")
    else:
        tenor = ("Reaktionszeiten unzureichend, Eskalation nötig.", "Wiederholte Qualitätsmängel in Arbeitspaketen.", "Lieferprobleme mit Auswirkung auf die Planung.")
    return json.dumps(dict(zip(GRUPPEN, tenor)), ensure_ascii=False)

def build_db(path, team, delta):
    if os.path.exists(path):
        os.remove(path)
    db = sqlite3.connect(path)
    c = db.cursor()
    c.executescript(SCHEMA)
    # Stammdaten
    for g, t in FRAGEN:
        c.execute("INSERT INTO fragen(sort_index,text,gruppe,is_custom,gewichtung) "
                  "VALUES((SELECT COUNT(*) FROM fragen),?,?,0,1)", (t, g))
    for k, v in [("threshold_success", "75.0"), ("threshold_warning", "50.0"), ("dashboard_top_limit", "5"),
                 ("dashboard_recent_limit", "5"), ("dashboard_critical_limit", "10"), ("backup_retention_days", "30")]:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?)", (k, v))
    first_day = iso(dt.date.fromisoformat(QUARTERS[0][0]) - dt.timedelta(days=40))
    for u, ia, role in [("admin", 1, "admin"), ("m.weber", 0, "member"), ("s.fischer", 0, "controlling")]:
        c.execute("INSERT INTO users(username,password_hash,is_admin,role,active,erstellt_am) VALUES(?,?,?,?,1,?)",
                  (u, PWHASH, ia, role, first_day + " 08:00:00"))
    c.execute("INSERT INTO se_teams(name) VALUES(?)", (team,))
    sup_id = {}
    for s in SUPPLIERS:
        c.execute("INSERT INTO lieferanten(name) VALUES(?)", (s,))
        sup_id[s] = c.lastrowid
    # Bewertungen
    bew_id, cur_score = {}, {}
    for s in SUPPLIERS:
        for qi, (datum, qlabel) in enumerate(QUARTERS):
            tgt = TARGETS[s][qi]
            if tgt is None:
                continue
            tgt = max(5, min(99, tgt + delta[s]))
            ans, erg = build_answers(tgt)
            mass_text = KURZTEXT.get(s, "") if qlabel == CUR_LABEL else ""
            c.execute("""INSERT INTO bewertungen(lieferant,se_team,datum,antworten,ergebnis,erstellt_am,
                         kommentare_json,bestellnummer,massnahmen,created_by,lieferant_id,se_team_id)
                         VALUES(?,?,?,?,?,?,?,?,?,?,?,1)""",
                      (s, team, datum, json.dumps(ans), erg, datum + " 09:30:00", kommentare(erg),
                       f"BST-{datum[:4]}-{1000 + sup_id[s] * 7 + qi}", mass_text, "admin", sup_id[s]))
            bew_id[(s, qlabel)] = c.lastrowid
            if qlabel == CUR_LABEL:
                cur_score[s] = erg
    # Maßnahmen
    for s, ql, besch, verant, faellig, status, erledigt in MASSNAHMEN:
        if (s, ql) not in bew_id:
            continue
        c.execute("""INSERT INTO massnahmen(bewertung_id,beschreibung,verantwortlich,faellig_am,status,erledigt_am,erstellt_am,erstellt_von)
                     VALUES(?,?,?,?,?,?,?,?)""",
                  (bew_id[(s, ql)], besch, verant, faellig, status, erledigt, iso(CUR_DATE) + " 10:00:00", "m.weber"))
    # Ziele (aktuelles Quartal mit gewünschter Ampel + Vorquartal als Historie)
    for s in SUPPLIERS:
        a = cur_score.get(s)
        if a is None:
            zw = 75.0                                                   # ohne Bewertung
        else:
            w = ZIEL_WUNSCH.get(s, "knapp")
            zw = round(a) - 3 if w == "erreicht" else round(a) + 3 if w == "knapp" else round(a) + 12
        for ql, zwert, erstellt in [(CUR_LABEL, float(zw), iso(CUR_DATE - dt.timedelta(days=40))),
                                    (PREV_LABEL, 75.0, iso(CUR_DATE - dt.timedelta(days=130)))]:
            c.execute("""INSERT INTO ziele(lieferant,se_team,quartal,zielwert,beschreibung,erstellt_am,erstellt_von,lieferant_id,se_team_id)
                         VALUES(?,?,?,?,?,?,?,?,1)""",
                      (s, team, ql, zwert, "Quartalsziel Gesamtbewertung", erstellt + " 08:00:00", "admin", sup_id[s]))
    # Audit-Log
    audit = [
     (1, "admin", "LOGIN_SUCCESS", "session", None, "Erfolgreicher Login", 1, None),
     (1, "admin", "CREATE", "bewertung", 1, "Bewertung erfasst: Muster GmbH", 1, None),
     (1, "admin", "CREATE", "ziele", 1, f"Ziel erstellt: {CUR_LABEL}", 1, None),
     (1, "admin", "CREATE", "user", 2, "Benutzer: m.weber | Rolle: member", 1, None),
     (2, "m.weber", "LOGIN_SUCCESS", "session", None, "Erfolgreicher Login", 1, None),
     (2, "m.weber", "CREATE", "massnahme", 1, "Maßnahme angelegt: Bauteile Becker", 1, None),
     (1, "admin", "EXPORT_PDF", "export", None, "PDF exportiert: Bewertung_Muster_GmbH.pdf", 1, None),
     (None, "unbekannt", "LOGIN_FAILED", "session", None, "Ungültiges Passwort", 0, "Invalid password"),
    ]
    for i, (uid, un, ac, et, eid, det, ok, err) in enumerate(audit):
        ts = (TODAY - dt.timedelta(days=9 - i)).isoformat() + f" {9 + i:02d}:15:00"
        c.execute("""INSERT INTO audit_log(user_id,username,action,entity_type,entity_id,details,timestamp,success,error_message)
                     VALUES(?,?,?,?,?,?,?,?,?)""", (uid, un, ac, et, eid, det, ts, ok, err))
    db.commit()
    db.close()
    return cur_score

if __name__ == "__main__":
    print(f"Quartale: {', '.join(q for _, q in QUARTERS)}  (aktuell: {CUR_LABEL})")
    for fname, team in [("demo-team-nord.db", "Team Nord"), ("demo-team-sued.db", "Team Süd")]:
        scores = build_db(os.path.join(HERE, fname), team,
                          {s: 0 for s in SUPPLIERS} if team == "Team Nord" else TEAM2_DELTA)
        print(f"  {fname:22s} ({team}): {CUR_LABEL} = "
              + ", ".join(f"{s.split()[0]} {scores.get(s, '-')}" for s in SUPPLIERS))
    print("Fertig.")
