const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const Database = require('better-sqlite3');
const { GoogleGenAI } = require('@google/genai');
const { Vonage } = require('@vonage/server-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// --- SQLITE DATABASE INITIALIZATION ---
const db = new Database(path.join(DATA_DIR, 'livestock.db'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        timestamp TEXT,
        reporterName TEXT,
        reporterPhone TEXT,
        fullAddress TEXT,
        village TEXT,
        district TEXT,
        species TEXT,
        animalTag TEXT,
        animalAge TEXT,
        notes TEXT,
        imageUrl TEXT,
        symptoms TEXT,
        affectedCount INTEGER,
        mortalityCount INTEGER,
        latitude REAL,
        longitude REAL,
        nearestVet TEXT,
        aiReport TEXT
    );

    CREATE TABLE IF NOT EXISTS alerts (
        alertId TEXT PRIMARY KEY,
        reportId TEXT,
        location TEXT,
        disease TEXT,
        severity TEXT,
        isZoonotic INTEGER,
        advisories TEXT,
        timestamp TEXT,
        status TEXT
    );

    CREATE TABLE IF NOT EXISTS herds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag TEXT,
        species TEXT,
        owner TEXT,
        village TEXT,
        date TEXT,
        problem TEXT,
        symptoms TEXT,
        notes TEXT,
        imageUrl TEXT
    );

    CREATE TABLE IF NOT EXISTS vaccinations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag TEXT,
        species TEXT,
        owner TEXT,
        village TEXT,
        district TEXT,
        vaccineName TEXT,
        status TEXT,
        date TEXT,
        nextDue TEXT
    );

    CREATE TABLE IF NOT EXISTS labs (
        sampleId TEXT PRIMARY KEY,
        reportId TEXT,
        sampleType TEXT,
        labName TEXT,
        paravetName TEXT,
        status TEXT,
        result TEXT,
        createdAt TEXT,
        updatedAt TEXT
    );
