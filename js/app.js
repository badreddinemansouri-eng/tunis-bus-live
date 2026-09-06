// ==================== GLOBAL STATE ====================
let map = null;
let routeData = [];
let activeBuses = {};
let markers = {};
let currentTripId = null;
let watchId = null;
let currentRoute = null;
let currentDirection = 'forward';
let routeLayerGroup = null;
let legendControl = null;
let searchResults = [];

const driverView = document.getElementById('driverView');
const passengerView = document.getElementById('passengerView');
const tabDriver = document.getElementById('tabDriver');
const tabPassenger = document.getElementById('tabPassenger');
const routeSelect = document.getElementById('routeSelect');
const driverNameInput = document.getElementById('driverName');
const directionSelect = document.getElementById('directionSelect');
const btnStartTrip = document.getElementById('btnStartTrip');
const btnStopTrip = document.getElementById('btnStopTrip');
const driverStatus = document.getElementById('driverStatus');
const btnRefreshBuses = document.getElementById('btnRefreshBuses');
const busListElement = document.getElementById('busList');
const connectionStatus = document.getElementById('connectionStatus');
const searchInput = document.getElementById('searchInput');
const searchResultsContainer = document.getElementById('searchResults');
const chkRoutes = document.getElementById('chkRoutes');
const chkStops = document.getElementById('chkStops');
const btnClearSearch = document.getElementById('btnClearSearch');
const routeDetailPanel = document.getElementById('routeDetailPanel');
const routeDetailContent = document.getElementById('routeDetailContent');
const btnCloseDetail = document.getElementById('btnCloseDetail');
const driverSearchInput = document.getElementById('driverSearchInput');

// ==================== INIT ====================
function init() {
    console.log('🚀 App initializing...');
    loadRoutes();
    checkFirebaseConnection();
    setupSearch();
    setupDriverSearch();
    if (btnClearSearch) btnClearSearch.addEventListener('click', clearSearch);
    if (btnCloseDetail) btnCloseDetail.addEventListener('click', () => routeDetailPanel.classList.add('hidden'));
}

function loadRoutes() {
    if (typeof routesData !== 'undefined' && Array.isArray(routesData) && routesData.length > 0) {
        routeData = routesData;
        console.log('✅ Loaded routes:', routeData.length);
    } else {
        const stored = localStorage.getItem('tunis_bus_routes');
        if (stored) {
            try {
                routeData = JSON.parse(stored);
                console.log('✅ Loaded from localStorage:', routeData.length);
            } catch(e) {}
        }
    }
    if (!routeData || routeData.length === 0) {
        routeData = [];
        console.warn('⚠️ No routes found');
    }
    populateRouteSelects();
}

function populateRouteSelects() {
    if (!routeSelect) return;
    routeSelect.innerHTML = '<option value="">-- Choose Route --</option>';
    if (routeData.length === 0) {
        routeSelect.innerHTML = '<option value="">No routes available</option>';
        return;
    }
    routeData.forEach(route => {
        const opt = document.createElement('option');
        opt.value = route.id;
        opt.textContent = `${route.id} - ${route.name}`;
        routeSelect.appendChild(opt);
    });
    console.log('✅ Populated dropdown with', routeData.length, 'routes');
}

// ==================== CONNECTION ====================
function checkFirebaseConnection() {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;
    statusEl.textContent = 'Checking...';
    statusEl.className = 'connection-badge';

    firebase.database().ref('/').once('value')
        .then(() => {
            statusEl.textContent = 'Online ✅';
            statusEl.className = 'connection-badge online';
        })
        .catch(() => {
            statusEl.textContent = 'Offline ❌';
            statusEl.className = 'connection-badge offline';
        });

    firebase.database().ref('.info/connected').on('value', (snap) => {
        if (snap.val() === true) {
            statusEl.textContent = 'Online ✅';
            statusEl.className = 'connection-badge online';
        }
    });
}

// ==================== TABS ====================
if (tabDriver) tabDriver.addEventListener('click', () => switchTab('driver'));
if (tabPassenger) tabPassenger.addEventListener('click', () => switchTab('passenger'));

function switchTab(tab) {
    if (tab === 'driver') {
        driverView?.classList.add('active');
        passengerView?.classList.remove('active');
        tabDriver?.classList.add('active');
        tabPassenger?.classList.remove('active');
    } else {
        passengerView?.classList.add('active');
        driverView?.classList.remove('active');
        tabPassenger?.classList.add('active');
        tabDriver?.classList.remove('active');
        initMap();
        listenToActiveBuses();
    }
}

