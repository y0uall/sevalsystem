# Dokumentation der Berechnungslogik (SEVALSystem)

Dieses Dokument erklärt, wie die Bewertungsergebnisse in SEVALSystem berechnet werden. Es dient dazu, Transparenz zu schaffen, insbesondere wenn **Gewichtungen** verwendet werden und das Gesamtergebnis auf den ersten Blick unintuitiv erscheint.

## 1. Das Punktesystem

Jede Antwort gibt basierend auf dem Erfüllungsgrad eine Basis-Punktzahl:

*   **Erfüllt:** 100 Punkte
*   **Teilweise:** 50 Punkte
*   **Nicht erfüllt:** 0 Punkte
*   **Keine Angabe:** Frage wird ignoriert (zählt nicht zur Maximalpunktzahl)

## 2. Einfluss der Gewichtung

Die Gewichtung (1 bis 10) ist ein **Multiplikator**. Sie bestimmt, wie viele Punkte eine Frage maximal wert ist.

*   **Gewichtung 1 (Standard):** Maximal 100 Punkte.
*   **Gewichtung 2:** Maximal 200 Punkte.
*   **Gewichtung 5:** Maximal 500 Punkte.
*   **Gewichtung 10:** Maximal 1000 Punkte.

**Formel pro Frage:**
$$ \text{Erreichte Punkte} = \text{Basis-Punkte} \times \text{Gewichtung} $$
$$ \text{Mögliche Punkte} = 100 \times \text{Gewichtung} $$

---

## 3. Berechnung des Gesamtergebnisses

Das wichtigste Prinzip lautet: **Das Gesamtergebnis ist NICHT der Durchschnitt der Gruppenprozente.**

Stattdessen werden **alle Punkte in einen Topf geworfen**. Das Gesamtergebnis ist das Verhältnis von *allen erreichten Punkten* zu *allen möglichen Punkten*.

### Die Formel

$$ \text{Gesamtergebnis} = \frac{\text{Summe ALLER erreichten Punkte}}{\text{Summe ALLER möglichen Punkte}} \times 100 $$

### Warum ist das wichtig?

Wenn eine Gruppe Fragen mit **hoher Gewichtung** enthält, repräsentiert diese Gruppe einen größeren Anteil am "Gesamtkuchen" (den Gesamtpunkten). Ein schlechtes Ergebnis in einer hoch gewichteten Gruppe zieht das Gesamtergebnis stärker nach unten als ein schlechtes Ergebnis in einer niedrig gewichteten Gruppe.

---

## 4. Rechenbeispiel (Szenario aus der Praxis)

Ein Benutzer wundert sich über folgendes Ergebnis:
*   **Gruppe A:** 64,3% (wegen Gewichtung)
*   **Gruppe B:** 100%
*   **Gruppe C:** 100%
*   **Gesamtergebnis:** **84,4%** (und nicht 88,1%, was der Durchschnitt wäre)

**So kommt dieses Ergebnis zustande:**

Nehmen wir an, die Punkte verteilen sich wie folgt:

1.  **Gruppe A (Die "schwere" Gruppe):**
    *   Enthält Fragen mit hoher Gewichtung.
    *   Mögliche Punkte: **700**
    *   Erreichte Punkte: **450**
    *   Gruppenergebnis: $450 / 700 = \mathbf{64,3\%}$

2.  **Gruppe B (Standard):**
    *   Mögliche Punkte: **500**
    *   Erreichte Punkte: **500**
    *   Gruppenergebnis: $500 / 500 = \mathbf{100\%}$

3.  **Gruppe C (Standard):**
    *   Mögliche Punkte: **400**
    *   Erreichte Punkte: **400**
    *   Gruppenergebnis: $400 / 400 = \mathbf{100\%}$

**Gesamtrechnung:**

*   **Erreichte Punkte Gesamt:** $450 + 500 + 400 = \mathbf{1350}$
*   **Mögliche Punkte Gesamt:** $700 + 500 + 400 = \mathbf{1600}$

$$ \text{Gesamt} = \frac{1350}{1600} = 0,84375 \approx \mathbf{84,4\% } $$

**Fazit:**
Da Gruppe A fast die Hälfte aller möglichen Punkte ausmacht (700 von 1600), "wiegt" ihr schlechteres Ergebnis (64,3%) viel schwerer als die perfekten Ergebnisse der kleineren Gruppen. Das System rechnet also mathematisch korrekt.
