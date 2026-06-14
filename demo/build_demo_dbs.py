#!/usr/bin/env python3
"""
Erzeugt zwei gefüllte Demo-Datenbanken für SEVALSystem (Screenshots & Cross-DB-Vergleich).
Beide enthalten dieselben Lieferanten, aber unterschiedliche SE-Teams und Bewertungen.

Die DBs enthalten KEINE echten Daten und werden durch die .gitignore (*.db) nicht eingecheckt.
Login in der App:  admin / admin123   (auch m.weber / s.kontroll, gleiches Passwort)

Erneut erzeugen:  python3 demo/build_demo_dbs.py
"""
import os, json, random, sqlite3, bcrypt

random.seed(42)
HERE = os.path.dirname(os.path.abspath(__file__))
PWHASH = bcrypt.hashpw(b"admin123", bcrypt.gensalt(rounds=10)).decode()

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

FRAGEN = [  # (gruppe, text) -> ids werden 1..12, identisch zum App-Seed
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
QUARTERS = [("2025-05-15","Q2 2025"), ("2025-08-15","Q3 2025"), ("2025-11-14","Q4 2025"),
            ("2026-02-16","Q1 2026"), ("2026-05-20","Q2 2026")]  # letzte = aktuelles Quartal
# Ziel-Scores je Lieferant je Quartal (None = in dem Quartal nicht bewertet)
TARGETS = {
 "Muster GmbH":        [82,85,88,90,92],   # stark, steigend -> Top-Performer
 "Technik Nord AG":    [74,77,76,80,79],   # gut
 "Süd-Components GmbH":[66,60,68,63,70],   # mittel, schwankend
 "Bauteile Becker":    [58,52,47,44,41],   # fallend -> kritisch (rot)
 "Elektro Vogt KG":    [38,45,55,64,73],   # Erholung rot -> grün
 "Kunststoff Lehmann": [69,71,68,72,None], # aktuelles Quartal fehlt -> "fehlende Bewertung"
}
TEAM2_DELTA = {"Muster GmbH":-6,"Technik Nord AG":-4,"Süd-Components GmbH":5,
               "Bauteile Becker":8,"Elektro Vogt KG":-3,"Kunststoff Lehmann":0}
ZIEL_WUNSCH = {"Muster GmbH":"erreicht","Technik Nord AG":"knapp","Süd-Components GmbH":"knapp",
               "Bauteile Becker":"verfehlt","Elektro Vogt KG":"erreicht"}
# Maßnahmen: (lieferant, quartal_label, beschreibung, verantwortlich, faellig_am, status, erledigt_am)
MASSNAHMEN = [
 ("Bauteile Becker","Q2 2026","Eskalationsgespräch zur Liefertreue vereinbaren","M. Weber","2026-05-30","ueberfaellig",None),
 ("Bauteile Becker","Q2 2026","Maßnahmenplan zur Qualitätssteigerung anfordern","S. Kontroll","2026-06-30","in_bearbeitung",None),
 ("Süd-Components GmbH","Q2 2026","Quartalsreview-Termin abstimmen","M. Weber","2026-07-15","offen",None),
 ("Süd-Components GmbH","Q1 2026","Dokumentation der Prüfprozesse nachfordern","S. Kontroll","2026-03-20","erledigt","2026-03-18"),
 ("Elektro Vogt KG","Q4 2025","Verbesserungsplan zur Termintreue nachhalten","M. Weber","2026-01-31","erledigt","2026-01-28"),
 ("Technik Nord AG","Q2 2026","Kommunikationsschnittstelle optimieren","M. Weber","2026-08-01","offen",None),
]
KURZTEXT = {"Bauteile Becker":"Liefertreue und Qualität kritisch – Eskalation eingeleitet.",
            "Süd-Components GmbH":"Quartalsreview und Prüfdokumentation offen.",
            "Technik Nord AG":"Kommunikationsschnittstelle wird optimiert."}

def build_answers(target):
    # Antworten aus passenden Anteilen von 100/50/0-Punkten konstruieren, damit der
    # Score nahe am Ziel liegt; Reihenfolge mischen -> variierende Kategorie-Scores.
    target = max(2, min(99, target))
    if target >= 50:
        n_hi = round((target - 50) / 50 * 12)          # Anzahl "erfüllt" (100), Rest "teilweise" (50)
        vals = [100] * n_hi + [50] * (12 - n_hi)
    else:
        n_mid = round(target / 50 * 12)                # Anzahl "teilweise" (50), Rest "nicht erfüllt" (0)
        vals = [50] * n_mid + [0] * (12 - n_mid)
    random.shuffle(vals)
    ans = {str(i + 1): (2 if v == 100 else 1 if v == 50 else 0) for i, v in enumerate(vals)}
    return ans, round(sum(vals) / 12.0, 1)   # = achieved/(12*100)*100

def kommentare(score):
    if score >= 75: tenor = ("sehr gute Abstimmung","überzeugende Qualität","Anlieferung einwandfrei")
    elif score >= 50: tenor = ("solide Zusammenarbeit","Termintreue schwankt","Anlieferqualität meist stabil")
    else: tenor = ("Reaktionszeiten unzureichend","Qualitätsmängel häufiger","Lieferprobleme aufgetreten")
    return json.dumps({GRUPPEN[0]:tenor[0], GRUPPEN[1]:tenor[1], GRUPPEN[2]:tenor[2]}, ensure_ascii=False)

def build_db(path, team, delta):
    if os.path.exists(path): os.remove(path)
    db = sqlite3.connect(path); c = db.cursor()
    c.executescript(SCHEMA)
    # Stammdaten
    for g, t in FRAGEN: c.execute("INSERT INTO fragen(sort_index,text,gruppe,is_custom,gewichtung) VALUES((SELECT COUNT(*) FROM fragen),?,?,0,1)", (t, g))
    for k, v in [("threshold_success","75.0"),("threshold_warning","50.0"),("dashboard_top_limit","5"),
                 ("dashboard_recent_limit","5"),("dashboard_critical_limit","10"),("backup_retention_days","30")]:
        c.execute("INSERT INTO settings(key,value) VALUES(?,?)", (k, v))
    for u, ia, role in [("admin",1,"admin"),("m.weber",0,"member"),("s.kontroll",0,"controlling")]:
        c.execute("INSERT INTO users(username,password_hash,is_admin,role,active,erstellt_am) VALUES(?,?,?,?,1,'2025-04-01 08:00:00')",
                  (u, PWHASH, ia, role))
    c.execute("INSERT INTO se_teams(name) VALUES(?)", (team,))
    sup_id = {}
    for s in SUPPLIERS:
        c.execute("INSERT INTO lieferanten(name) VALUES(?)", (s,)); sup_id[s] = c.lastrowid
    # Bewertungen
    bew_id = {}   # (supplier, qlabel) -> id ;  q2_score[supplier] = ergebnis Q2 2026
    q2_score = {}
    for s in SUPPLIERS:
        for qi, (datum, qlabel) in enumerate(QUARTERS):
            tgt = TARGETS[s][qi]
            if tgt is None: continue
            tgt = max(5, min(99, tgt + delta[s]))
            ans, erg = build_answers(tgt)
            mass_text = KURZTEXT.get(s, "") if qlabel == "Q2 2026" else ""
            c.execute("""INSERT INTO bewertungen(lieferant,se_team,datum,antworten,ergebnis,erstellt_am,
                         kommentare_json,bestellnummer,massnahmen,created_by,lieferant_id,se_team_id)
                         VALUES(?,?,?,?,?,?,?,?,?,?,?,1)""",
                      (s, team, datum, json.dumps(ans), erg, datum+" 09:30:00", kommentare(erg),
                       f"BSt-{2025+qi%2}-{1000+sup_id[s]*7+qi}", mass_text, "admin", sup_id[s]))
            bew_id[(s, qlabel)] = c.lastrowid
            if qlabel == "Q2 2026": q2_score[s] = erg
    # Maßnahmen
    for s, ql, besch, verant, faellig, status, erledigt in MASSNAHMEN:
        if (s, ql) not in bew_id: continue
        c.execute("""INSERT INTO massnahmen(bewertung_id,beschreibung,verantwortlich,faellig_am,status,erledigt_am,erstellt_am,erstellt_von)
                     VALUES(?,?,?,?,?,?,?,?)""",
                  (bew_id[(s, ql)], besch, verant, faellig, status, erledigt, "2026-05-21 10:00:00", "m.weber"))
    # Ziele (Q2 2026 mit erzwungener Ampel + Q1 2026 als Historie)
    for s in SUPPLIERS:
        a = q2_score.get(s)
        if s == "Kunststoff Lehmann" or a is None:
            zw = 75.0  # ohne aktuelle Bewertung -> "ohne Bewertung"
        else:
            w = ZIEL_WUNSCH.get(s, "knapp")
            zw = round(a)-3 if w=="erreicht" else round(a)+3 if w=="knapp" else round(a)+12
        c.execute("""INSERT INTO ziele(lieferant,se_team,quartal,zielwert,beschreibung,erstellt_am,erstellt_von,lieferant_id,se_team_id)
                     VALUES(?,?,?,?,?,?,?,?,1)""",
                  (s, team, "Q2 2026", float(zw), "Quartalsziel Gesamtbewertung", "2026-04-05 08:00:00", "admin", sup_id[s]))
        c.execute("""INSERT INTO ziele(lieferant,se_team,quartal,zielwert,beschreibung,erstellt_am,erstellt_von,lieferant_id,se_team_id)
                     VALUES(?,?,?,?,?,?,?,?,1)""",
                  (s, team, "Q1 2026", 75.0, "Quartalsziel Gesamtbewertung", "2026-01-05 08:00:00", "admin", sup_id[s]))
    # Audit-Log
    audit = [
     (1,"admin","LOGIN_SUCCESS","session",None,"Erfolgreicher Login",1,None),
     (1,"admin","CREATE","bewertung",1,"Bewertung erfasst: Muster GmbH",1,None),
     (1,"admin","CREATE","ziele",1,"Ziel erstellt: Q2 2026",1,None),
     (1,"admin","CREATE","user",2,"Benutzer: m.weber | Rolle: member",1,None),
     (2,"m.weber","LOGIN_SUCCESS","session",None,"Erfolgreicher Login",1,None),
     (2,"m.weber","CREATE","massnahme",1,"Maßnahme angelegt: Bauteile Becker",1,None),
     (1,"admin","EXPORT_PDF","export",None,"PDF exportiert: Bewertung_MusterGmbH.pdf",1,None),
     (None,"unbekannt","LOGIN_FAILED","session",None,"Ungültiges Passwort",0,"Invalid password"),
    ]
    for i,(uid,un,ac,et,eid,det,ok,err) in enumerate(audit):
        c.execute("""INSERT INTO audit_log(user_id,username,action,entity_type,entity_id,details,timestamp,success,error_message)
                     VALUES(?,?,?,?,?,?,?,?,?)""",
                  (uid,un,ac,et,eid,det,f"2026-06-{10+i//2:02d} {9+i}:15:00",ok,err))
    db.commit(); db.close()
    return q2_score

os.makedirs(HERE, exist_ok=True)
for fname, team in [("demo-team-nord.db","Team Nord"), ("demo-team-sued.db","Team Süd")]:
    q2 = build_db(os.path.join(HERE, fname), team,
                  {s:0 for s in SUPPLIERS} if team=="Team Nord" else TEAM2_DELTA)
    print(f"  {fname:22s} ({team}): Q2/2026 = " + ", ".join(f"{s.split()[0]} {q2.get(s,'-')}" for s in SUPPLIERS))
print("Fertig.")