// ==================== MAP ====================
function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: true }).setView([36.8065, 10.1815], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    routeLayerGroup = L.layerGroup().addTo(map);
    L.control.scale({ metric: true, imperial: false }).addTo(map);
    
    legendControl = L.control({ position: 'bottomleft' });
    legendControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `
            <strong>Legend</strong>
            <div><span style="color:#2196F3;">●</span> Aller (outbound)</div>
            <div><span style="color:#FF9800;">●</span> Retour (inbound)</div>
            <div><span style="background:#fff; border:2px solid #2196F3; border-radius:50%; display:inline-block; width:10px; height:10px;"></span> Stop</div>
            <div><span style="background:#f5a623; color:white; padding:2px 6px; border-radius:10px;">1</span> Active Bus</div>
        `;
        return div;
    };
    legendControl.addTo(map);
}

// ==================== SEARCH ====================
function setupDriverSearch() {
    if (!driverSearchInput) return;
    driverSearchInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();
        const options = routeSelect.options;
        for (let i = 0; i < options.length; i++) {
            const text = options[i].text.toLowerCase();
            options[i].style.display = text.includes(query) || query === '' ? '' : 'none';
        }
    });
}

function setupSearch() {
    if (!searchInput) return;
    searchInput.addEventListener('input', handleSearch);
    if (chkRoutes) chkRoutes.addEventListener('change', handleSearch);
    if (chkStops) chkStops.addEventListener('change', handleSearch);
}

function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (query.length < 1) {
        searchResultsContainer?.classList.add('hidden');
        return;
    }
    const searchRoutes = chkRoutes ? chkRoutes.checked : true;
    const searchStops = chkStops ? chkStops.checked : true;
    const results = [];

    if (searchRoutes) {
        routeData.forEach(route => {
            if (route.id.toLowerCase().includes(query) || route.name.toLowerCase().includes(query)) {
                results.push({ type: 'route', data: route, label: `${route.id} - ${route.name}` });
            }
        });
    }
    if (searchStops) {
        const stopSet = new Set();
        routeData.forEach(route => {
            route.stops.forEach(stop => {
                if (stop.name.toLowerCase().includes(query)) {
                    const key = `${stop.lat},${stop.lng}`;
                    if (!stopSet.has(key)) {
                        stopSet.add(key);
                        results.push({ type: 'stop', data: stop, label: stop.name, routeId: route.id });
                    }
                }
            });
        });
    }

    results.sort((a,b) => (a.type === 'route' && b.type === 'stop') ? -1 : 1);

    if (!searchResultsContainer) return;
    if (results.length === 0) {
        searchResultsContainer.innerHTML = '<div class="search-result-item" style="color:var(--text-light);">No results found</div>';
        searchResultsContainer.classList.remove('hidden');
        return;
    }

    let html = '';
    results.slice(0, 15).forEach(item => {
        if (item.type === 'route') {
            html += `<div class="search-result-item" data-routeid="${item.data.id}" data-type="route">
                        <span>${item.label}</span>
                        <span class="badge">Route</span>
                    </div>`;
        } else {
            html += `<div class="search-result-item" data-stoplat="${item.data.lat}" data-stoplng="${item.data.lng}" data-stopname="${item.data.name}" data-type="stop">
                        <span>${item.label} (${item.routeId})</span>
                        <span class="badge">Stop</span>
                    </div>`;
        }
    });
    searchResultsContainer.innerHTML = html;
    searchResultsContainer.classList.remove('hidden');

    searchResultsContainer.querySelectorAll('.search-result-item').forEach(el => {
        el.addEventListener('click', function() {
            const type = this.dataset.type;
            const routeId = this.dataset.routeid;
            if (type === 'route' && routeId) {
                showRoute(routeId);
                searchInput.value = '';
                searchResultsContainer.classList.add('hidden');
            } else if (type === 'stop') {
                const lat = parseFloat(this.dataset.stoplat);
                const lng = parseFloat(this.dataset.stoplng);
                const name = this.dataset.stopname;
                focusStop(lat, lng, name);
                searchInput.value = '';
                searchResultsContainer.classList.add('hidden');
            }
        });
    });
}

function clearSearch() {
    searchInput.value = '';
    searchResultsContainer?.classList.add('hidden');
    routeDetailPanel?.classList.add('hidden');
}

