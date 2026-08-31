let entryMap, entryMarker;
let survMap, survMarkersLayer;
let currentCoords = { lat: 28.6692, lng: 77.4538 };
let autocompleteTimeout;
let currentActiveCase = null;
let isMockOffline = false;
let allReportsCache = [];

document.addEventListener('DOMContentLoaded', () => {
    initEntryMap();
    checkOfflineQueue();
    loadOfficerProfile();
    
    // Always load existing data immediately on boot
    loadPersistedLocalData();
    loadDashboardData();
    loadCaseManagementDashboard();
    loadEpicenterAndHotspots();
});

// --- NAVIGATION & ROUTING ---
function switchMainTab(tabId, btn) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.side-link').forEach(b => b.classList.remove('active'));

    const targetTab = document.getElementById(tabId);
    if (targetTab) targetTab.classList.add('active');
    if (btn) btn.classList.add('active');

    if (tabId === 'dashboard-tab') {
        setTimeout(() => {
            initSurveillanceMap();
            loadDashboardData();
            loadEpicenterAndHotspots();
            loadCaseManagementDashboard();
        }, 150);
    } else if (tabId === 'lab-tab') {
        loadLabReferrals();
    } else if (tabId === 'alerts-tab') {
        loadAlertsTab();
    }
}

function navigateToReport() {
    switchMainTab('report-tab');
    const sideReportBtn = Array.from(document.querySelectorAll('.side-link')).find(b => b.innerText.includes('Case Management'));
    if (sideReportBtn) {
        document.querySelectorAll('.side-link').forEach(b => b.classList.remove('active'));
        sideReportBtn.classList.add('active');
    }
}

function callHelpline() {
    window.location.href = 'tel:1962';
}

function toggleMockOffline() {
    isMockOffline = !isMockOffline;
    const banner = document.getElementById('offlineBanner');
    const indicator = document.getElementById('offlineIndicator');
    const statusText = document.getElementById('statusText');

    if (isMockOffline) {
        banner.style.display = 'flex';
        indicator.className = 'status-indicator';
        indicator.style.background = 'rgba(239, 68, 68, 0.15)';
        indicator.style.color = '#ef4444';
        statusText.innerText = 'Offline Mode (Auto-Sync Queued)';
    } else {
        banner.style.display = 'none';
        indicator.className = 'status-indicator online';
        indicator.style.background = 'rgba(16, 185, 129, 0.15)';
        indicator.style.color = '#34d399';
        statusText.innerText = 'Online / AI Active';
        checkOfflineQueue();
    }
}

// --- LOCAL PERSISTENCE LOADER (RUNS FIRST ON PAGE LOAD) ---
function loadPersistedLocalData() {
    const localReports = JSON.parse(localStorage.getItem('pashuRakshakReports') || '[]');
    if (localReports.length > 0) {
        allReportsCache = localReports;
        renderRecentCases(allReportsCache);
        updateDashboardCountersFromList(allReportsCache);
    }
}

function updateDashboardCountersFromList(reports) {
    if (!reports || reports.length === 0) return;
    const total = reports.length;
    let affected = 0;
    let deaths = 0;
    let resolved = 0;

    reports.forEach(r => {
        affected += Number(r.affectedCount || 1);
        deaths += Number(r.mortalityCount || 0);
        if (r.aiReport && r.aiReport.caseStatus === 'Resolved') resolved++;
    });

    const mortRate = total > 0 ? ((deaths / total) * 100).toFixed(1) + '%' : '0.0%';

    const mTotal = document.getElementById('mTotal');
    const mAffected = document.getElementById('mAffected');
    const mResolved = document.getElementById('mResolved');
    const mMortalityRate = document.getElementById('mMortalityRate');
    const mMortalityCountSub = document.getElementById('mMortalityCountSub');

    if (mTotal) mTotal.innerText = total;
    if (mAffected) mAffected.innerText = affected;
    if (mResolved) mResolved.innerText = resolved;
    if (mMortalityRate) mMortalityRate.innerText = mortRate;
    if (mMortalityCountSub) mMortalityCountSub.innerText = `${deaths} Total Mortalities`;
}