`);

// --- SEED PERMANENT BASELINE DATA IF DB IS EMPTY ---
const countReports = db.prepare('SELECT COUNT(*) as count FROM reports').get().count;
if (countReports === 0) {
    const defaultTime = new Date().toISOString();
    
    // Seed Sample Report 1 (FMD)
    db.prepare(`
        INSERT INTO reports (
            id, timestamp, reporterName, reporterPhone, fullAddress, village, district, 
            species, animalTag, animalAge, notes, imageUrl, symptoms, affectedCount, mortalityCount, 
            latitude, longitude, nearestVet, aiReport
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'CASE-2026-104921',
        defaultTime,
        'Ramesh Kumar',
        '9616958410',
        'Muradnagar Block, Ghaziabad',
        'Muradnagar',
        'Ghaziabad',
        'Cattle (Cow)',
        'IND-2026-8801',
        '4 Years',
        'Observed mouth blisters and salivation in 3 cows.',
        null,
        JSON.stringify(['blisters', 'salivation', 'high_fever']),
        3,
        0,
        28.6692,
        77.4538,
        JSON.stringify({
            name: 'Senior Veterinary Medical Officer',
            clinic: 'Government Veterinary Hospital - Muradnagar',
            phone: '1962 / +91-11-23384190',
            address: 'Block Road, Muradnagar, Ghaziabad',
            distanceKm: '1.8'
        }),
        JSON.stringify({
            identifiedSpecies: 'Cattle (Cow / Bovine)',
            visualFindings: 'Vesicular lesions on oral mucosa and interdigital spaces.',
            suspectedProblem: 'Foot and Mouth Disease (FMD)',
            confidenceScore: 94,
            severity: 'HIGH',
            isZoonotic: false,
            temporarySolution: 'Apply 1:1000 potassium permanganate solution wash to mouth and foot lesions.',
            aftercareProcedure: 'Isolate affected cattle, provide soft green fodder, and sanitize stalls daily.',
            caseStatus: 'Under Investigation'
        })
    );

    // Seed Sample Report 2 (LSD)
    db.prepare(`
        INSERT INTO reports (
            id, timestamp, reporterName, reporterPhone, fullAddress, village, district, 
            species, animalTag, animalAge, notes, imageUrl, symptoms, affectedCount, mortalityCount, 
            latitude, longitude, nearestVet, aiReport
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'CASE-2026-108432',
        new Date(Date.now() - 3600000).toISOString(),
        'Suresh Patel',
        '9616958410',
        'Modinagar Sector 3, Ghaziabad',
        'Modinagar',
        'Ghaziabad',
        'Buffalo',
        'IND-2026-9042',
        '3 Years',
        'Multiple nodular skin lesions across body with high temperature.',
        null,
        JSON.stringify(['skin_nodules', 'high_fever']),
        2,
        0,
        28.8315,
        77.5818,
        JSON.stringify({
            name: 'Block Veterinary Officer',
            clinic: 'Civil Veterinary Hospital - Modinagar',
            phone: '1962',
            address: 'Station Road, Modinagar',
            distanceKm: '2.1'
        }),
        JSON.stringify({
            identifiedSpecies: 'Buffalo (Bubalus bubalis)',
            visualFindings: 'Circular cutaneous nodules across dermal layers.',
            suspectedProblem: 'Lumpy Skin Disease (LSD)',
            confidenceScore: 91,
            severity: 'HIGH',
            isZoonotic: false,
            temporarySolution: 'Apply turmeric and neem paste locally; isolate from herd.',
            aftercareProcedure: 'Vector control spraying with permethrin.',
            caseStatus: 'Under Investigation'
        })
    );

    // Seed Alert
    db.prepare(`
        INSERT INTO alerts (alertId, reportId, location, disease, severity, isZoonotic, advisories, timestamp, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        'ALT-' + Date.now(),
        'CASE-2026-104921',
        'Muradnagar, Ghaziabad',
        'Foot and Mouth Disease (FMD)',
        'HIGH',
        0,
        JSON.stringify({
            en: 'Advisory for Muradnagar: Suspected Foot & Mouth Disease. Quarantine livestock & call 1962.',
            hi: 'मुरादनगर के लिए चेतावनी: खुरपका-मुंहपका रोग का संदेह।'
        }),
        defaultTime,
        'ACTIVE'
    );

    // Seed Herd
    db.prepare(`
        INSERT INTO herds (tag, species, owner, village, date, problem, symptoms, notes, imageUrl)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('IND-2026-8801', 'Cattle (Cow)', 'Ramesh Kumar', 'Muradnagar', defaultTime, 'Foot and Mouth Disease (FMD)', JSON.stringify(['blisters', 'salivation']), 'Field triage completed', null);

    // Seed Lab Specimen
    db.prepare(`
        INSERT INTO labs (sampleId, reportId, sampleType, labName, paravetName, status, result, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('SAM-109204', 'CASE-2026-104921', 'Oral Vesicular Swab', 'State Animal Disease Diagnostic Lab (ADDL)', 'Dr. Patel', 'SAMPLE_COLLECTED', 'PENDING', defaultTime, defaultTime);
}

// --- VONAGE SMS CONFIGURATION ---
const VONAGE_API_KEY = process.env.VONAGE_API_KEY || "1dc4d160";
const VONAGE_API_SECRET = process.env.VONAGE_API_SECRET || "OVpy1XF19lsIFm7c";

const vonage = new Vonage({
    apiKey: VONAGE_API_KEY,
    apiSecret: VONAGE_API_SECRET
});

// --- REAL VONAGE SMS DISPATCHER ---
async function sendSMSAlert(toPhone, messageBody) {
    if (!toPhone) return { success: false, reason: 'No phone number provided' };

    const cleanPhone = toPhone.trim().replace(/[^0-9]/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
        console.warn(`[SMS SKIPPED] Invalid Indian mobile format: ${toPhone}`);
        return { success: false, reason: 'Invalid phone format' };
    }

    const recipient = '91' + cleanPhone;

    try {
        const response = await vonage.sms.send({
            to: recipient,
            from: "PashuRakshak",
            text: messageBody.slice(0, 150)
        });

        const msgData = response.messages[0];
        if (msgData.status === "0") {
            console.log(`[VONAGE REAL SMS DELIVERED] Message sent to ${recipient} (Msg ID: ${msgData['message-id']})`);
            return { success: true, provider: 'Vonage', messageId: msgData['message-id'] };
        } else {
            console.warn(`[VONAGE SMS FAILED] Status ${msgData.status}: ${msgData['error-text']}`);
            return { success: false, error: msgData['error-text'] };
        }
    } catch (err) {
        console.error(`[VONAGE API EXCEPTION]:`, err.message);
        return { success: false, error: err.message };
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `cattle_${Date.now()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

async function fetchRealNearestVet(lat, lng, villageName, districtName) {
    try {
        const overpassQuery = `
            [out:json][timeout:10];
            (
              node["amenity"="veterinary"](around:20000, ${lat}, ${lng});
              way["amenity"="veterinary"](around:20000, ${lat}, ${lng});
              node["healthcare"="veterinarian"](around:20000, ${lat}, ${lng});
            );
            out center;
        `;
        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
        const response = await fetch(url, { headers: { 'User-Agent': 'PashuRakshakSurveillance/2.0' } });
        const data = await response.json();

        if (data && data.elements && data.elements.length > 0) {
            let bestMatch = null;
            let shortestDist = Infinity;

            data.elements.forEach(el => {
                const elLat = el.lat || (el.center ? el.center.lat : null);
                const elLon = el.lon || (el.center ? el.center.lon : null);
                if (elLat && elLon) {
                    const dist = calculateDistance(lat, lng, elLat, elLon);
                    if (dist < shortestDist) {
                        shortestDist = dist;
                        const tags = el.tags || {};
                        bestMatch = {
                            isRealMapData: true,
                            name: tags.operator || tags.doctor || 'Senior Veterinary Medical Officer',
                            clinic: tags.name || 'Government Veterinary Hospital / Clinic',
                            phone: tags.phone || tags['contact:phone'] || '1962 (National Animal Helpline)',
                            address: tags['addr:street'] ? `${tags['addr:street']}, ${districtName || ''}` : `Nearby Block Clinic (${elLat.toFixed(4)}, ${elLon.toFixed(4)})`,
                            latitude: elLat,
                            longitude: elLon,
                            distanceKm: dist.toFixed(1)
                        };
                    }
                }
            });
            if (bestMatch) return bestMatch;
        }
    } catch (err) {
        console.warn('Overpass lookup fallback:', err.message);
    }

    return {
        isRealMapData: false,
        name: `Chief Veterinary Officer (${districtName || 'District HQ'})`,
        clinic: `Government Block Animal Dispensary - ${villageName || 'Local Area'}`,
        phone: "1962 / +91-11-23384190",
        address: `Main Block Development Office, ${villageName || ''}, ${districtName || ''}`,
        latitude: lat + 0.012,
        longitude: lng + 0.015,
        distanceKm: "2.4"
    };
}

async function analyzeWithGoogleAI(report, imagePath) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `You are a chief veterinary clinical diagnostic AI.
Analyze this livestock case:
- Species: ${report.species}
- Symptoms: ${(report.symptoms || []).join(', ')}
- Field Notes: "${report.notes || 'None'}"
- Location: ${report.village}, ${report.district}

Return STRICT JSON:
{
  "identifiedSpecies": "Verified species & breed",
  "visualFindings": "Visual abnormalities and clinical signs detected",
  "suspectedProblem": "Primary diagnosed condition (e.g. FMD Suspected, Lumpy Skin Disease, Anthrax, HS, BQ, PPR)",
  "confidenceScore": 92,
  "severity": "CRITICAL" | "HIGH" | "MODERATE" | "LOW",
  "isZoonotic": true | false,
  "temporarySolution": "First-aid relief",
  "aftercareProcedure": "Quarantine protocol",
  "sampleProtocol": "Specimen protocol",
  "advisories": { "en": "English advisory", "hi": "हिंदी में सलाह" }
}`;
            let contents = [prompt];
            if (imagePath && fs.existsSync(imagePath)) {
                contents.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: fs.readFileSync(imagePath).toString('base64')
                    }
                });
            }

            const response = await ai.models.generateContent({ model: 'gemini-1.5-flash', contents });
            return JSON.parse(response.text.replace(/```json|```/g, '').trim());
        } catch (err) {
            console.warn('Gemini fallback applied:', err.message);
        }
    }

    const symptoms = (report.symptoms || []).map(s => s.toLowerCase());
    let suspectedProblem = 'Undifferentiated Bovine Sickness';
    let severity = 'MODERATE';
    let confidenceScore = 86;
    let isZoonotic = false;
    let visualFindings = 'Clinical presentation corresponds to reported symptoms.';
    let tempSolution = 'Isolate animal and provide clean drinking water with electrolytes.';
    let aftercare = 'Maintain stall hygiene, apply disinfectant wash daily, and quarantine herd for 14 days.';
    let sampleProtocol = 'Sterile nasal/blood swab dispatched under cold chain (4°C).';

    if (symptoms.includes('blisters') || symptoms.includes('salivation')) {
        suspectedProblem = 'Foot and Mouth Disease (FMD)';
        severity = 'HIGH';
        confidenceScore = 94;
        visualFindings = 'Vesicular lesions on oral mucosa and interdigital spaces.';
        tempSolution = 'Apply 1:1000 potassium permanganate wash on lesions; 4% sodium carbonate footbath.';
        aftercare = 'Soft green fodder, restrict cattle movement.';
        sampleProtocol = 'Vesicular epithelium flap in phosphate-buffered glycerol.';
    } else if (symptoms.includes('skin_nodules')) {
        suspectedProblem = 'Lumpy Skin Disease (LSD)';
        severity = 'HIGH';
        confidenceScore = 91;
        visualFindings = 'Well-demarcated circular nodules throughout the dermal layers.';
        tempSolution = 'Topical application of neem oil and turmeric paste.';
        aftercare = 'Vector control using permethrin sprays; isolate cattle.';
        sampleProtocol = 'Skin scab biopsy in sterile physiological saline.';
    } else if (symptoms.includes('sudden_death') || symptoms.includes('bloody_discharge')) {
        suspectedProblem = 'Anthrax / Hemorrhagic Septicemia (HS)';
        severity = 'CRITICAL';
        isZoonotic = true;
        confidenceScore = 97;
        visualFindings = 'Dark unclotted blood discharge from natural orifices.';
        tempSolution = 'Strict quarantine! DO NOT open carcass. Cover in formalin.';
        aftercare = 'Deep burial (6 feet minimum) with quicklime.';
        sampleProtocol = 'Peripheral ear vein blood smear by paravet in full PPE.';
    }

    return {
        identifiedSpecies: report.species,
        visualFindings,
        suspectedProblem,
        confidenceScore,
        severity,
        isZoonotic,
        temporarySolution: tempSolution,
        aftercareProcedure: aftercare,
        sampleProtocol,
        advisories: {
            en: `Advisory for ${report.village}: Suspected ${suspectedProblem}. Immediate isolation recommended.`,
            hi: `चेतावनी (${report.village}): संभावित रोग - ${suspectedProblem}। पशु को तुरंत अलग रखें।`
        }
    };
}

// --- API ROUTES ---

// 1. Submit Sickness Report
app.post('/api/reports', upload.single('cattleImage'), async (req, res) => {
    try {
        const { reporterName, reporterPhone, fullAddress, village, district, species, animalTag, animalAge, symptoms, notes, affectedCount, mortalityCount, latitude, longitude } = req.body;
        const parsedSymptoms = typeof symptoms === 'string' ? JSON.parse(symptoms || '[]') : (symptoms || []);
        const imagePath = req.file ? req.file.path : null;
        const lat = parseFloat(latitude) || 28.6692;
        const lng = parseFloat(longitude) || 77.4538;

        const [aiReport, nearestVet] = await Promise.all([
            analyzeWithGoogleAI({
                species, symptoms: parsedSymptoms, notes,
                affectedCount: Number(affectedCount) || 1, mortalityCount: Number(mortalityCount) || 0,
                village: village || fullAddress, district
            }, imagePath),
            fetchRealNearestVet(lat, lng, village, district)
        ]);

        const reportId = 'CASE-2026-' + Math.floor(100000 + Math.random() * 900000);
        const timestamp = new Date().toISOString();
        const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;
        aiReport.caseStatus = 'Under Investigation';

        const insertReport = db.prepare(`
            INSERT INTO reports (
                id, timestamp, reporterName, reporterPhone, fullAddress, village, district, 
                species, animalTag, animalAge, notes, imageUrl, symptoms, affectedCount, mortalityCount, 
                latitude, longitude, nearestVet, aiReport
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertReport.run(
            reportId, timestamp, reporterName || 'Farmer', reporterPhone || '+91 98765 43210',
            fullAddress || `${village}, ${district}`, village || 'Local Area', district || 'Ghaziabad',
            species || 'Cattle (Cow)', animalTag || 'IND-UNTAGGED', animalAge || '4 Years', notes || '', imageUrl, JSON.stringify(parsedSymptoms),
            Number(affectedCount) || 1, Number(mortalityCount) || 0, lat, lng,
            JSON.stringify(nearestVet), JSON.stringify(aiReport)
        );

        // Store active alert
        db.prepare(`
            INSERT INTO alerts (alertId, reportId, location, disease, severity, isZoonotic, advisories, timestamp, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run('ALT-' + Date.now(), reportId, fullAddress || `${village}, ${district}`, aiReport.suspectedProblem, aiReport.severity, aiReport.isZoonotic ? 1 : 0, JSON.stringify(aiReport.advisories), timestamp, 'ACTIVE');

        // Store herd history entry
        const assignedTag = (animalTag && animalTag.trim().length > 0) ? animalTag.toUpperCase() : ('IND-' + Math.floor(100000 + Math.random() * 900000));
        db.prepare(`
            INSERT INTO herds (tag, species, owner, village, date, problem, symptoms, notes, imageUrl)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(assignedTag, species, reporterName || 'Farmer', village || 'Local Area', timestamp, aiReport.suspectedProblem, JSON.stringify(parsedSymptoms), notes || '', imageUrl);

        // Auto-register diagnostic lab sample
        const sampleId = 'SAM-' + Date.now();
        db.prepare(`
            INSERT INTO labs (sampleId, reportId, sampleType, labName, paravetName, status, result, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sampleId, reportId, aiReport.sampleProtocol || 'Clinical Lesion Swab', 'State Animal Disease Diagnostic Lab (ADDL)', reporterName || 'Paravet Officer', 'SAMPLE_COLLECTED', 'PENDING', timestamp, timestamp);

        // Send confirmation and advisory SMS to farmer
        if (reporterPhone && reporterPhone.replace(/[^0-9]/g, '').length >= 10) {
            const smsText = `PASHURAKSHAK: Case ${reportId} registered. Suspected: ${aiReport.suspectedProblem}. Nearest Doctor: ${nearestVet.clinic} (${nearestVet.phone}). Helpline: 1962`;
            sendSMSAlert(reporterPhone, smsText);
        }

        const fullReport = {
            id: reportId, timestamp, reporterName: reporterName || 'Farmer', reporterPhone: reporterPhone || '+91 98765 43210',
            fullAddress: fullAddress || `${village}, ${district}`, village: village || 'Local Area', district: district || 'Ghaziabad',
            species: species || 'Cattle (Cow)', animalTag: assignedTag, animalAge: animalAge || '4 Years',
            notes: notes || '', imageUrl, symptoms: parsedSymptoms, affectedCount: Number(affectedCount) || 1,
            mortalityCount: Number(mortalityCount) || 0, latitude: lat, longitude: lng, nearestVet, aiReport
        };

        res.status(201).json({ message: 'Case created', report: fullReport, sampleId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Direct Manual SMS Dispatch Endpoint
app.post('/api/alerts/send-sms', async (req, res) => {
    const { phoneNumber, message, location, disease } = req.body;
    const bodyText = message || `PashuRakshak Alert: Suspected ${disease || 'infection'} detected near ${location || 'your area'}. Restrict herd movement & Call 1962.`;
    const result = await sendSMSAlert(phoneNumber || '9616958410', bodyText);
    res.json({ message: 'SMS dispatch initiated', result });
});

// 3. Fetch Reports
app.get('/api/reports', (req, res) => {
    const rows = db.prepare('SELECT * FROM reports ORDER BY timestamp DESC').all();
    const reports = rows.map(r => ({
        ...r,
        symptoms: JSON.parse(r.symptoms || '[]'),
        nearestVet: JSON.parse(r.nearestVet || '{}'),
        aiReport: JSON.parse(r.aiReport || '{}')
    }));
    res.json(reports);
});

// 4. Fetch Alerts
app.get('/api/alerts', (req, res) => {
    const rows = db.prepare('SELECT * FROM alerts WHERE status = "ACTIVE" ORDER BY timestamp DESC').all();
    const alerts = rows.map(a => ({
        ...a,
        advisories: JSON.parse(a.advisories || '{}'),
        isZoonotic: Boolean(a.isZoonotic)
    }));
    res.json(alerts);
});

// 5. Hotspots
app.get('/api/hotspots', (req, res) => {
    const rows = db.prepare(`
        SELECT 
            COALESCE(village, fullAddress) as locationName,
            fullAddress,
            district,
            COUNT(*) as totalCases,
            SUM(affectedCount) as affectedAnimals,
            SUM(mortalityCount) as deaths,
            AVG(latitude) as latitude,
            AVG(longitude) as longitude
        FROM reports
        GROUP BY COALESCE(village, fullAddress)
        ORDER BY affectedAnimals DESC
    `).all();

    res.json({ mostAffected: rows.length > 0 ? rows[0] : null, allHotspots: rows });
});

// 6. Analytics & Disease Distribution
app.get('/api/analytics/distribution', (req, res) => {
    try {
        const reports = db.prepare('SELECT aiReport FROM reports').all();
        const counts = { FMD: 0, HS: 0, BQ: 0, LSD: 0, PPR: 0, Brucella: 0, Other: 0 };

        reports.forEach(r => {
            const parsed = JSON.parse(r.aiReport || '{}');
            const prob = (parsed.suspectedProblem || '').toUpperCase();
            if (prob.includes('FOOT') || prob.includes('FMD')) counts.FMD++;
            else if (prob.includes('HEMORRHAGIC') || prob.includes('HS')) counts.HS++;
            else if (prob.includes('BLACKQUARTER') || prob.includes('BQ')) counts.BQ++;
            else if (prob.includes('LUMPY') || prob.includes('LSD')) counts.LSD++;
            else if (prob.includes('PESTE') || prob.includes('PPR')) counts.PPR++;
            else if (prob.includes('BRUCELLA')) counts.Brucella++;
            else counts.Other++;
        });

        res.json(counts);
    } catch (e) {
        res.json({ FMD: 0, HS: 0, BQ: 0, LSD: 0, PPR: 0, Brucella: 0, Other: 0 });
    }
});

// 7. Live Summary Metrics
app.get('/api/summary', (req, res) => {
    const repSummary = db.prepare(`
        SELECT 
            COUNT(*) as totalReports,
            COALESCE(SUM(affectedCount), 0) as totalAffected,
            COALESCE(SUM(mortalityCount), 0) as totalMortality
        FROM reports
    `).get();

    const resolved = db.prepare(`
        SELECT COUNT(*) as count FROM reports WHERE aiReport LIKE '%"caseStatus":"Resolved"%'
    `).get().count;

    const activeAlerts = db.prepare('SELECT COUNT(*) as count FROM alerts WHERE status = "ACTIVE"').get().count;
    const pendingLabs = db.prepare('SELECT COUNT(*) as count FROM labs WHERE result = "PENDING"').get().count;
    const criticalCases = db.prepare('SELECT COUNT(*) as count FROM reports WHERE aiReport LIKE "%CRITICAL%" OR aiReport LIKE "%HIGH%"').get().count;

    const total = repSummary.totalReports;
    const mortalityRate = total > 0 ? ((repSummary.totalMortality / total) * 100).toFixed(1) + '%' : '0.0%';

    res.json({
        totalReports: total,
        totalAffected: repSummary.totalAffected,
        resolvedCases: resolved,
        mortalityRate: mortalityRate,
        totalMortality: repSummary.totalMortality,
        criticalCases,
        activeAlerts,
        pendingLabSamples: pendingLabs
    });
});

// 8. Case Actions
app.post('/api/cases/update-status', (req, res) => {
    const { reportId, status, priority } = req.body;
    try {
        const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
        if (!report) return res.status(404).json({ error: 'Case not found' });

        let aiReport = JSON.parse(report.aiReport || '{}');
        aiReport.caseStatus = status || 'Under Investigation';
        if (priority) aiReport.severity = priority;

        db.prepare('UPDATE reports SET aiReport = ? WHERE id = ?').run(JSON.stringify(aiReport), reportId);
        res.json({ message: 'Status updated', status, priority });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/cases/add-note', (req, res) => {
    const { reportId, noteText, author } = req.body;
    try {
        const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
        if (!report) return res.status(404).json({ error: 'Case not found' });

        const updatedNotes = report.notes ? `${report.notes}\n[${new Date().toLocaleTimeString()} by ${author || 'Doctor'}]: ${noteText}` : noteText;
        db.prepare('UPDATE reports SET notes = ? WHERE id = ?').run(updatedNotes, reportId);
        res.json({ message: 'Note added', notes: updatedNotes });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/cases/schedule-visit', (req, res) => {
    const { reportId, visitDate, remarks } = req.body;
    try {
        const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
        if (!report) return res.status(404).json({ error: 'Case not found' });

        let nearestVet = JSON.parse(report.nearestVet || '{}');
        nearestVet.scheduledVisit = {
            date: visitDate || new Date().toISOString().split('T')[0],
            officer: nearestVet.name || 'Senior Veterinary Officer',
            status: 'Scheduled',
            remarks: remarks || 'On-site clinical inspection'
        };

        db.prepare('UPDATE reports SET nearestVet = ? WHERE id = ?').run(JSON.stringify(nearestVet), reportId);
        res.json({ message: 'Visit scheduled', scheduledVisit: nearestVet.scheduledVisit });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 9. Vaccinations, Labs & Herds
app.get('/api/vaccinations', (req, res) => res.json(db.prepare('SELECT * FROM vaccinations').all()));

app.get('/api/vaccinations/:tag', (req, res) => {
    const tag = req.params.tag.toUpperCase();
    const rows = db.prepare('SELECT * FROM vaccinations WHERE UPPER(tag) = ?').all(tag);

    if (rows.length > 0) {
        const first = rows[0];
        const vaccinations = rows.map(r => ({ name: r.vaccineName, status: r.status, date: r.date, nextDue: r.nextDue }));
        return res.json({ tag: first.tag, species: first.species, owner: first.owner, village: first.village, district: first.district, vaccinations });
    }

    res.json({
        tag: tag,
        species: "Cattle (Cow)",
        owner: "Registered Farmer",
        village: "Local Block",
        district: "Ghaziabad",
        vaccinations: [
            { name: "FMD (Foot & Mouth Disease)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE (Urgent)" },
            { name: "Lumpy Skin Disease (Goat Pox)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE" },
            { name: "HS / BQ (Blackquarter)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE" }
        ]
    });
});

app.post('/api/vaccinations/update', (req, res) => {
    const { tag, vaccineName, date, nextDue } = req.body;
    const upperTag = tag.toUpperCase();
    const existing = db.prepare('SELECT * FROM vaccinations WHERE UPPER(tag) = ? AND vaccineName = ?').get(upperTag, vaccineName);

    if (existing) {
        db.prepare('UPDATE vaccinations SET status = "VACCINATED", date = ?, nextDue = ? WHERE id = ?')
          .run(date || new Date().toISOString().split('T')[0], nextDue || '2027-02-28', existing.id);
    } else {
        db.prepare(`
            INSERT INTO vaccinations (tag, species, owner, village, district, vaccineName, status, date, nextDue)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(upperTag, "Cattle (Cow)", "Farmer", "Local", "Ghaziabad", vaccineName, "VACCINATED", date || new Date().toISOString().split('T')[0], nextDue || '2027-02-28');
    }
    res.json({ message: 'Vaccination recorded' });
});

app.post('/api/labs/refer', (req, res) => {
    const { reportId, sampleType, labName, paravetName } = req.body;
    const sampleId = 'SAM-' + Date.now();
    const createdAt = new Date().toISOString();

    db.prepare(`
        INSERT INTO labs (sampleId, reportId, sampleType, labName, paravetName, status, result, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sampleId, reportId, sampleType, labName || 'District Diagnostic Lab', paravetName || 'Field Paravet', 'SAMPLE_COLLECTED', 'PENDING', createdAt, createdAt);

    res.status(201).json({ message: 'Lab referral created', sampleId });
});

app.get('/api/labs', (req, res) => res.json(db.prepare('SELECT * FROM labs ORDER BY createdAt DESC').all()));

app.post('/api/labs/update', (req, res) => {
    const { sampleId, status, result } = req.body;
    db.prepare('UPDATE labs SET status = ?, result = ?, updatedAt = ? WHERE sampleId = ?')
      .run(status || 'TESTED', result || 'CONFIRMED', new Date().toISOString(), sampleId);
    res.json({ message: 'Lab record updated' });
});

app.get('/api/herds/:tag', (req, res) => {
    const tag = req.params.tag.toUpperCase();
    const rows = db.prepare('SELECT * FROM herds WHERE UPPER(tag) = ? ORDER BY date DESC').all(tag);
    if (rows.length === 0) return res.status(404).json({ error: 'Tag ID not found' });

    const first = rows[0];
    const history = rows.map(r => ({
        date: r.date, problem: r.problem,
        symptoms: JSON.parse(r.symptoms || '[]'),
        notes: r.notes, imageUrl: r.imageUrl
    }));

    res.json({ tag: first.tag, species: first.species, owner: first.owner, village: first.village, history });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`PashuRakshak AI Surveillance Server running on port ${PORT}`);
});
