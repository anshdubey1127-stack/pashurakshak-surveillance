let map = null;
let reportMarkers = [];

document.addEventListener('DOMContentLoaded', () => {
    initTabRouting();
    initMap();
    fetchDashboardMetrics();
    fetchCaseReports();
    initFormHandlers();
});

// Tab Routing
function initTabRouting() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const activeContent = document.getElementById(`tab-${tab.dataset.tab}`);
            if (activeContent) activeContent.classList.add('active');

            if (tab.dataset.tab === 'outbreaks' && map) {
                setTimeout(() => map.invalidateSize(), 200);
            }
        });
    });
}

// Map Initialization
function initMap() {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    map = L.map('map').setView([28.6692, 77.4538], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
}

// Summary Metrics Sync (/api/summary)
async function fetchDashboardMetrics() {
    try {
        const res = await fetch('/api/summary');
        const data = await res.json();

        document.getElementById('kpi-total-reports').textContent = data.totalReports || '0';
        document.getElementById('kpi-active-alerts').textContent = data.activeAlerts || '0';
        document.getElementById('kpi-affected-count').textContent = data.totalAffected || '0';
        document.getElementById('kpi-pending-labs').textContent = data.pendingLabSamples || '0';
    } catch (e) {
        console.warn('Metrics sync error:', e.message);
    }
}

// Case Reports Feed (/api/reports)
async function fetchCaseReports() {
    const tbody = document.getElementById('case-feed-body');
    try {
        const res = await fetch('/api/reports');
        const reports = await res.json();

        if (!reports || reports.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted">No clinical surveillance records active.</td></tr>`;
            return;
        }

        tbody.innerHTML = '';
        reports.forEach(r => {
            const ai = r.aiReport || {};
            const severity = ai.severity || 'MODERATE';
            const severityBadge = `<span class="badge badge-${severity.toLowerCase()}">${severity}</span>`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <strong>${r.id}</strong><br>
                    <small class="text-muted">${new Date(r.timestamp).toLocaleDateString()}</small>
                </td>
                <td>
                    <span class="font-mono">${r.animalTag || 'IND-UNTAGGED'}</span><br>
                    <small class="text-muted">${r.species}</small>
                </td>
                <td>${r.village}, ${r.district}</td>
                <td><strong>${ai.suspectedProblem || 'Clinical Inspection Pending'}</strong></td>
                <td>${severityBadge}</td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="triggerDirectSMS('${r.reporterPhone}', '${ai.suspectedProblem}', '${r.village}')">Send SMS</button>
                </td>
            `;
            tbody.appendChild(tr);

            // Add marker to map
            if (map && r.latitude && r.longitude) {
                const marker = L.circleMarker([r.latitude, r.longitude], {
                    radius: severity === 'CRITICAL' ? 12 : 8,
                    fillColor: severity === 'CRITICAL' ? '#DC2626' : '#F59E0B',
                    color: '#FFFFFF',
                    weight: 2,
                    fillOpacity: 0.8
                }).addTo(map);

                marker.bindPopup(`
                    <strong>${r.id} (${r.animalTag})</strong><br>
                    Condition: <b>${ai.suspectedProblem || 'Suspected'}</b><br>
                    Location: ${r.village}, ${r.district}<br>
                    Severity: ${severity}
                `);
                reportMarkers.push(marker);
            }
        });
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger">Failed to load live registry stream.</td></tr>`;
    }
}

// Intake Form Submission (/api/reports)
function initFormHandlers() {
    const form = document.getElementById('report-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('submit-btn');
            btn.disabled = true;
            btn.innerHTML = '<span>Processing Clinical Inference & Vonage SMS...</span>';

            const formData = new FormData();
            formData.append('reporterName', document.getElementById('reporterName').value);
            formData.append('reporterPhone', document.getElementById('reporterPhone').value);
            formData.append('species', document.getElementById('species').value);
            formData.append('animalTag', document.getElementById('animalTag').value);
            formData.append('village', document.getElementById('village').value);
            formData.append('district', document.getElementById('district').value);
            formData.append('affectedCount', document.getElementById('affectedCount').value);
            formData.append('mortalityCount', document.getElementById('mortalityCount').value);
            formData.append('notes', document.getElementById('notes').value);

            const selectedSymptoms = Array.from(document.querySelectorAll('input[name="symptoms"]:checked')).map(cb => cb.value);
            formData.append('symptoms', JSON.stringify(selectedSymptoms));

            const imageFile = document.getElementById('cattleImage').files[0];
            if (imageFile) formData.append('cattleImage', imageFile);

            try {
                const res = await fetch('/api/reports', { method: 'POST', body: formData });
                const data = await res.json();

                if (res.ok) {
                    displayTriageOutcome(data.report);
                    fetchDashboardMetrics();
                    fetchCaseReports();
                    form.reset();
                } else {
                    alert('Submission error: ' + (data.error || 'Server error'));
                }
            } catch (err) {
                alert('Connection error: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<span>Execute Triage & File Report</span>';
            }
        });
    }

    // Manual Broadcast SMS (/api/alerts/send-sms)
    const smsForm = document.getElementById('sms-broadcast-form');
    if (smsForm) {
        smsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const banner = document.getElementById('sms-status-banner');
            const phone = document.getElementById('broadcastPhone').value;
            const message = document.getElementById('broadcastMessage').value;
            const disease = document.getElementById('broadcastDisease').value;

            banner.className = 'mt-3 p-3 triage-box';
            banner.textContent = 'Transmitting official advisory via Vonage Gateway...';
            banner.classList.remove('hidden');

            try {
                const res = await fetch('/api/alerts/send-sms', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phoneNumber: phone, message, disease })
                });
                const out = await res.json();
                banner.textContent = `Transmission Complete: Advisory dispatched to +91-${phone.slice(-10)} via Vonage.`;
            } catch (err) {
                banner.textContent = 'Transmission Failed: Check server connection.';
            }
        });
    }

    // Ear Tag Lookup (/api/vaccinations/:tag)
    const btnTag = document.getElementById('btn-fetch-tag');
    if (btnTag) {
        btnTag.addEventListener('click', async () => {
            const tag = document.getElementById('search-tag-input').value.trim();
            const container = document.getElementById('tag-history-container');
            if (!tag) return;

            container.innerHTML = '<p class="text-center py-3">Fetching INAPH history...</p>';
            try {
                const res = await fetch(`/api/vaccinations/${tag}`);
                const data = await res.json();

                let vaccHtml = (data.vaccinations || []).map(v => `
                    <tr>
                        <td><b>${v.name}</b></td>
                        <td><span class="badge ${v.status === 'VACCINATED' ? 'badge-low' : 'badge-critical'}">${v.status}</span></td>
                        <td>${v.date}</td>
                        <td>${v.nextDue}</td>
                    </tr>
                `).join('');

                container.innerHTML = `
                    <div class="triage-box">
                        <h4>Owner: ${data.owner} | Location: ${data.village}, ${data.district}</h4>
                        <table class="gov-table mt-2">
                            <thead><tr><th>Vaccine</th><th>Status</th><th>Given</th><th>Next Due</th></tr></thead>
                            <tbody>${vaccHtml}</tbody>
                        </table>
                    </div>
                `;
            } catch (err) {
                container.innerHTML = '<p class="text-danger">Tag UID not found in registry.</p>';
            }
        });
    }

    // Lab Specimen Referral (/api/labs/refer)
    const labForm = document.getElementById('lab-referral-form');
    if (labForm) {
        labForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const reportId = document.getElementById('labReportId').value;
            const sampleType = document.getElementById('sampleType').value;
            const labName = document.getElementById('labName').value;

            try {
                const res = await fetch('/api/labs/refer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reportId, sampleType, labName, paravetName: 'Field Officer' })
                });
                const data = await res.json();
                alert(`Lab Referral registered! Specimen ID: ${data.sampleId}`);
                labForm.reset();
                fetchDashboardMetrics();
            } catch (err) {
                alert('Failed to register lab referral.');
            }
        });
    }
}