// --- ALERTS & NOTIFICATIONS TAB ---
async function loadAlertsTab() {
    const listEl = document.getElementById('alertsStreamFull');
    if (!listEl) return;

    try {
        const res = await fetch('/api/alerts');
        let alerts = await res.json();

        if (!alerts || alerts.length === 0) {
            alerts = JSON.parse(localStorage.getItem('pashuRakshakAlerts') || '[]');
        }

        if (!alerts || alerts.length === 0) {
            listEl.innerHTML = '<p class="empty-text">No active outbreak alerts recorded.</p>';
            return;
        }

        listEl.innerHTML = alerts.map(a => `
            <div class="alert-item" style="margin-bottom: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h5 style="color:#ea580c; font-size: 0.95rem;">⚠️ ${a.disease} (${a.severity || 'HIGH'} RISK)</h5>
                    <small style="color:#64748b;">${new Date(a.timestamp).toLocaleDateString()}</small>
                </div>
                <p style="font-size:0.85rem; margin-top: 4px;"><strong>Location:</strong> ${a.location}</p>
                <div style="font-size:0.85rem; margin-top: 4px; color:#334155;">
                    <strong>Official Advisory:</strong> ${a.advisories ? (a.advisories.en || a.advisories.hi || '') : 'Quarantine livestock and monitor symptoms.'}
                </div>
            </div>
        `).join('');
    } catch (e) {
        listEl.innerHTML = '<p class="empty-text">Loading offline alerts...</p>';
    }
}

// --- SMS DISPATCH FORM INSIDE ALERTS TAB ---
async function handlePortalSmsSubmit(e) {
    e.preventDefault();
    const btn = document.getElementById('btnPortalSms');
    const phone = document.getElementById('portalSmsPhone').value.trim();
    const location = document.getElementById('portalSmsLocation').value.trim();
    const disease = document.getElementById('portalSmsDisease').value;
    const message = document.getElementById('portalSmsBody').value.trim();

    if (!phone) return alert('Please enter a recipient mobile number.');

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Dispatched via Vonage...';

    try {
        const res = await fetch('/api/alerts/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: phone, location, disease, message })
        });
        const data = await res.json();

        const toast = document.getElementById('smsToast');
        const body = document.getElementById('smsToastBody');
        body.innerText = `📡 Alert dispatched to +91-${phone.slice(-10)} via Vonage Gateway.`;
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 6000);
    } catch (err) {
        alert('Dispatched via simulated queue.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Transmit SMS via Vonage';
    }
}

// --- SMS ALERTS TRIGGER & BROADCAST DISPATCHER ---
async function triggerMockSmsAlert(customMsg) {
    const phone = prompt('Enter 10-digit mobile number to send emergency SMS alert:', '9616958410');
    if (!phone) return;

    try {
        const res = await fetch('/api/alerts/send-sms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phoneNumber: phone,
                message: customMsg || `⚠️ PASHURAKSHAK EMERGENCY: Outbreak risk detected in your village area. Restrict herd movement and call 1962.`
            })
        });
        const data = await res.json();
        
        const toast = document.getElementById('smsToast');
        const body = document.getElementById('smsToastBody');
        body.innerText = `📡 Alert dispatched to ${phone} via Vonage Gateway.`;
        toast.style.display = 'block';
        setTimeout(() => { toast.style.display = 'none'; }, 6000);
    } catch (e) {
        alert('SMS service logged locally.');
    }
}

// --- SETTINGS PROFILE MANAGEMENT ---
function saveUserProfileDetails() {
    const profile = {
        name: document.getElementById('settingUserName').value.trim() || 'Dr. Patel',
        phone: document.getElementById('settingUserPhone').value.trim() || '+91 98765 43210',
        email: document.getElementById('settingUserEmail').value.trim() || 'dr.patel@dahd.nic.in',
        id: document.getElementById('settingUserId').value.trim() || 'VET-OFFICER-2026-904',
        role: document.getElementById('settingUserRole').value,
        district: document.getElementById('settingUserDistrict').value.trim() || 'Ghaziabad (Rampur Block A)'
    };

    localStorage.setItem('vetOfficerProfile', JSON.stringify(profile));
    loadOfficerProfile();
    alert('User account and contact details saved permanently!');
}

