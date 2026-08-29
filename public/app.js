let entryMap, entryMarker;
let survMap, survMarkersLayer;
let currentCoords = { lat: 28.6692, lng: 77.4538 };
let autocompleteTimeout;

document.addEventListener('DOMContentLoaded', () => {
    initEntryMap();
    checkOfflineQueue();
});

// --- 1. NAVIGATION & TAB SWITCHING ---
function switchTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');

    if (tabId === 'dashboard-tab') {
        setTimeout(() => {
            initSurveillanceMap();
            loadDashboardData();
            loadEpicenterAndHotspots();
        }, 150);
    } else if (tabId === 'lab-tab') {
        loadLabReferrals();
    }
}

// --- 2. PIN, MAP CLICK & SLIDER COORDINATE CONTROLS ---
function initEntryMap() {
    entryMap = L.map('entryMap').setView([currentCoords.lat, currentCoords.lng], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(entryMap);

    entryMarker = L.marker([currentCoords.lat, currentCoords.lng], { draggable: true }).addTo(entryMap);

    entryMarker.on('dragend', function() {
        const pos = entryMarker.getLatLng();
        setCoordinates(pos.lat, pos.lng);
        reverseGeocode(pos.lat, pos.lng);
    });

    entryMap.on('click', function(e) {
        setCoordinates(e.latlng.lat, e.latlng.lng);
        reverseGeocode(e.latlng.lat, e.latlng.lng);
    });
}

function setCoordinates(lat, lng) {
    currentCoords.lat = parseFloat(lat);
    currentCoords.lng = parseFloat(lng);

    const latEl = document.getElementById('displayLat');
    const lngEl = document.getElementById('displayLng');
    if (latEl) latEl.innerText = currentCoords.lat.toFixed(4);
    if (lngEl) lngEl.innerText = currentCoords.lng.toFixed(4);

    const latSlider = document.getElementById('latSlider');
    const lngSlider = document.getElementById('lngSlider');
    const latSliderVal = document.getElementById('latSliderVal');
    const lngSliderVal = document.getElementById('lngSliderVal');

    if (latSlider) latSlider.value = currentCoords.lat;
    if (lngSlider) lngSlider.value = currentCoords.lng;
    if (latSliderVal) latSliderVal.innerText = currentCoords.lat.toFixed(4);
    if (lngSliderVal) lngSliderVal.innerText = currentCoords.lng.toFixed(4);

    if (entryMarker) entryMarker.setLatLng([currentCoords.lat, currentCoords.lng]);
    if (entryMap) entryMap.panTo([currentCoords.lat, currentCoords.lng]);
}

function onSliderChange() {
    const lat = parseFloat(document.getElementById('latSlider').value);
    const lng = parseFloat(document.getElementById('lngSlider').value);
    setCoordinates(lat, lng);
    reverseGeocode(lat, lng);
}

// --- 3. ADDRESS AUTOCOMPLETE & REVERSE GEOCODING ---
function handleAddressAutocomplete(query) {
    clearTimeout(autocompleteTimeout);
    const dropdown = document.getElementById('addressSuggestions');

    if (!query || query.trim().length < 2) {
        if (dropdown) dropdown.style.display = 'none';
        return;
    }

    autocompleteTimeout = setTimeout(async () => {
        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=in&q=${encodeURIComponent(query)}`;
            const res = await fetch(url);
            const data = await res.json();

            if (!data || data.length === 0) {
                if (dropdown) dropdown.style.display = 'none';
                return;
            }

            dropdown.innerHTML = data.slice(0, 5).map(item => `
                <div class="suggestion-item" onclick="selectAddress('${item.display_name.replace(/'/g, "\\'")}', ${item.lat}, ${item.lon}, '${item.address.suburb || item.address.village || item.address.town || item.address.city || ''}', '${item.address.state_district || item.address.county || item.address.state || ''}')">
                    <i class="fa-solid fa-location-dot" style="color:#2563eb;"></i>
                    <span>${item.display_name}</span>
                </div>
            `).join('');

            dropdown.style.display = 'block';
        } catch (e) {
            console.warn('Autocomplete lookup error:', e);
        }
    }, 300);
}

function selectAddress(displayName, lat, lon, villageName, districtName) {
    document.getElementById('addressSearchInput').value = displayName;
    document.getElementById('village').value = villageName || displayName.split(',')[0];
    document.getElementById('district').value = districtName || 'District Center';
    
    const dropdown = document.getElementById('addressSuggestions');
    if (dropdown) dropdown.style.display = 'none';

    setCoordinates(lat, lon);
    if (entryMap) entryMap.setView([lat, lon], 13);
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.autocomplete-wrapper')) {
        const dd = document.getElementById('addressSuggestions');
        if (dd) dd.style.display = 'none';
    }
});

async function reverseGeocode(lat, lng) {
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await res.json();
        if (data && data.address) {
            const village = data.address.village || data.address.suburb || data.address.town || data.address.city || '';
            const district = data.address.state_district || data.address.county || data.address.state || '';
            if (village) document.getElementById('village').value = village;
            if (district) document.getElementById('district').value = district;
            document.getElementById('addressSearchInput').value = data.display_name || '';
        }
    } catch (e) {
        console.warn('Reverse geocoding error:', e);
    }
}

function captureGPS() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setCoordinates(pos.coords.latitude, pos.coords.longitude);
                reverseGeocode(pos.coords.latitude, pos.coords.longitude);
            },
            () => alert('Location permission denied. Please select location manually or on the map.')
        );
    }
}

// --- 4. IMAGE PREVIEW ---
function previewImage(event) {
    const file = event.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('imagePreview').src = e.target.result;
            document.getElementById('uploadPlaceholder').style.display = 'none';
            document.getElementById('previewContainer').style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
}

// --- 5. REPORT SUBMISSION & AI DIAGNOSTIC DISPLAY ---
document.getElementById('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing with AI Model & Locating Nearest Vet...';
    submitBtn.disabled = true;

    const selectedSymptoms = Array.from(document.querySelectorAll('input[name="symp"]:checked')).map(c => c.value);
    const formData = new FormData();

    formData.append('reporterName', document.getElementById('reporterName').value);
    formData.append('reporterPhone', document.getElementById('reporterPhone').value);
    formData.append('fullAddress', document.getElementById('addressSearchInput').value);
    formData.append('village', document.getElementById('village').value);
    formData.append('district', document.getElementById('district').value);
    formData.append('species', document.getElementById('species').value);
    formData.append('animalTag', document.getElementById('animalTag').value);
    formData.append('notes', document.getElementById('notes').value);
    formData.append('symptoms', JSON.stringify(selectedSymptoms));
    formData.append('affectedCount', document.getElementById('affectedCount').value);
    formData.append('mortalityCount', document.getElementById('mortalityCount').value);
    formData.append('latitude', currentCoords.lat);
    formData.append('longitude', currentCoords.lng);

    const imageFile = document.getElementById('cattleImage').files[0];
    if (imageFile) formData.append('cattleImage', imageFile);

    try {
        const res = await fetch('/api/reports', { method: 'POST', body: formData });
        const data = await res.json();
        if (res.ok) {
            renderDetailedAIReport(data.report);
            document.getElementById('reportForm').reset();
            document.getElementById('previewContainer').style.display = 'none';
            document.getElementById('uploadPlaceholder').style.display = 'block';
        } else {
            alert('Submission error: ' + (data.error || 'Unknown error occurred.'));
        }
    } catch (err) {
        alert('Server unreachable. Make sure the Node backend is running.');
    } finally {
        submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Run AI Diagnosis & Find Nearest Doctor';
        submitBtn.disabled = false;
    }
});

function renderDetailedAIReport(report) {
    const box = document.getElementById('triageResultBox');
    const ai = report.aiReport || {};
    const vet = report.nearestVet || {};
    const severity = ai.severity || 'MODERATE';

    box.className = `card triage-box ${severity}`;
    box.style.display = 'block';

    box.innerHTML = `
        <div class="card-head">
            <i class="fa-solid fa-brain icon-accent"></i>
            <div>
                <h4>AI Clinical Diagnostic Report</h4>
                <span class="ai-badge" style="background:${severity === 'CRITICAL' ? '#dc2626' : (severity === 'HIGH' ? '#ea580c' : '#2563eb')}">
                    ${severity} RISK
                </span>
            </div>
        </div>

        ${report.imageUrl ? `
            <div style="margin-bottom:10px;">
                <img src="${report.imageUrl}" style="width:100%; max-height:160px; object-fit:cover; border-radius:8px; border:1px solid #cbd5e1;" />
                <small style="color:#64748b; font-size:0.75rem;">Verified Image Specimen</small>
            </div>
        ` : ''}

        <div style="font-size:0.85rem; line-height:1.5;">
            <p><strong>🐄 Species & Breed:</strong> ${ai.identifiedSpecies || report.species}</p>
            <p><strong>🔍 Visual Image Findings:</strong> ${ai.visualFindings || 'Analyzed based on reported clinical signs.'}</p>
            <p style="margin-top:4px;"><strong>⚠️ Primary Diagnosis:</strong> <span style="color:#b91c1c; font-weight:700;">${ai.suspectedProblem || 'Undifferentiated Condition'}</span></p>
            <p><strong>☣️ Zoonotic to Humans:</strong> ${ai.isZoonotic ? '⚠️ YES (Follow strict biosafety)' : 'No direct human transmission'}</p>
            
            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:8px; margin:8px 0;">
                <strong style="color:#059669;">🩹 Immediate First-Aid / Temporary Solution:</strong>
                <p style="margin-top:2px;">${ai.temporarySolution || 'Isolate animal and provide clean water.'}</p>
            </div>

            <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:6px; padding:8px; margin:8px 0;">
                <strong style="color:#2563eb;">📋 Long-term Aftercare & Procedures:</strong>
                <p style="margin-top:2px;">${ai.aftercareProcedure || 'Maintain stable hygiene and monitor daily.'}</p>
            </div>
        </div>

        <!-- REAL MAP-DISCOVERED VETERINARY DOCTOR & CLINIC CARD -->
        <div class="vet-doctor-card">
            <h5>
                <i class="fa-solid fa-user-doctor"></i> Nearest Real Veterinary Clinic & Officer
                ${vet.isRealMapData ? '<span class="vax-badge VACCINATED" style="margin-left:auto; font-size:0.7rem;"><i class="fa-solid fa-circle-check"></i> Live Map Verified</span>' : ''}
            </h5>
            <p><strong>Doctor / In-Charge:</strong> ${vet.name || 'Senior Veterinary Officer'}</p>
            <p><strong>Hospital / Clinic:</strong> ${vet.clinic || 'Government Veterinary Hospital'} (~${vet.distanceKm || '1.5'} km away)</p>
            <p><strong>Location / Address:</strong> ${vet.address || 'Local Block Animal Dispensary'}</p>
            <a href="tel:${(vet.phone || '1962').replace(/[^0-9+]/g, '')}" class="vet-phone-btn">
                <i class="fa-solid fa-phone"></i> Direct Call: ${vet.phone || '1962'}
            </a>
        </div>

        <div style="margin-top:12px;">
            <button onclick="dispatchLabSample('${report.id}', '${ai.suspectedProblem || 'Suspected Disease'}')" class="btn-submit" style="padding:0.6rem; font-size:0.85rem;">
                <i class="fa-solid fa-truck-medical"></i> Dispatch Sample to Diagnostic Lab
            </button>
        </div>
    `;
}

// --- 6. SURVEILLANCE MAP & EPICENTER HIGHLIGHT ---
function initSurveillanceMap() {
    if (!survMap) {
        survMap = L.map('map').setView([28.6692, 77.4538], 8);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(survMap);
        survMarkersLayer = L.layerGroup().addTo(survMap);
    } else {
        survMap.invalidateSize();
    }
}

async function loadEpicenterAndHotspots() {
    try {
        const res = await fetch('/api/hotspots');
        const data = await res.json();
        const banner = document.getElementById('epicenterBanner');

        if (data.mostAffected && data.mostAffected.totalCases > 0) {
            if (banner) banner.style.display = 'flex';
            const textEl = document.getElementById('epicenterText');
            const subEl = document.getElementById('epicenterSub');
            
            if (textEl) textEl.innerHTML = `<strong>${data.mostAffected.locationName} (${data.mostAffected.district})</strong> is currently experiencing the highest livestock disease load.`;
            if (subEl) subEl.innerHTML = `📍 <strong>Full Address:</strong> ${data.mostAffected.fullAddress || data.mostAffected.locationName} | <strong>Total Sickness Load:</strong> ${data.mostAffected.affectedAnimals} Animals Affected (${data.mostAffected.deaths} Deaths)`;

            const epicenterCircle = L.circle([data.mostAffected.latitude, data.mostAffected.longitude], {
                radius: 3500,
                color: '#ef4444',
                weight: 3,
                fillColor: '#ef4444',
                fillOpacity: 0.35
            }).bindPopup(`
                <strong style="color:#b91c1c;">🔥 OUTBREAK EPICENTER</strong><br>
                <b>Location:</b> ${data.mostAffected.fullAddress || data.mostAffected.locationName}<br>
                <b>Total Affected:</b> ${data.mostAffected.affectedAnimals} Animals<br>
                <b>Deaths:</b> ${data.mostAffected.deaths} Recorded
            `);

            if (survMarkersLayer) survMarkersLayer.addLayer(epicenterCircle);
        } else {
            if (banner) banner.style.display = 'none';
        }
    } catch (e) {
        console.warn('Hotspot load failed:', e);
    }
}

async function loadDashboardData() {
    try {
        const sumRes = await fetch('/api/summary');
        const summary = await sumRes.json();
        document.getElementById('mTotal').innerText = summary.totalReports;
        document.getElementById('mAffected').innerText = summary.totalAffected;
        document.getElementById('mMortality').innerText = summary.totalMortality;
        document.getElementById('mCritical').innerText = summary.criticalCases;
        document.getElementById('mLab').innerText = summary.pendingLabSamples;

        const repRes = await fetch('/api/reports');
        const reports = await repRes.json();
        if (survMarkersLayer) survMarkersLayer.clearLayers();

        reports.forEach(r => {
            const ai = r.aiReport || {};
            const vet = r.nearestVet || {};
            const sev = ai.severity || 'LOW';
            const color = sev === 'CRITICAL' ? '#dc2626' : (sev === 'HIGH' ? '#ea580c' : (sev === 'MODERATE' ? '#f59e0b' : '#059669'));

            const marker = L.circleMarker([r.latitude, r.longitude], {
                radius: 9 + Math.min(r.affectedCount, 15),
                fillColor: color,
                color: '#fff',
                weight: 2,
                fillOpacity: 0.85
            });

            marker.bindPopup(`
                ${r.imageUrl ? `<img src="${r.imageUrl}" style="width:100%; max-height:100px; object-fit:cover; border-radius:4px; margin-bottom:5px;" />` : ''}
                <strong>${ai.identifiedSpecies || r.species} (${sev})</strong><br>
                <b>Address:</b> ${r.fullAddress || r.village}<br>
                <b>Diagnosis:</b> ${ai.suspectedProblem || 'General'}<br>
                <b>Assigned Vet:</b> ${vet.name || 'Local Hospital'}<br>
                <b>Vet Phone:</b> ${vet.phone || 'N/A'}<br>
                <b>Affected:</b> ${r.affectedCount} | <b>Deaths:</b> ${r.mortalityCount}<br>
                <small>${new Date(r.timestamp).toLocaleString()}</small>
            `);

            if (survMarkersLayer) survMarkersLayer.addLayer(marker);
        });

        const alertRes = await fetch('/api/alerts');
        const alerts = await alertRes.json();
        const alertBox = document.getElementById('alertsContainer');

        if (alerts.length === 0) {
            alertBox.innerHTML = '<p class="empty-text">No active outbreak alerts recorded.</p>';
        } else {
            alertBox.innerHTML = alerts.slice(-4).reverse().map(a => `
                <div class="alert-item">
                    <h5>⚠️ ${a.location} - Suspected ${a.disease}</h5>
                    <div style="font-size:0.85rem; margin-top:0.4rem;"><strong>Advisory (EN):</strong> ${a.advisories ? a.advisories.en : ''}</div>
                    <div style="font-size:0.85rem; margin-top:0.2rem;"><strong>सूचना (HI):</strong> ${a.advisories ? a.advisories.hi : ''}</div>
                </div>
            `).join('');
        }
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}

// --- 7. VACCINATION SEARCH & REGISTRY MANAGEMENT ---
async function searchVaccinationRecord() {
    const tagInput = document.getElementById('vaxSearchInput');
    const tag = tagInput ? tagInput.value.trim() : '';
    if (!tag) {
        alert('Please enter an ear tag UID (e.g. IN-TAG-9021 or IN-TAG-4412)');
        return;
    }

    const container = document.getElementById('vaxResultContainer');
    container.innerHTML = `<p style="color:var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Retrieving vaccination history...</p>`;

    try {
        const res = await fetch(`/api/vaccinations/${tag}`);
        const data = await res.json();

        const hasUnvax = data.vaccinations.some(v => v.status === 'UNVACCINATED');

        container.innerHTML = `
            <div style="background:var(--surface-alt); padding:1.4rem; border-radius:10px; border:1.5px solid var(--border); margin-top:1rem;">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; margin-bottom:1rem; gap:0.5rem;">
                    <div>
                        <h4 style="font-size:1.1rem; color:#0f172a;">Tag UID: <strong>${data.tag}</strong> (${data.species})</h4>
                        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">Owner: <strong>${data.owner}</strong> | Location: <strong>${data.village}, ${data.district}</strong></p>
                    </div>
                    <div>
                        ${hasUnvax ? `
                            <span class="vax-badge UNVACCINATED"><i class="fa-solid fa-triangle-exclamation"></i> HIGH OUTBREAK RISK: UNVACCINATED DOSES FOUND</span>
                        ` : `
                            <span class="vax-badge VACCINATED"><i class="fa-solid fa-circle-check"></i> FULLY IMMUNIZED HERD</span>
                        `}
                    </div>
                </div>

                <div class="table-responsive">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Vaccine Name</th>
                                <th>Status</th>
                                <th>Last Dose Administered</th>
                                <th>Booster / Next Due</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.vaccinations.map(v => `
                                <tr>
                                    <td><strong>${v.name}</strong></td>
                                    <td><span class="vax-badge ${v.status}">${v.status}</span></td>
                                    <td>${v.date}</td>
                                    <td style="color:${v.nextDue.includes('OVERDUE') || v.nextDue.includes('IMMEDIATE') ? '#dc2626' : '#166534'}; font-weight:700;">
                                        ${v.nextDue}
                                    </td>
                                    <td>
                                        ${v.status === 'UNVACCINATED' ? `
                                            <button onclick="markVaccinated('${data.tag}', '${v.name}')" class="btn-detect-gps" style="position:static; padding:0.3rem 0.6rem;">
                                                <i class="fa-solid fa-syringe"></i> Mark Vaccinated
                                            </button>
                                        ` : `
                                            <span style="color:#059669; font-size:0.8rem; font-weight:600;"><i class="fa-solid fa-check"></i> Up-to-date</span>
                                        `}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    } catch (e) {
        container.innerHTML = `<p style="color:var(--danger);">Failed to query vaccination records.</p>`;
    }
}

async function markVaccinated(tag, vaccineName) {
    const date = new Date().toISOString().split('T')[0];
    await fetch('/api/vaccinations/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, vaccineName, date, nextDue: '2027-03-01' })
    });
    alert(`Marked ${vaccineName} as VACCINATED for ${tag}`);
    searchVaccinationRecord();
}

// --- 8. LAB REFERRALS & HERD LOOKUP ---
async function dispatchLabSample(reportId, sampleType) {
    const labName = prompt('Enter Destination Regional Diagnostic Lab:', 'State Animal Disease Diagnostic Laboratory');
    if (!labName) return;

    await fetch('/api/labs/refer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, sampleType, labName, paravetName: 'Verified Field Officer' })
    });
    alert('Specimen dispatched into cold chain transit!');
}