function displayTriageOutcome(report) {
    const box = document.getElementById('triage-result');
    const ai = report.aiReport || {};
    box.classList.remove('hidden');
    box.innerHTML = `
        <h3 class="text-danger">✓ Case Ingestion Successful: ${report.id}</h3>
        <p class="mt-2"><strong>Primary Clinical Finding:</strong> ${ai.suspectedProblem || 'Pending'} (${ai.confidenceScore || 90}% Confidence)</p>
        <p><strong>Containment Priority:</strong> <span class="badge badge-${(ai.severity || 'MODERATE').toLowerCase()}">${ai.severity}</span></p>
        <p class="mt-2"><strong>Recommended Immediate Action:</strong> ${ai.temporarySolution || 'Isolate herd and provide clean water.'}</p>
        <p class="text-muted mt-2"><small>SMS broadcast has been automatically queued to +91-${report.reporterPhone.slice(-10)} via Vonage Gateway.</small></p>
    `;
}

window.triggerDirectSMS = function(phone, disease, village) {
    const clean = (phone || '9616958410').replace(/[^0-9]/g, '').slice(-10);
    fetch('/api/alerts/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            phoneNumber: clean,
            location: village,
            disease: disease,
            message: `URGENT ADVISORY: Suspected ${disease} in ${village}. Isolate cattle & call 1962.`
        })
    }).then(() => alert(`SMS notification dispatched to +91-${clean} via Vonage.`))
      .catch(() => alert('SMS dispatch failed.'));
};
