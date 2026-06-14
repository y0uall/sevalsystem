
// Mock data structures
const fragen = [
    { id: 1, text: "Frage 1 (Gewicht 1)", gruppe: "A", gewichtung: 1 },
    { id: 2, text: "Frage 2 (Gewicht 2)", gruppe: "A", gewichtung: 2 },
    { id: 3, text: "Frage 3 (Kein Gewicht -> 1)", gruppe: "B" }, // Missing weight should default to 1
    { id: 4, text: "Frage 4 (Gewicht 3)", gruppe: "B", gewichtung: 3 },
];

const antworten = {
    1: 2, // Erfüllt (100%) * 1 = 100 / 100
    2: 1, // Teilweise (50%) * 2 = 100 / 200
    3: 2, // Erfüllt (100%) * 1 = 100 / 100
    4: 0, // Nicht Erfüllt (0%) * 3 = 0 / 300
    // Total Score: 100 + 100 + 100 + 0 = 300
    // Total Max: 100 + 200 + 100 + 300 = 700
    // Expected Result: 300/700 * 100 = 42.857...%
};

// ---------------------------------------------------------
// 1. Test Main App Calculation Logic (updateResult)
// ---------------------------------------------------------
function testMainAppCalculation() {
    console.log("--- Testing Main App Calculation ---");
    let totalScore = 0;
    let totalMaxScore = 0;

    fragen.forEach(f => {
        const answer = antworten[f.id];
        const weight = f.gewichtung || 1; // Default weight 1 if missing

        if (answer !== undefined && answer !== -1) {
            // Max points for this question = 100 * weight
            totalMaxScore += 100 * weight;

            if (answer === 2) { // Erfüllt
                totalScore += 100 * weight;
            } else if (answer === 1) { // Teilweise
                totalScore += 50 * weight;
            }
            // answer 0 (Nicht erfüllt) adds 0 to score
        }
    });

    const percentage = totalMaxScore > 0 ? (totalScore / totalMaxScore) * 100 : 0;
    console.log(`Total Score: ${totalScore}`);
    console.log(`Total Max Score: ${totalMaxScore}`);
    console.log(`Percentage: ${percentage.toFixed(4)}%`);
    
    const expected = (300 / 700) * 100;
    if (Math.abs(percentage - expected) < 0.0001) {
        console.log("✅ Main App Calculation: PASSED");
    } else {
        console.error(`❌ Main App Calculation: FAILED. Expected ${expected}, got ${percentage}`);
    }
    console.log("");
}

// ---------------------------------------------------------
// 2. Test PDF Export Calculation Logic (generatePdf)
// ---------------------------------------------------------
function testPdfExportCalculation() {
    console.log("--- Testing PDF Export Calculation (Groups) ---");
    
    // Initialize groups
    const groups = {};
    fragen.forEach(f => {
        if (!groups[f.gruppe]) {
            groups[f.gruppe] = { total: 0, score: 0, count: 0 };
        }
    });

    // Simulate currentPdfBewertung
    const currentPdfBewertung = { antworten: antworten };

    fragen.forEach((f, idx) => {
        // Mocking the get answer logic
        const answer = currentPdfBewertung.antworten[f.id];
        
        const weight = f.gewichtung || 1;

        if (answer !== undefined && answer !== -1) {
            groups[f.gruppe].count++;
            groups[f.gruppe].total += 100 * weight;
            if (answer === 2) groups[f.gruppe].score += 100 * weight;
            else if (answer === 1) groups[f.gruppe].score += 50 * weight;
        }
    });

    // Verify Group A
    // Q1 (W=1): 2 (100%) -> 100/100
    // Q2 (W=2): 1 (50%)  -> 100/200
    // Group A Total: 200/300 = 66.666%
    const groupA = groups["A"];
    const groupAPercent = (groupA.score / groupA.total) * 100;
    console.log(`Group A Score: ${groupA.score}/${groupA.total} (${groupAPercent.toFixed(4)}%)`);
    
    const expectedA = (200 / 300) * 100;
    if (Math.abs(groupAPercent - expectedA) < 0.0001) {
        console.log("✅ Group A Calculation: PASSED");
    } else {
        console.error(`❌ Group A Calculation: FAILED. Expected ${expectedA}, got ${groupAPercent}`);
    }

    // Verify Group B
    // Q3 (W=1 default): 2 (100%) -> 100/100
    // Q4 (W=3): 0 (0%) -> 0/300
    // Group B Total: 100/400 = 25.0%
    const groupB = groups["B"];
    const groupBPercent = (groupB.score / groupB.total) * 100;
    console.log(`Group B Score: ${groupB.score}/${groupB.total} (${groupBPercent.toFixed(4)}%)`);

    const expectedB = 25.0;
    if (Math.abs(groupBPercent - expectedB) < 0.0001) {
        console.log("✅ Group B Calculation: PASSED");
    } else {
        console.error(`❌ Group B Calculation: FAILED. Expected ${expectedB}, got ${groupBPercent}`);
    }
    console.log("");
}

// Run tests
testMainAppCalculation();
testPdfExportCalculation();