// ==================== SHOW ROUTE ====================
function showRoute(routeId) {
    const route = routeData.find(r => r.id === routeId);
    if (!route) { console.warn('Route not found:', routeId); return; }

    if (!map) {
        switchTab('passenger');
        setTimeout(() => showRoute(routeId), 500);
        return;
    }
    if (!routeLayerGroup) {
        routeLayerGroup = L.layerGroup().addTo(map);
    }

    routeLayerGroup.clearLayers();

    // ----- Aller (blue) -----
    if (route.aller && route.aller.length > 1) {
        const allerCoords = route.aller.map(s => [s.lat, s.lng]);
        L.polyline(allerCoords, {
            color: '#2196F3',
            weight: 5,
            opacity: 0.9,
            className: 'route-aller'
        }).addTo(routeLayerGroup).bindPopup('Aller →');
    }

    // ----- Retour (orange, dashed) -----
    if (route.retour && route.retour.length > 1) {
        const retourCoords = route.retour.map(s => [s.lat, s.lng]);
        L.polyline(retourCoords, {
            color: '#FF9800',
            weight: 5,
            opacity: 0.9,
            dashArray: '8, 6',
            className: 'route-retour'
        }).addTo(routeLayerGroup).bindPopup('Retour ←');
    }

    // ----- Stops -----
    const stopSet = new Map();
    if (route.aller) {
        route.aller.forEach(stop => {
            const key = `${stop.lat},${stop.lng}`;
            if (!stopSet.has(key)) {
                const marker = L.circleMarker([stop.lat, stop.lng], {
                    radius: 6,
                    color: '#2196F3',
                    fillColor: '#fff',
                    fillOpacity: 1,
                    weight: 2
                }).addTo(routeLayerGroup);
                marker.bindPopup(`<b>${stop.name}</b><br><span style="color:#2196F3;">Aller</span>`);
                stopSet.set(key, marker);
            }
        });
    }
    if (route.retour) {
        route.retour.forEach(stop => {
            const key = `${stop.lat},${stop.lng}`;
            if (!stopSet.has(key)) {
                const marker = L.circleMarker([stop.lat, stop.lng], {
                    radius: 6,
                    color: '#FF9800',
                    fillColor: '#fff',
                    fillOpacity: 1,
                    weight: 2
                }).addTo(routeLayerGroup);
                marker.bindPopup(`<b>${stop.name}</b><br><span style="color:#FF9800;">Retour</span>`);
                stopSet.set(key, marker);
            } else {
                const existing = stopSet.get(key);
                const oldPopup = existing.getPopup().getContent();
                existing.bindPopup(`${oldPopup}<br><span style="color:#FF9800;">Retour</span>`);
            }
        });
    }

    // Fit bounds
    const allCoords = route.stops.map(s => [s.lat, s.lng]);
    if (allCoords.length > 0) {
        const bounds = L.latLngBounds(allCoords);
        map.fitBounds(bounds, { padding: [50, 50] });
    }

    // Detail panel
    if (routeDetailContent) {
        const allerCount = route.aller ? route.aller.length : 0;
        const retourCount = route.retour ? route.retour.length : 0;
        routeDetailContent.innerHTML = `
            <h4>${route.id} - ${route.name}</h4>
            <p><span style="color:#2196F3;">Aller:</span> ${allerCount} stops</p>
            <p><span style="color:#FF9800;">Retour:</span> ${retourCount} stops</p>
            <div class="stop-list">
                ${route.stops.map(s => `<div class="stop-item"><i class="fas fa-circle" style="font-size:8px; color:#3498db;"></i> ${s.name}</div>`).join('')}
            </div>
        `;
    }
    if (routeDetailPanel) routeDetailPanel.classList.remove('hidden');
}

function focusStop(lat, lng, name) {
    if (!map) { switchTab('passenger'); setTimeout(() => focusStop(lat,lng,name), 500); return; }
    map.setView([lat, lng], 16);
    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(`<b>${name}</b>`).openPopup();
    setTimeout(() => map.removeLayer(marker), 5000);
    const routesWithStop = routeData.filter(r => r.stops.some(s => s.lat === lat && s.lng === lng));
    if (routeDetailContent) {
        routeDetailContent.innerHTML = `
            <h4>Stop: ${name}</h4>
            <p><strong>Served by routes:</strong></p>
            <ul>
                ${routesWithStop.map(r => `<li>${r.id} - ${r.name}</li>`).join('')}
            </ul>
        `;
    }
    if (routeDetailPanel) routeDetailPanel.classList.remove('hidden');
}