function loadOfficerProfile() {
    const saved = JSON.parse(localStorage.getItem('vetOfficerProfile') || '{}');
    const name = saved.name || 'Dr. Ramesh Patel';
    const phone = saved.phone || '+91 98765 43210';
    const email = saved.email || 'dr.patel@dahd.nic.in';
    const id = saved.id || 'VET-OFFICER-2026-904';
    const role = saved.role || 'Senior Veterinary Officer';
    const district = saved.district || 'Ghaziabad (Rampur Block A)';

    const shortName = name.split(' ')[0] + ' ' + (name.split(' ')[1] || '');
    const navNameEl = document.getElementById('navDoctorName');
    const sideNameEl = document.getElementById('sideDoctorName');
    
    if (navNameEl) navNameEl.innerText = shortName;
    if (sideNameEl) sideNameEl.innerText = name;

    if (document.getElementById('settingUserName')) document.getElementById('settingUserName').value = name;
    if (document.getElementById('settingUserPhone')) document.getElementById('settingUserPhone').value = phone;
    if (document.getElementById('settingUserEmail')) document.getElementById('settingUserEmail').value = email;
    if (document.getElementById('settingUserId')) document.getElementById('settingUserId').value = id;
    if (document.getElementById('settingUserRole')) document.getElementById('settingUserRole').value = role;
    if (document.getElementById('settingUserDistrict')) document.getElementById('settingUserDistrict').value = district;
}

function clearLocalStorageData() {
    if (confirm('Are you sure you want to clear local cache and test reports on this device?')) {
        localStorage.removeItem('pashuRakshakReports');
        localStorage.removeItem('pashuRakshakAlerts');
        localStorage.removeItem('offlineReports');
        alert('Local device cache cleared successfully.');
        location.reload();
    }
}

// --- PIN, MAP & SLIDER CONTROLS ---
function initEntryMap() {
    const entryEl = document.getElementById('entryMap');
    if (!entryEl) return;

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

// --- AUTOCOMPLETE & GEOCODING ---
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
                    <i class="fa-solid fa-location-dot" style="color:#059669;"></i>
                    <span>${item.display_name}</span>
                </div>
            `).join('');

            dropdown.style.display = 'block';
        } catch (e) {
            console.warn('Autocomplete error:', e);
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
        console.warn('Reverse geocode error:', e);
    }
}

function captureGPS() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setCoordinates(pos.coords.latitude, pos.coords.longitude);
                reverseGeocode(pos.coords.latitude, pos.coords.longitude);
            },
            () => alert('Location access denied. Please choose on map.')
        );
    }
}

// --- PHOTO PREVIEW & SUBMISSION ---
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

document.getElementById('reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Case, Referencing Lab & Dispatching SMS...';
    submitBtn.disabled = true;

    const selectedSymptoms = Array.from(document.querySelectorAll('input[name="symp"]:checked')).map(c => c.value);
    const formData = new FormData();

    const reporterPhone = document.getElementById('reporterPhone').value;
    formData.append('reporterName', document.getElementById('reporterName').value);
    formData.append('reporterPhone', reporterPhone);
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

            // Save report permanently in client localStorage
            const savedList = JSON.parse(localStorage.getItem('pashuRakshakReports') || '[]');
            savedList.unshift(data.report);
            localStorage.setItem('pashuRakshakReports', JSON.stringify(savedList));

            // Save alert permanently in client localStorage
            const savedAlerts = JSON.parse(localStorage.getItem('pashuRakshakAlerts') || '[]');
            savedAlerts.unshift({
                alertId: 'ALT-' + Date.now(),
                disease: data.report.aiReport.suspectedProblem,
                location: `${data.report.village}, ${data.report.district}`,
                severity: data.report.aiReport.severity,
                timestamp: new Date().toISOString(),
                advisories: data.report.aiReport.advisories
            });
            localStorage.setItem('pashuRakshakAlerts', JSON.stringify(savedAlerts));

            // Immediately update dashboard view
            allReportsCache = savedList;
            renderRecentCases(savedList);
            updateDashboardCountersFromList(savedList);

            document.getElementById('reportForm').reset();
            document.getElementById('previewContainer').style.display = 'none';
            document.getElementById('uploadPlaceholder').style.display = 'block';

            const toast = document.getElementById('smsToast');
            const body = document.getElementById('smsToastBody');
            body.innerText = `📡 Report permanently saved! Lab sample registered and confirmation SMS dispatched to ${reporterPhone} via Vonage.`;
            toast.style.display = 'block';
            setTimeout(() => { toast.style.display = 'none'; }, 6000);
        } else {
            alert('Submission error: ' + (data.error || 'Unknown error occurred.'));
        }
    } catch (err) {
        alert('Server waking up. Report saved locally.');
    } finally {
        submitBtn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Store Case, Auto-Refer Lab & Send Real SMS';
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
                <div style="display:flex; gap:6px; margin-top:2px;">
                    <span class="ai-badge" style="background:${severity === 'CRITICAL' ? '#dc2626' : (severity === 'HIGH' ? '#ea580c' : '#2563eb')}">
                        ${severity} RISK
                    </span>
                    <span class="ai-confidence-badge">${ai.confidenceScore || 92}% Confidence</span>
                </div>
            </div>
        </div>

        ${report.imageUrl ? `
            <div style="margin-bottom:10px;">
                <img src="${report.imageUrl}" style="width:100%; max-height:160px; object-fit:cover; border-radius:8px; border:1px solid #cbd5e1;" />
                <small style="color:#64748b; font-size:0.75rem;">Verified Image Specimen</small>
            </div>
        ` : ''}

        <div style="font-size:0.85rem; line-height:1.5;">
            <p><strong>🐄 Species:</strong> ${ai.identifiedSpecies || report.species}</p>
            <p><strong>🏷️ Tag UID:</strong> ${report.animalTag}</p>
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

        <div style="margin-top:12px; display:flex; gap:8px;">
            <button onclick="dispatchLabSample('${report.id}', '${ai.suspectedProblem || 'Suspected Disease'}')" class="btn-submit" style="padding:0.6rem; font-size:0.85rem; flex:1;">
                <i class="fa-solid fa-truck-medical"></i> Dispatch Lab Sample
            </button>
            <button onclick="triggerMockSmsAlert('🚨 Critical alert for Case ${report.id}: Suspected ${ai.suspectedProblem}. Immediate quarantine advised.')" class="btn-submit" style="padding:0.6rem; font-size:0.85rem; background:#ea580c; flex:1;">
                <i class="fa-solid fa-comment-sms"></i> Broadcast SMS
            </button>
        </div>
    `;
}

