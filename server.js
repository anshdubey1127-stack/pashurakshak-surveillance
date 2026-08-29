const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const REPORTS_FILE = path.join(DATA_DIR, 'reports.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');
const HERD_FILE = path.join(DATA_DIR, 'herds.json');
const LAB_FILE = path.join(DATA_DIR, 'labs.json');
const VAX_FILE = path.join(DATA_DIR, 'vaccinations.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

[REPORTS_FILE, ALERTS_FILE, HERD_FILE, LAB_FILE, VAX_FILE].forEach(file => {
    if (!fs.existsSync(file)) fs.writeFileSync(file, '[]');
});

// Seed default vaccination records if empty
if (fs.readFileSync(VAX_FILE, 'utf8') === '[]') {
    const seedVaccines = [
        {
            tag: "IN-TAG-9021",
            species: "Cattle",
            owner: "Ramesh Yadav",
            village: "Muradnagar",
            district: "Ghaziabad",
            vaccinations: [
                { name: "FMD (Foot & Mouth Disease)", date: "2025-11-10", status: "VACCINATED", nextDue: "2026-05-10" },
                { name: "Lumpy Skin Disease (Goat Pox)", date: "2025-08-15", status: "VACCINATED", nextDue: "2026-08-15" },
                { name: "HS / BQ (Blackquarter)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE (Urgent)" }
            ]
        },
        {
            tag: "IN-TAG-4412",
            species: "Buffalo",
            owner: "Suresh Gujjar",
            village: "Govindpuram",
            district: "Ghaziabad",
            vaccinations: [
                { name: "FMD (Foot & Mouth Disease)", date: "N/A", status: "UNVACCINATED", nextDue: "IMMEDIATE" },
                { name: "Brucellosis (S19)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE" }
            ]
        }
    ];
    fs.writeFileSync(VAX_FILE, JSON.stringify(seedVaccines, null, 2));
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `cattle_${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

const readData = (filePath) => {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw || '[]');
    } catch {
        return [];
    }
};

const writeData = (filePath, data) => {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
};

// --- HAVERSINE DISTANCE FORMULA ---
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// --- LIVE MAP DATA COLLECTOR FOR REAL VETERINARY CLINICS & DOCTORS ---
async function fetchRealNearestVet(lat, lng, villageName, districtName) {
    try {
        // Query OpenStreetMap Overpass API for real veterinary facilities within 20km radius
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
            // Find closest real facility from map geometry
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
                        const name = tags.name || tags['name:en'] || tags['name:hi'] || 'Government Veterinary Hospital / Clinic';
                        const road = tags['addr:street'] || tags['addr:suburb'] || tags['addr:city'] || tags['addr:village'] || '';
                        const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '1962 (National Animal Helpline / Emergency Toll-Free)';
                        const operator = tags.operator || tags.doctor || 'Senior Veterinary Medical Officer';

                        bestMatch = {
                            isRealMapData: true,
                            name: operator.includes('Officer') ? operator : `Dr. In-Charge (${operator})`,
                            clinic: name,
                            phone: phone,
                            address: road ? `${road}, ${districtName || ''}` : `Nearby Map Node at (${elLat.toFixed(4)}, ${elLon.toFixed(4)}), ${districtName || ''}`,
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
        console.warn('Live map query failed, using district veterinary registry fallback:', err.message);
    }

    // Dynamic Regional Govt Block Veterinary Fallback (if remote/rural without OSM node)
    return {
        isRealMapData: false,
        name: `Chief Veterinary Officer (${districtName || 'District HQ'})`,
        clinic: `Government Block Animal Dispensary - ${villageName || 'Local Area'}`,
        phone: "1962 / +91-11-23384190 (DAHD Animal Emergency Line)",
        address: `Main Block Development Office & Animal Dispensary, ${villageName || ''}, ${districtName || ''}`,
        latitude: lat + 0.012,
        longitude: lng + 0.015,
        distanceKm: "2.4"
    };
}

// --- GOOGLE GEMINI MULTIMODAL AI & CLINICAL DIAGNOSIS ---
async function analyzeWithGoogleAI(report, imagePath) {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (apiKey) {
        try {
            const ai = new GoogleGenAI({ apiKey });
            const prompt = `You are a chief veterinary clinical diagnostic AI.
Analyze this livestock case based on the attached image, symptoms, and farmer notes.

Case Context:
- Declared Species: ${report.species}
- Checked Symptoms: ${(report.symptoms || []).join(', ')}
- Farmer Detailed Notes: "${report.notes || 'None provided'}"
- Affected Count: ${report.affectedCount}, Mortalities: ${report.mortalityCount}
- Location: ${report.village}, ${report.district}

Perform a full clinical report and return STRICTLY valid JSON with this exact structure:
{
  "identifiedSpecies": "Verified species & breed from image/details",
  "visualFindings": "Visual abnormalities detected in the image",
  "suspectedProblem": "Primary diagnosed disease",
  "severity": "CRITICAL" | "HIGH" | "MODERATE" | "LOW",
  "isZoonotic": true | false,
  "temporarySolution": "Immediate first-aid & symptomatic relief for the farmer",
  "aftercareProcedure": "Step-by-step long-term care, biosecurity, and isolation",
  "sampleProtocol": "Instructions for paravet specimen collection",
  "advisories": {
    "en": "Urgent practical advisory in English",
    "hi": "गाँव और पशुपालक के लिए हिंदी में सलाह"
  }
}`;

            let contents = [prompt];
            if (imagePath && fs.existsSync(imagePath)) {
                const imageBuffer = fs.readFileSync(imagePath);
                contents.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: imageBuffer.toString('base64')
                    }
                });
            }

            const response = await ai.models.generateContent({
                model: 'gemini-1.5-flash',
                contents: contents
            });

            const text = response.text.replace(/```json|```/g, '').trim();
            return JSON.parse(text);
        } catch (err) {
            console.warn('Google Gemini API request issue, applying fallback rules:', err.message);
        }
    }

    // Heuristic Clinical Fallback
    const symptoms = (report.symptoms || []).map(s => s.toLowerCase());
    const notes = (report.notes || '').toLowerCase();
    const species = report.species || 'Cattle';
    
    let suspectedProblem = 'Undifferentiated Bovine Sickness';
    let severity = 'MODERATE';
    let isZoonotic = false;
    let visualFindings = 'Erythema and clinical signs corresponding to selected symptoms.';
    let tempSolution = 'Isolate the animal immediately, provide clean drinking water with electrolytes, and administer antipyretics.';
    let aftercare = 'Maintain stall hygiene, apply disinfectant wash daily, and quarantine herd for 14 days.';
    let sampleProtocol = 'Sterile nasal/blood swab dispatched under cold chain (4°C).';

    if (symptoms.includes('blisters') || symptoms.includes('salivation') || notes.includes('mouth') || notes.includes('hoof')) {
        suspectedProblem = 'Foot-and-Mouth Disease (FMD)';
        severity = 'HIGH';
        visualFindings = 'Vesicular lesions on oral mucosa and interdigital spaces.';
        tempSolution = 'Apply 1:1000 potassium permanganate (KMnO4) wash on lesions and 4% sodium carbonate footbath.';
        aftercare = 'Soft green fodder, isolate from non-infected herd, prohibit animal movement outside village.';
        sampleProtocol = 'Vesicular epithelium flap in phosphate-buffered glycerol.';
    } else if (symptoms.includes('skin_nodules') || notes.includes('lump') || notes.includes('nodule')) {
        suspectedProblem = 'Lumpy Skin Disease (LSD)';
        severity = 'HIGH';
        visualFindings = 'Well-demarcated circular nodules throughout the dermis.';
        tempSolution = 'Topical application of neem oil and turmeric paste; paracetamol for fever reduction.';
        aftercare = 'Vector control using permethrin sprays; isolate cattle under insect nets.';
        sampleProtocol = 'Skin scab biopsy in sterile physiological saline.';
    } else if (symptoms.includes('sudden_death') || symptoms.includes('bloody_discharge')) {
        suspectedProblem = 'Anthrax / Hemorrhagic Septicemia';
        severity = 'CRITICAL';
        isZoonotic = true;
        visualFindings = 'Unclotted dark blood discharge from orifices.';
        tempSolution = 'Strict quarantine! DO NOT open or drag carcass. Cover carcass in formalin.';
        aftercare = 'Deep burial (6 feet minimum) with quicklime. Disinfect sheds with 5% sodium hydroxide.';
        sampleProtocol = 'Peripheral ear vein blood smear by paravet in full PPE.';
    }

    return {
        identifiedSpecies: species,
        visualFindings,
        suspectedProblem,
        severity,
        isZoonotic,
        temporarySolution: tempSolution,
        aftercareProcedure: aftercare,
        sampleProtocol,
        advisories: {
            en: `Advisory for ${report.village}: Suspected ${suspectedProblem}. Immediate isolation recommended.`,
            hi: `सलाह (${report.village}): संभावित रोग - ${suspectedProblem}। तुरंत पशु को अलग रखें।`
        }
    };
}

// 1. Submit Symptom & Image Report (With Live Real Doctor Discovery)
app.post('/api/reports', upload.single('cattleImage'), async (req, res) => {
    try {
        const { reporterName, reporterPhone, fullAddress, village, district, species, animalTag, symptoms, notes, affectedCount, mortalityCount, latitude, longitude } = req.body;

        const parsedSymptoms = typeof symptoms === 'string' ? JSON.parse(symptoms || '[]') : (symptoms || []);
        const imagePath = req.file ? req.file.path : null;
        const lat = parseFloat(latitude) || 28.6692;
        const lng = parseFloat(longitude) || 77.4538;

        const [aiReport, nearestVet] = await Promise.all([
            analyzeWithGoogleAI({
                species,
                symptoms: parsedSymptoms,
                notes,
                affectedCount: Number(affectedCount) || 1,
                mortalityCount: Number(mortalityCount) || 0,
                village: village || fullAddress,
                district
            }, imagePath),
            fetchRealNearestVet(lat, lng, village, district)
        ]);

        const newReport = {
            id: 'REP-' + Date.now(),
            timestamp: new Date().toISOString(),
            reporterName: reporterName || 'Anonymous Farmer',
            reporterPhone: reporterPhone || 'N/A',
            fullAddress: fullAddress || `${village}, ${district}`,
            village: village || 'Local Area',
            district: district || 'District Center',
            species,
            animalTag: animalTag || 'UNTAGGED',
            notes: notes || '',
            imageUrl: req.file ? `/uploads/${req.file.filename}` : null,
            symptoms: parsedSymptoms,
            affectedCount: Number(affectedCount) || 1,
            mortalityCount: Number(mortalityCount) || 0,
            latitude: lat,
            longitude: lng,
            nearestVet,
            aiReport
        };

        const reports = readData(REPORTS_FILE);
        reports.push(newReport);
        writeData(REPORTS_FILE, reports);

        if (aiReport.severity === 'CRITICAL' || aiReport.severity === 'HIGH') {
            const alerts = readData(ALERTS_FILE);
            alerts.push({
                alertId: 'ALT-' + Date.now(),
                reportId: newReport.id,
                location: newReport.fullAddress,
                disease: aiReport.suspectedProblem,
                severity: aiReport.severity,
                isZoonotic: aiReport.isZoonotic,
                advisories: aiReport.advisories,
                timestamp: newReport.timestamp,
                status: 'ACTIVE'
            });
            writeData(ALERTS_FILE, alerts);
        }

        if (animalTag && animalTag !== 'UNTAGGED') {
            const herds = readData(HERD_FILE);
            let record = herds.find(h => h.tag === animalTag);
            if (!record) {
                record = { tag: animalTag, species, owner: reporterName, village: newReport.village, history: [] };
                herds.push(record);
            }
            record.history.push({ 
                date: newReport.timestamp, 
                symptoms: parsedSymptoms, 
                notes, 
                problem: aiReport.suspectedProblem, 
                imageUrl: newReport.imageUrl 
            });
            writeData(HERD_FILE, herds);
        }

        res.status(201).json({ message: 'Report processed successfully', report: newReport });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to process report' });
    }
});

app.get('/api/reports', (req, res) => res.json(readData(REPORTS_FILE)));
app.get('/api/alerts', (req, res) => res.json(readData(ALERTS_FILE)));

// 2. Outbreak Hotspot & Epicenter Calculation
app.get('/api/hotspots', (req, res) => {
    const reports = readData(REPORTS_FILE);
    const locationCounts = {};

    reports.forEach(r => {
        const key = r.village || r.fullAddress || 'Unknown';
        if (!locationCounts[key]) {
            locationCounts[key] = {
                locationName: key,
                fullAddress: r.fullAddress,
                district: r.district,
                totalCases: 0,
                affectedAnimals: 0,
                deaths: 0,
                latitude: r.latitude,
                longitude: r.longitude
            };
        }
        locationCounts[key].totalCases += 1;
        locationCounts[key].affectedAnimals += (r.affectedCount || 1);
        locationCounts[key].deaths += (r.mortalityCount || 0);
    });

    const sortedHotspots = Object.values(locationCounts).sort((a, b) => b.affectedAnimals - a.affectedAnimals);
    const mostAffected = sortedHotspots[0] || null;

    res.json({
        mostAffected,
        allHotspots: sortedHotspots
    });
});

// 3. Vaccination Tracker Endpoints
app.get('/api/vaccinations', (req, res) => {
    res.json(readData(VAX_FILE));
});

app.get('/api/vaccinations/:tag', (req, res) => {
    const records = readData(VAX_FILE);
    const tag = req.params.tag.toUpperCase();
    const found = records.find(r => r.tag.toUpperCase() === tag);

    if (found) return res.json(found);

    res.json({
        tag: tag,
        species: "Cattle / Bovine",
        owner: "Registered Farmer",
        village: "Local Block",
        district: "Ghaziabad",
        vaccinations: [
            { name: "FMD (Foot & Mouth Disease)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE (Urgent Action Needed)" },
            { name: "Lumpy Skin Disease (Goat Pox)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE" },
            { name: "HS / BQ (Blackquarter)", date: "N/A", status: "UNVACCINATED", nextDue: "OVERDUE" }
        ]
    });
});

app.post('/api/vaccinations/update', (req, res) => {
    const { tag, vaccineName, date, nextDue } = req.body;
    const records = readData(VAX_FILE);
    let record = records.find(r => r.tag.toUpperCase() === tag.toUpperCase());

    if (!record) {
        record = { tag: tag.toUpperCase(), species: "Cattle", owner: "Farmer", village: "Local", district: "Ghaziabad", vaccinations: [] };
        records.push(record);
    }

    const existingVax = record.vaccinations.find(v => v.name.toLowerCase().includes(vaccineName.toLowerCase()));
    if (existingVax) {
        existingVax.status = "VACCINATED";
        existingVax.date = date || new Date().toISOString().split('T')[0];
        existingVax.nextDue = nextDue || "2027-02-28";
    } else {
        record.vaccinations.push({
            name: vaccineName,
            status: "VACCINATED",
            date: date || new Date().toISOString().split('T')[0],
            nextDue: nextDue || "2027-02-28"
        });
    }

    writeData(VAX_FILE, records);
    res.json({ message: 'Vaccination record saved', record });
});

// 4. Lab Referrals & Herds
app.post('/api/labs/refer', (req, res) => {
    const { reportId, sampleType, labName, paravetName } = req.body;
    const labs = readData(LAB_FILE);
    const newReferral = {
        sampleId: 'SAM-' + Date.now(),
        reportId,
        sampleType,
        labName: labName || 'District Diagnostic Lab',
        paravetName: paravetName || 'Field Paravet',
        status: 'SAMPLE_COLLECTED',
        result: 'PENDING',
        createdAt: new Date().toISOString()
    };
    labs.push(newReferral);
    writeData(LAB_FILE, labs);
    res.status(201).json({ message: 'Lab referral created', referral: newReferral });
});

app.get('/api/labs', (req, res) => res.json(readData(LAB_FILE)));

app.post('/api/labs/update', (req, res) => {
    const { sampleId, status, result } = req.body;
    const labs = readData(LAB_FILE);
    const target = labs.find(l => l.sampleId === sampleId);
    if (!target) return res.status(404).json({ error: 'Sample not found' });
    if (status) target.status = status;
    if (result) target.result = result;
    writeData(LAB_FILE, labs);
    res.json({ message: 'Status updated', sample: target });
});

app.get('/api/herds/:tag', (req, res) => {
    const herds = readData(HERD_FILE);
    const found = herds.find(h => h.tag.toUpperCase() === req.params.tag.toUpperCase());
    if (!found) return res.status(404).json({ error: 'Tag ID not found' });
    res.json(found);
});

app.get('/api/summary', (req, res) => {
    const reports = readData(REPORTS_FILE);
    const alerts = readData(ALERTS_FILE);
    const labs = readData(LAB_FILE);

    res.json({
        totalReports: reports.length,
        totalAffected: reports.reduce((s, r) => s + (r.affectedCount || 0), 0),
        totalMortality: reports.reduce((s, r) => s + (r.mortalityCount || 0), 0),
        criticalCases: reports.filter(r => r.aiReport && (r.aiReport.severity === 'CRITICAL' || r.aiReport.severity === 'HIGH')).length,
        pendingLabSamples: labs.filter(l => l.result === 'PENDING').length
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`PashuRakshak AI Surveillance Engine listening on port ${PORT}`);
});
