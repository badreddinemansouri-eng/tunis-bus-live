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

// DOM refs
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
    btnClearSearch.addEventListener('click', clearSearch);
    btnCloseDetail.addEventListener('click', () => routeDetailPanel.classList.add('hidden'));
}

function loadRoutes() {
    // First try to get from global routesData (from routes.js)
    if (typeof routesData !== 'undefined' && Array.isArray(routesData) && routesData.length > 0) {
        routeData = routesData;
        console.log('✅ Loaded local routes:', routeData.length);
    } else {
        // Try localStorage
        const stored = localStorage.getItem('tunis_bus_routes');
        if (stored) {
            try {
                routeData = JSON.parse(stored);
                console.log('✅ Loaded routes from localStorage:', routeData.length);
            } catch(e) {}
        }
    }

    // If still empty, fallback to empty array
    if (!routeData || routeData.length === 0) {
        routeData = [];
        console.warn('⚠️ No routes found – try fetching from OSM');
        fetchRoutesFromOSM(false);
    }

    populateRouteSelects();
    // If we have routes, also try to fetch more from OSM as supplement
    if (routeData.length > 0) {
        fetchRoutesFromOSM(true);
    }
}

async function fetchRoutesFromOSM(supplement = false) {
    try {
        const bbox = { south: 36.6, west: 9.9, north: 37.1, east: 10.5 };
        const query = `[out:json][timeout:30];(node["highway"="bus_stop"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});node["public_transport"="platform"]["bus"="yes"](${bbox.south},${bbox.west},${bbox.north},${bbox.east}););node._ -> .stops;.stops <;relation(bn.stops)["type"="route"]["route"="bus"];out body;>;out skel qt;`;
        const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(query) });
        const data = await response.json();
        const osmRoutes = parseOSMData(data);
        if (osmRoutes.length > 0) {
            if (supplement) {
                let added = 0;
                osmRoutes.forEach(osmRoute => {
                    if (!routeData.find(r => r.id === osmRoute.id)) {
                        routeData.push(osmRoute);
                        added++;
                    }
                });
                if (added > 0) {
                    console.log(`Added ${added} new routes from OSM, total: ${routeData.length}`);
                    populateRouteSelects();
                }
            } else {
                routeData = osmRoutes;
                console.log('Fetched routes from OSM:', routeData.length);
                populateRouteSelects();
            }
            if (routeData.length > 0) localStorage.setItem('tunis_bus_routes', JSON.stringify(routeData));
        }
    } catch (e) {
        console.warn('OSM fetch failed, using local data only.', e);
    }
}

function parseOSMData(osmData) {
    const routes = [];
    const nodes = {};
    const ways = {};
    const relations = {};
    osmData.elements.forEach(el => {
        if (el.type === 'node') nodes[el.id] = el;
        else if (el.type === 'way') ways[el.id] = el;
        else if (el.type === 'relation') relations[el.id] = el;
    });
    Object.values(relations).forEach(rel => {
        if (rel.tags && rel.tags.route === 'bus') {
            const ref = rel.tags.ref || rel.id.toString();
            const name = rel.tags.name || `Bus ${ref}`;
            const stops = [];
            const path = [];
            if (rel.members) {
                rel.members.forEach(member => {
                    if ((member.role === 'stop' || member.role === 'platform') && nodes[member.ref]) {
                        const node = nodes[member.ref];
                        if (node.lat && node.lon) stops.push({ name: node.tags?.name || 'Unknown', lat: node.lat, lng: node.lon });
                    }
                });
            }
            if (rel.members) {
                const wayMembers = rel.members.filter(m => m.type === 'way');
                wayMembers.forEach(member => {
                    const way = ways[member.ref];
                    if (way && way.nodes) {
                        way.nodes.forEach(nodeId => {
                            const node = nodes[nodeId];
                            if (node && node.lat && node.lon) path.push([node.lat, node.lon]);
                        });
                    }
                });
            }
            if (stops.length > 0) routes.push({ id: ref, name, stops, path: path.length > 0 ? path : null });
        }
    });
    return routes;
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
    console.log('✅ Populated route dropdown with', routeData.length, 'routes');
}

// ==================== RELIABLE CONNECTION CHECK ====================
function checkFirebaseConnection() {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) return;
    statusEl.textContent = 'Checking...';
    statusEl.className = 'connection-badge';

    // Primary: Use a simple read to confirm database access
    firebase.database().ref('/').once('value')
        .then(() => {
            statusEl.textContent = 'Online ✅';
            statusEl.className = 'connection-badge online';
            console.log('✅ Database reachable via REST');
        })
        .catch((err) => {
            statusEl.textContent = 'Offline ❌';
            statusEl.className = 'connection-badge offline';
            console.error('❌ Database read failed:', err);
        });

    // Secondary: Listen to .info/connected for real-time changes (WebSocket)
    try {
        firebase.database().ref('.info/connected').on('value', (snap) => {
            if (snap.val() === true) {
                statusEl.textContent = 'Online ✅';
                statusEl.className = 'connection-badge online';
            }
        });
    } catch (e) {
        // WebSocket might not be supported – ignore
    }
}