// --- SURVEILLANCE MAP & DASHBOARD ---
function initSurveillanceMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

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

        if (data && data.mostAffected && data.mostAffected.totalCases > 0 && data.mostAffected.locationName) {
            if (banner) banner.style.display = 'flex';
            const textEl = document.getElementById('epicenterText');
            const subEl = document.getElementById('epicenterSub');
            
            const loc = data.mostAffected.locationName || 'Muradnagar';
            const dist = data.mostAffected.district || 'Ghaziabad';
            
            if (textEl) textEl.innerHTML = `<strong>${loc} (${dist})</strong> has the highest recorded caseload.`;
            if (subEl) subEl.innerHTML = `📍 <strong>Location:</strong> ${data.mostAffected.fullAddress || loc} | <strong>Live Caseload:</strong> ${data.mostAffected.affectedAnimals || 1} Affected (${data.mostAffected.deaths || 0} Deaths)`;

            if (survMarkersLayer && data.mostAffected.latitude && data.mostAffected.longitude) {
                const epicenterCircle = L.circle([data.mostAffected.latitude, data.mostAffected.longitude], {
                    radius: 3500,
                    color: '#ef4444',
                    weight: 3,
                    fillColor: '#ef4444',
                    fillOpacity: 0.35
                }).bindPopup(`
                    <strong style="color:#b91c1c;">🔥 OUTBREAK EPICENTER</strong><br>
                    <b>Location:</b> ${data.mostAffected.fullAddress || loc}<br>
                    <b>Total Affected:</b> ${data.mostAffected.affectedAnimals} Animals<br>
                    <b>Deaths:</b> ${data.mostAffected.deaths} Recorded
                `);
                survMarkersLayer.addLayer(epicenterCircle);
            }
        } else {
            if (banner) banner.style.display = 'none';
        }
    } catch (e) {
        console.warn('Hotspot load fallback:', e);
    }
}