// ==================== DRIVER FUNCTIONS ====================
if (btnStartTrip) btnStartTrip.addEventListener('click', startTrip);
if (btnStopTrip) btnStopTrip.addEventListener('click', stopTrip);

function startTrip() {
    const selectedRouteId = routeSelect ? routeSelect.value : '';
    if (selectedRouteId) {
        const route = routeData.find(r => r.id === selectedRouteId);
        if (!route) { alert('Route not found'); return; }
        if (!navigator.geolocation) { alert('Geolocation not supported'); return; }
        routeSelect.disabled = true;
        directionSelect.disabled = true;
        driverStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking location...';
        navigator.geolocation.getCurrentPosition(position => {
            const { latitude, longitude } = position.coords;
            if (isNearRoute(route, latitude, longitude)) {
                const direction = directionSelect ? directionSelect.value : 'forward';
                currentRoute = route;
                currentDirection = direction;
                beginTrip(route, direction);
            } else {
                driverStatus.textContent = 'You are not near this route.';
                routeSelect.disabled = false;
                directionSelect.disabled = false;
                alert('You must be near the route to start sharing.');
            }
        }, error => {
            driverStatus.textContent = 'Error: ' + error.message;
            routeSelect.disabled = false;
            directionSelect.disabled = false;
            alert('Failed to get location.');
        }, { enableHighAccuracy: true, timeout: 10000 });
        return;
    }

    // Auto-detect
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting route...';
    navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude } = position.coords;
        const detection = autoDetectRoute(latitude, longitude);
        if (detection) {
            currentRoute = detection.route;
            currentDirection = detection.direction;
            beginTrip(currentRoute, currentDirection);
        } else {
            driverStatus.textContent = 'No route detected. Please select manually.';
            routeSelect.disabled = false;
            directionSelect.disabled = false;
            alert('Could not auto-detect route.');
        }
    }, error => {
        driverStatus.textContent = 'Error: ' + error.message;
        resetDriverUI();
        alert('Failed to get location.');
    }, { enableHighAccuracy: true, timeout: 10000 });
}

function beginTrip(route, direction) {
    const driverName = driverNameInput ? driverNameInput.value.trim() : 'Unknown';
    if (!route) { alert('No route selected.'); return; }
    currentTripId = `${route.id}_${Date.now()}`;
    firebase.database().ref(`activeBuses/${currentTripId}`).set({
        routeId: route.id,
        direction,
        driverName,
        startedAt: firebase.database.ServerValue.TIMESTAMP,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
    }).catch(err => { console.error(err); alert('Failed to start trip.'); return; });

    watchId = navigator.geolocation.watchPosition(position => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        firebase.database().ref(`activeBuses/${currentTripId}`).update({
            lat: latitude,
            lng: longitude,
            accuracy,
            heading: heading||0,
            speed: speed||0,
            lastUpdate: firebase.database.ServerValue.TIMESTAMP
        });
        driverStatus.innerHTML = `<i class="fas fa-broadcast-tower"></i> Sharing (acc: ${Math.round(accuracy)}m)`;
    }, error => {
        driverStatus.textContent = 'Location error: ' + error.message;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });

    btnStartTrip.classList.add('hidden');
    btnStopTrip.classList.remove('hidden');
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.innerHTML = `<i class="fas fa-check-circle"></i> Trip started on ${route.id} – ${direction}`;
}

function stopTrip() {
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (currentTripId) {
        firebase.database().ref(`activeBuses/${currentTripId}`).remove().catch(console.error);
        currentTripId = null;
    }
    resetDriverUI();
    driverStatus.innerHTML = '<i class="fas fa-flag-checkered"></i> Trip ended.';
}

function resetDriverUI() {
    btnStartTrip.classList.remove('hidden');
    btnStopTrip.classList.add('hidden');
    routeSelect.disabled = false;
    directionSelect.disabled = false;
    currentRoute = null;
}

function isNearRoute(route, lat, lng) {
    return route.stops.some(stop => {
        const d = haversineDistance(lat, lng, stop.lat, stop.lng);
        return d <= 0.5;
    });
}