// ==================== TAB SWITCHING ====================
tabDriver.addEventListener('click', () => switchTab('driver'));
tabPassenger.addEventListener('click', () => switchTab('passenger'));

function switchTab(tab) {
    if (tab === 'driver') {
        driverView.classList.add('active');
        passengerView.classList.remove('active');
        tabDriver.classList.add('active');
        tabPassenger.classList.remove('active');
    } else {
        passengerView.classList.add('active');
        driverView.classList.remove('active');
        tabPassenger.classList.add('active');
        tabDriver.classList.remove('active');
        initMap();
        listenToActiveBuses();
    }
}

// ==================== MAP INIT ====================
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
        div.innerHTML = `<strong>Legend</strong><br><span style="color:#3498db;">●</span> Route<br><span style="background:#fff; border:2px solid #3498db; border-radius:50%; display:inline-block; width:10px; height:10px;"></span> Stop<br><span style="background:#f5a623; color:white; padding:2px 6px; border-radius:10px;">1</span> Bus`;
        return div;
    };
    legendControl.addTo(map);
}

// ==================== DRIVER SEARCH (filter dropdown) ====================
function setupDriverSearch() {
    if (!driverSearchInput) return;
    driverSearchInput.addEventListener('input', function() {
        const query = this.value.trim().toLowerCase();
        const options = routeSelect.options;
        let hasVisible = false;
        for (let i = 0; i < options.length; i++) {
            const text = options[i].text.toLowerCase();
            if (text.includes(query) || query === '') {
                options[i].style.display = '';
                hasVisible = true;
            } else {
                options[i].style.display = 'none';
            }
        }
        // If no results, show a temporary message
        if (!hasVisible && query.length > 0) {
            // Add a placeholder if needed
        }
    });
}

// ==================== PASSENGER SEARCH ====================
function setupSearch() {
    searchInput.addEventListener('input', handleSearch);
    chkRoutes.addEventListener('change', handleSearch);
    chkStops.addEventListener('change', handleSearch);
}