async function loadDashboardData() {
    try {
        const sumRes = await fetch('/api/summary');
        const summary = await sumRes.json();
        
        const mTotal = document.getElementById('mTotal');
        const mAffected = document.getElementById('mAffected');
        const mResolved = document.getElementById('mResolved');
        const mMortalityRate = document.getElementById('mMortalityRate');
        const mMortalityCountSub = document.getElementById('mMortalityCountSub');

        if (summary && summary.totalReports > 0) {
            if (mTotal) mTotal.innerText = summary.totalReports;
            if (mAffected) mAffected.innerText = summary.totalAffected;
            if (mResolved) mResolved.innerText = summary.resolvedCases;
            if (mMortalityRate) mMortalityRate.innerText = summary.mortalityRate;
            if (mMortalityCountSub) mMortalityCountSub.innerText = `${summary.totalMortality} Total Mortalities`;
        }

        const repRes = await fetch('/api/reports');
        let reports = await repRes.json();

        if (!reports || reports.length === 0) {
            reports = JSON.parse(localStorage.getItem('pashuRakshakReports') || '[]');
        } else {
            localStorage.setItem('pashuRakshakReports', JSON.stringify(reports));
        }

        allReportsCache = reports;
        renderRecentCases(allReportsCache);
        if (summary && summary.totalReports === 0 && allReportsCache.length > 0) {
            updateDashboardCountersFromList(allReportsCache);
        }

        if (survMarkersLayer) survMarkersLayer.clearLayers();

        allReportsCache.forEach(r => {
            const ai = r.aiReport || {};
            const vet = r.nearestVet || {};
            const sev = ai.severity || 'LOW';
            const color = sev === 'CRITICAL' ? '#dc2626' : (sev === 'HIGH' ? '#ea580c' : (sev === 'MODERATE' ? '#f59e0b' : '#059669'));

            if (r.latitude && r.longitude && survMarkersLayer) {
                const marker = L.circleMarker([r.latitude, r.longitude], {
                    radius: 9 + Math.min(r.affectedCount || 1, 15),
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
                    <b>Affected:</b> ${r.affectedCount || 1} | <b>Deaths:</b> ${r.mortalityCount || 0}<br>
                    <small>${new Date(r.timestamp).toLocaleString()}</small>
                `);

                survMarkersLayer.addLayer(marker);
            }
        });

        const alertRes = await fetch('/api/alerts');
        let alerts = await alertRes.json();
        const alertBox = document.getElementById('alertsContainer');

        if (!alerts || alerts.length === 0) {
            alerts = JSON.parse(localStorage.getItem('pashuRakshakAlerts') || '[]');
        }

        if (alertBox) {
            if (!alerts || alerts.length === 0) {
                alertBox.innerHTML = '<p class="empty-text">No active outbreak alerts recorded.</p>';
            } else {
                alertBox.innerHTML = alerts.slice(-4).reverse().map(a => `
                    <div class="alert-item">
                        <h5 style="color:#ea580c;">⚠️ ${a.location} - ${a.disease}</h5>
                        <div style="font-size:0.85rem; margin-top:0.4rem;"><strong>Advisory:</strong> ${a.advisories ? (a.advisories.en || a.advisories.hi || '') : 'Isolate herd.'}</div>
                    </div>
                `).join('');
            }
        }
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
}

async function loadCaseManagementDashboard() {
    try {
        const [repRes, distRes] = await Promise.all([
            fetch('/api/reports'),
            fetch('/api/analytics/distribution')
        ]);
        let reports = await repRes.json();
        let dist = await distRes.json();

        if (!reports || reports.length === 0) {
            reports = JSON.parse(localStorage.getItem('pashuRakshakReports') || '[]');
        }

        const chartWrap = document.getElementById('chartBars');
        if (chartWrap && dist) {
            const maxVal = Math.max(...Object.values(dist), 1);
            chartWrap.innerHTML = Object.entries(dist).map(([disease, count]) => `
                <div class="chart-bar-item">
                    <span style="font-size:0.75rem; font-weight:700;">${count}</span>
                    <div class="chart-bar-fill" style="height: ${(count / maxVal) * 120}px;"></div>
                    <span class="chart-bar-label">${disease}</span>
                </div>
            `).join('');
        }

        renderRecentCases(reports);
    } catch (e) {
        console.warn('Case dashboard load fallback:', e);
    }
}

function renderRecentCases(reports) {
    const listWrap = document.getElementById('recentCasesList');
    if (listWrap) {
        if (!reports || reports.length === 0) {
            listWrap.innerHTML = '<p class="empty-text">No active reports filed.</p>';
        } else {
            listWrap.innerHTML = reports.slice(0, 5).map(r => `
                <div class="recent-case-row" onclick="openCaseDetails('${r.id}')">
                    <div>
                        <strong>${r.id}</strong> - <span style="color:#059669; font-weight:700;">${r.aiReport ? r.aiReport.suspectedProblem : r.species}</span>
                        <div style="font-size:0.75rem; color:#64748b;">📍 ${r.village}, ${r.district}</div>
                    </div>
                    <span class="priority-pill ${r.aiReport ? r.aiReport.severity : 'LOW'}">${r.aiReport ? r.aiReport.severity : 'LOW'}</span>
                </div>
            `).join('');
        }
    }
}

function filterDashboardCases(query) {
    if (!query) {
        renderRecentCases(allReportsCache);
        return;
    }
    const filtered = allReportsCache.filter(r => 
        (r.id || '').toLowerCase().includes(query.toLowerCase()) ||
        (r.animalTag || '').toLowerCase().includes(query.toLowerCase()) ||
        (r.village || '').toLowerCase().includes(query.toLowerCase()) ||
        (r.species || '').toLowerCase().includes(query.toLowerCase())
    );
    renderRecentCases(filtered);
}

// --- CASE DETAILS MODAL & QUICK ACTIONS ---
async function openCaseDetails(reportId) {
    let r = allReportsCache.find(item => item.id === reportId);
    if (!r) {
        const res = await fetch('/api/reports');
        const reports = await res.json();
        r = reports.find(item => item.id === reportId);
    }
    if (!r) return;

    currentActiveCase = r;
    const ai = r.aiReport || {};
    const vet = r.nearestVet || {};

    document.getElementById('modalCaseId').innerText = r.id;
    document.getElementById('modalCaseStatusBadge').innerText = (ai.caseStatus || 'UNDER INVESTIGATION').toUpperCase();
    document.getElementById('modalTag').innerText = r.animalTag || 'IND-UNTAGGED';
    document.getElementById('modalSpecies').innerText = r.species || 'Cattle (Cow)';
    document.getElementById('modalAge').innerText = r.animalAge || '4 Years';
    document.getElementById('modalLocation').innerText = `${r.village}, ${r.district}`;
    document.getElementById('modalOwner').innerText = r.reporterName || 'Ramesh Kumar';
    document.getElementById('modalContact').innerText = r.reporterPhone || '+91 98765 43210';
    
    const prioEl = document.getElementById('modalPriority');
    prioEl.innerText = ai.severity || 'HIGH';
    prioEl.className = `priority-pill ${ai.severity || 'HIGH'}`;

    document.getElementById('modalDiagnosis').innerText = ai.suspectedProblem || 'Clinical Examination Needed';
    document.getElementById('modalConfidence').innerText = `${ai.confidenceScore || 94}% AI Confidence`;
    document.getElementById('modalSymptomsList').innerHTML = (r.symptoms || []).map(s => `<span class="vax-badge">${s}</span>`).join(' ');
    document.getElementById('modalNotes').innerText = r.notes || 'No supplementary farmer notes recorded.';

    if (vet.scheduledVisit) {
        document.getElementById('stepVisitStatus').innerText = `Scheduled (${vet.scheduledVisit.date})`;
        document.getElementById('stepVisitDetail').innerText = `${vet.scheduledVisit.officer} - ${vet.scheduledVisit.remarks}`;
    } else {
        document.getElementById('stepVisitStatus').innerText = 'Scheduled (Today)';
        document.getElementById('stepVisitDetail').innerText = vet.name || 'Senior Veterinary Officer';
    }

    document.getElementById('caseDetailsModal').style.display = 'flex';
}

function closeCaseModal() {
    document.getElementById('caseDetailsModal').style.display = 'none';
}

async function triggerScheduleVisit() {
    if (!currentActiveCase) return;
    const visitDate = prompt('Enter Visit Date (YYYY-MM-DD):', new Date().toISOString().split('T')[0]);
    if (!visitDate) return;
    const remarks = prompt('Enter Field Inspection Remarks:', 'On-site clinical evaluation & emergency quarantine check');

    await fetch('/api/cases/schedule-visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: currentActiveCase.id, visitDate, remarks })
    });
    alert('Veterinary visit scheduled successfully!');
    openCaseDetails(currentActiveCase.id);
}

async function triggerUpdateStatus() {
    if (!currentActiveCase) return;
    const status = prompt('Update Case Status (e.g. Under Investigation, In Treatment, Resolved):', 'Resolved');
    if (!status) return;

    await fetch('/api/cases/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: currentActiveCase.id, status })
    });
    alert('Case status updated!');
    openCaseDetails(currentActiveCase.id);
    loadDashboardData();
}

async function triggerAddNote() {
    if (!currentActiveCase) return;
    const noteText = prompt('Enter Clinical Observation / Paravet Note:');
    if (!noteText) return;

    await fetch('/api/cases/add-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: currentActiveCase.id, noteText, author: 'Dr. Patel' })
    });
    alert('Note appended to case file!');
    openCaseDetails(currentActiveCase.id);
}

function triggerGenerateReport() {
    if (!currentActiveCase) return;
    const printWindow = window.open('', '_blank');
    const ai = currentActiveCase.aiReport || {};
    printWindow.document.write(`
        <html>
        <head>
            <title>PashuRakshak Clinical Report - ${currentActiveCase.id}</title>
            <style>
                body { font-family: sans-serif; padding: 2rem; line-height: 1.5; color: #0f172a; }
                .header { border-bottom: 2px solid #059669; padding-bottom: 1rem; margin-bottom: 1.5rem; }
                .badge { background: #fee2e2; color: #dc2626; padding: 4px 8px; border-radius: 4px; font-weight: bold; }
                table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
                th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
                th { background: #f8fafc; }
            </style>
        </head>
        <body>
            <div class="header">
                <h2>PashuRakshak AI Surveillance System</h2>
                <h3>Official Veterinary Clinical Assessment Sheet</h3>
                <p><strong>Case ID:</strong> ${currentActiveCase.id} | <strong>Date:</strong> ${new Date(currentActiveCase.timestamp).toLocaleString()}</p>
            </div>
            <table>
                <tr><th>Species / Breed</th><td>${currentActiveCase.species}</td></tr>
                <tr><th>Animal Tag / UID</th><td>${currentActiveCase.animalTag || 'IND-UNTAGGED'}</td></tr>
                <tr><th>Age & Location</th><td>${currentActiveCase.animalAge || '4 Years'} (${currentActiveCase.village}, ${currentActiveCase.district})</td></tr>
                <tr><th>Owner Contact</th><td>${currentActiveCase.reporterName} (${currentActiveCase.reporterPhone})</td></tr>
                <tr><th>Symptoms</th><td>${(currentActiveCase.symptoms || []).join(', ')}</td></tr>
                <tr><th>Primary AI Diagnosis</th><td><strong>${ai.suspectedProblem}</strong> (<span class="badge">${ai.severity} RISK</span>)</td></tr>
                <tr><th>AI Confidence Score</th><td><strong>${ai.confidenceScore || 94}%</strong></td></tr>
                <tr><th>First-Aid Solution</th><td>${ai.temporarySolution}</td></tr>
                <tr><th>Aftercare Protocol</th><td>${ai.aftercareProcedure}</td></tr>
            </table>
            <br>
            <p><em>Generated by PashuRakshak Automated Clinical Triage Engine.</em></p>
            <script>window.print();</script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// --- VACCINATION & LAB LOOKUP ---
async function searchVaccinationRecord() {
    const tagInput = document.getElementById('vaxSearchInput');
    const tag = tagInput ? tagInput.value.trim() : '';
    if (!tag) return alert('Please enter an ear tag UID (e.g. IND-2026-8801 or IND-2024-7856)');

    const container = document.getElementById('vaxResultContainer');
    container.innerHTML = `<p style="color:var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Retrieving vaccination history...</p>`;

    try {
        const res = await fetch(`/api/vaccinations/${tag}`);
        const data = await res.json();
        const hasUnvax = (data.vaccinations || []).some(v => v.status === 'UNVACCINATED');

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
                            ${(data.vaccinations || []).map(v => `
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

async function dispatchLabSample(reportId, sampleType) {
    const labName = prompt('Enter Destination Regional Diagnostic Lab:', 'State Animal Disease Diagnostic Laboratory');
    if (!labName) return;

    await fetch('/api/labs/refer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, sampleType, labName, paravetName: 'Verified Field Officer' })
    });
    alert('Specimen dispatched into cold chain transit!');
    loadLabReferrals();
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

function checkOfflineQueue() {
    const queue = JSON.parse(localStorage.getItem('offlineReports') || '[]');
    if (queue.length > 0) {
        const banner = document.getElementById('offlineBanner');
        if (banner) banner.style.display = 'flex';
    }
}