async function loadLabReferrals() {
    const res = await fetch('/api/labs');
    const labs = await res.json();
    const tbody = document.getElementById('labTableBody');

    if (!tbody) return;

    if (labs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-text">No active laboratory referrals.</td></tr>`;
        return;
    }

    tbody.innerHTML = labs.slice().reverse().map(l => `
        <tr>
            <td><strong>${l.sampleId}</strong></td>
            <td>${l.reportId}</td>
            <td>${l.sampleType}</td>
            <td>${l.labName}</td>
            <td><span class="status-indicator" style="display:inline-flex;">${l.status}</span></td>
            <td><strong>${l.result}</strong></td>
            <td>
                ${l.result === 'PENDING' ? `
                    <button onclick="updateLab('${l.sampleId}', 'CONFIRMED')" class="btn-detect-gps" style="position:static;">Confirm</button>
                    <button onclick="updateLab('${l.sampleId}', 'NEGATIVE')" class="btn-detect-gps" style="position:static; background:#64748b;">Negative</button>
                ` : 'Verified'}
            </td>
        </tr>
    `).join('');
}

async function updateLab(sampleId, result) {
    await fetch('/api/labs/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sampleId, status: 'TESTED', result })
    });
    loadLabReferrals();
}

async function searchAnimalTag() {
    const tag = document.getElementById('tagSearchInput').value.trim();
    if (!tag) return;

    const res = await fetch(`/api/herds/${tag}`);
    const container = document.getElementById('tagResultContainer');

    if (!res.ok) {
        container.innerHTML = `<p style="color:var(--danger); margin-top:1rem;">No disease history record found for Tag: ${tag}</p>`;
        return;
    }
    const data = await res.json();
    container.innerHTML = `
        <div style="background:var(--surface-alt); padding:1.2rem; border-radius:10px; border:1px solid var(--border); margin-top:1rem;">
            <h4>Animal Tag: ${data.tag} (${data.species})</h4>
            <p style="font-size:0.85rem; color:var(--text-muted);"><strong>Owner:</strong> ${data.owner} | <strong>Village:</strong> ${data.village}</p>
            <h5 style="margin-top:0.8rem; font-size:0.9rem;">Clinical History:</h5>
            <ul style="margin-left:1.2rem; font-size:0.85rem; margin-top:0.4rem;">
                ${data.history.map(h => `
                    <li>
                        <strong>${new Date(h.date).toLocaleDateString()}:</strong> ${h.problem} (${h.symptoms.join(', ')})
                        ${h.notes ? `<br><em>Notes: "${h.notes}"</em>` : ''}
                        ${h.imageUrl ? `<br><img src="${h.imageUrl}" style="max-height:80px; border-radius:4px; margin-top:4px;" />` : ''}
                    </li>
                `).join('')}
            </ul>
        </div>
    `;
}

// --- 9. OFFLINE SYNC CHECKS ---
function checkOfflineQueue() {
    const queue = JSON.parse(localStorage.getItem('offlineReports') || '[]');
    const banner = document.getElementById('syncBanner');
    const countEl = document.getElementById('offlineCount');
    if (banner && countEl) {
        if (queue.length > 0) {
            banner.style.display = 'flex';
            countEl.innerText = queue.length;
        } else {
            banner.style.display = 'none';
        }
    }
}