function handleSearch() {
    const query = searchInput.value.trim().toLowerCase();
    if (query.length < 1) {
        searchResultsContainer.classList.add('hidden');
        return;
    }
    const searchRoutes = chkRoutes.checked;
    const searchStops = chkStops.checked;
    const results = [];

    if (searchRoutes) {
        routeData.forEach(route => {
            const idMatch = route.id.toLowerCase().includes(query);
            const nameMatch = route.name.toLowerCase().includes(query);
            if (idMatch || nameMatch) {
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

    results.sort((a,b) => {
        if (a.type === 'route' && b.type === 'stop') return -1;
        if (a.type === 'stop' && b.type === 'route') return 1;
        return 0;
    });

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
            if (type === 'route') {
                const routeId = this.dataset.routeid;
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
    searchResultsContainer.classList.add('hidden');
    routeDetailPanel.classList.add('hidden');
}

function showRoute(routeId) {
    const route = routeData.find(r => r.id === routeId);
    if (!route) return;
    if (routeLayerGroup) routeLayerGroup.clearLayers();
    let pathCoords = route.path && route.path.length > 1 ? route.path : null;
    if (!pathCoords) {
        pathCoords = route.stops.map(s => [s.lat, s.lng]);
    }
    if (pathCoords && pathCoords.length > 1) {
        L.polyline(pathCoords, { className: 'route-outline', color: '#fff', weight: 8, opacity: 0.7 }).addTo(routeLayerGroup);
        L.polyline(pathCoords, { className: 'route-path', color: '#3498db', weight: 4, opacity: 0.9 }).addTo(routeLayerGroup);
    }
    route.stops.forEach((stop, i) => {
        const marker = L.circleMarker([stop.lat, stop.lng], {
            radius: (i===0||i===route.stops.length-1)?8:6,
            color:'#2980b9',
            fillColor:'#fff',
            fillOpacity:1,
            weight:3
        }).addTo(routeLayerGroup);
        marker.bindPopup(`<b>${stop.name}</b>`);
    });
    if (pathCoords.length > 0) {
        const bounds = L.latLngBounds(pathCoords);
        map.fitBounds(bounds, { padding: [40, 40] });
    }

    routeDetailContent.innerHTML = `
        <h4>${route.id} - ${route.name}</h4>
        <p><strong>Stops:</strong> ${route.stops.length}</p>
        <div class="stop-list">
            ${route.stops.map(s => `<div class="stop-item"><i class="fas fa-circle" style="font-size:8px; color:#3498db;"></i> ${s.name}</div>`).join('')}
        </div>
    `;
    routeDetailPanel.classList.remove('hidden');
}

function focusStop(lat, lng, name) {
    map.setView([lat, lng], 16);
    const marker = L.marker([lat, lng]).addTo(map);
    marker.bindPopup(`<b>${name}</b>`).openPopup();
    const routesWithStop = routeData.filter(r => r.stops.some(s => s.lat === lat && s.lng === lng));
    if (routesWithStop.length > 0) {
        routeDetailContent.innerHTML = `
            <h4>Stop: ${name}</h4>
            <p><strong>Served by routes:</strong></p>
            <ul>
                ${routesWithStop.map(r => `<li>${r.id} - ${r.name}</li>`).join('')}
            </ul>
        `;
        routeDetailPanel.classList.remove('hidden');
    }
}

// ==================== DRIVER FUNCTIONS ====================
btnStartTrip.addEventListener('click', startTrip);
btnStopTrip.addEventListener('click', stopTrip);

function startTrip() {
    const selectedRouteId = routeSelect.value;
    if (selectedRouteId) {
        const route = routeData.find(r => r.id === selectedRouteId);
        if (!route) { alert('Selected route not found.'); return; }
        if (!navigator.geolocation) { alert('Geolocation is not supported.'); return; }
        routeSelect.disabled = true;
        directionSelect.disabled = true;
        driverStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking your location...';
        navigator.geolocation.getCurrentPosition(position => {
            const { latitude, longitude } = position.coords;
            if (isNearRoute(route, latitude, longitude)) {
                const direction = directionSelect.value;
                currentRoute = route;
                currentDirection = direction;
                beginTrip(route, direction);
            } else {
                driverStatus.textContent = 'You are not near this route. Cannot start trip.';
                routeSelect.disabled = false;
                directionSelect.disabled = false;
                alert('You must be near the route to start sharing.');
            }
        }, error => {
            driverStatus.textContent = 'Error getting location: ' + error.message;
            routeSelect.disabled = false;
            directionSelect.disabled = false;
            alert('Failed to get your location.');
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        return;
    }

    // Auto-detect
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting your route...';
    if (!navigator.geolocation) { alert('Geolocation not supported'); resetDriverUI(); return; }
    navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude } = position.coords;
        const detection = autoDetectRoute(latitude, longitude);
        if (detection) {
            currentRoute = detection.route;
            currentDirection = detection.direction;
            beginTrip(currentRoute, currentDirection);
        } else {
            driverStatus.textContent = 'No route detected nearby. Please select a route manually.';
            routeSelect.disabled = false;
            directionSelect.disabled = false;
            alert('Could not automatically detect route.');
        }
    }, error => {
        driverStatus.textContent = 'Error getting location: ' + error.message;
        resetDriverUI();
        alert('Failed to get location.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function beginTrip(route, direction) {
    const driverName = driverNameInput.value.trim() || 'Unknown';
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
        }).catch(err => console.error(err));
        driverStatus.innerHTML = `<i class="fas fa-broadcast-tower"></i> Sharing location (accuracy: ${Math.round(accuracy)}m)`;
    }, error => {
        driverStatus.textContent = 'Error getting location: ' + error.message;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });

    btnStartTrip.classList.add('hidden');
    btnStopTrip.classList.remove('hidden');
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.innerHTML = `<i class="fas fa-check-circle"></i> Trip started on ${route.id} (${route.name}) – ${direction}`;
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
    const ref = firebase.database().ref('activeBuses');
    for (let id in markers) { if (map) map.removeLayer(markers[id]); delete markers[id]; }
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
        if (!uniqueBuses.find(b => b.uniqueKey === key)) { if (map) map.removeLayer(markers[key]); delete markers[key]; }
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
                duplicateOf.driverName = bus.driverName; duplicateOf.accuracy = bus.accuracy;
                duplicateOf.speed = bus.speed; duplicateOf.heading = bus.heading;
            }
        }
    });
    return unique;
}

function updateBusList() {
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
    document.getElementById('noBuses').style.display = hasBuses ? 'none' : 'block';
}

btnRefreshBuses.addEventListener('click', () => {
    firebase.database().ref('activeBuses').off();
    listenToActiveBuses();
});

// ==================== START APP ====================
document.addEventListener('DOMContentLoaded', init);