function autoDetectRoute(lat, lng) {
    if (routeData.length === 0) return null;
    let bestRoute = null, bestDirection = 'forward', bestDistance = Infinity;
    routeData.forEach(route => {
        route.stops.forEach((stop, index) => {
            const d = haversineDistance(lat, lng, stop.lat, stop.lng);
            if (d < bestDistance) {
                bestDistance = d;
                bestRoute = route;
                bestDirection = (index < route.stops.length / 2) ? 'forward' : 'backward';
            }
        });
    });
    if (bestDistance > 0.5) return null;
    return { route: bestRoute, direction: bestDirection };
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ==================== PASSENGER FUNCTIONS ====================
function listenToActiveBuses() {
    if (!map) return;
    const ref = firebase.database().ref('activeBuses');
    for (let id in markers) { map.removeLayer(markers[id]); delete markers[id]; }
    activeBuses = {};
    if (routeLayerGroup) routeLayerGroup.clearLayers();
    updateBusList();
    ref.on('child_added', snap => { const d = snap.val(); d.tripId = snap.key; activeBuses[snap.key] = d; refreshPassengerView(); });
    ref.on('child_changed', snap => { const d = snap.val(); d.tripId = snap.key; activeBuses[snap.key] = d; refreshPassengerView(); });
    ref.on('child_removed', snap => { delete activeBuses[snap.key]; refreshPassengerView(); });
}

function refreshPassengerView() {
    const uniqueBuses = getUniqueBuses();
    for (let key in markers) {
        if (!uniqueBuses.find(b => b.uniqueKey === key)) { map.removeLayer(markers[key]); delete markers[key]; }
    }
    uniqueBuses.forEach(bus => {
        const markerKey = bus.uniqueKey;
        const routeId = bus.routeId;
        const lat = bus.lat; const lng = bus.lng;
        const lastUpdate = bus.lastUpdate; const driverName = bus.driverName;
        const route = routeData.find(r => r.id === routeId);
        let popup = `<b>Bus ${routeId}</b>`;
        if (route) popup += `<br>${route.name}`;
        if (driverName) popup += `<br>Driver: ${driverName}`;
        popup += `<br>Updated: ${new Date(lastUpdate).toLocaleTimeString()}`;
        if (markers[markerKey]) {
            markers[markerKey].setLatLng([lat, lng]).setPopupContent(popup);
        } else {
            const icon = L.divIcon({ className: 'bus-marker', html: `<div class="bus-icon">${routeId}</div>`, iconSize: [34,34], iconAnchor: [17,17] });
            markers[markerKey] = L.marker([lat,lng], { icon }).addTo(map).bindPopup(popup);
        }
    });
    updateBusList();
}

function getUniqueBuses() {
    const buses = Object.values(activeBuses).filter(b => b.lat && b.lng && b.routeId);
    const unique = [];
    buses.forEach(bus => {
        const duplicateOf = unique.find(u => u.routeId === bus.routeId && haversineDistance(u.lat, u.lng, bus.lat, bus.lng) <= 0.05);
        if (!duplicateOf) {
            bus.uniqueKey = bus.tripId;
            unique.push(bus);
        } else {
            if (bus.lastUpdate > duplicateOf.lastUpdate) {
                duplicateOf.lat = bus.lat; duplicateOf.lng = bus.lng; duplicateOf.lastUpdate = bus.lastUpdate;
                duplicateOf.driverName = bus.driverName;
            }
        }
    });
    return unique;
}

function updateBusList() {
    if (!busListElement) return;
    busListElement.innerHTML = '';
    const uniqueBuses = getUniqueBuses();
    let hasBuses = false;
    uniqueBuses.forEach(bus => {
        hasBuses = true;
        const li = document.createElement('li');
        const num = document.createElement('span'); num.className = 'bus-number'; num.textContent = bus.routeId;
        const time = document.createElement('span'); time.className = 'eta'; time.innerHTML = `<i class="far fa-clock"></i> ${new Date(bus.lastUpdate).toLocaleTimeString()}`;
        li.appendChild(num); li.appendChild(time);
        busListElement.appendChild(li);
    });
    const noBuses = document.getElementById('noBuses');
    if (noBuses) noBuses.style.display = hasBuses ? 'none' : 'block';
}

if (btnRefreshBuses) {
    btnRefreshBuses.addEventListener('click', () => {
        firebase.database().ref('activeBuses').off();
        listenToActiveBuses();
    });
}

document.addEventListener('DOMContentLoaded', init);
