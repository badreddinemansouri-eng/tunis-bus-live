// ==================== GLOBAL STATE ====================
let map = null;
let routeData = [];          // loaded / fetched
let activeBuses = {};
let markers = {};
let currentTripId = null;
let watchId = null;
let currentRoute = null;
let currentDirection = 'forward';
let autoDetectionDone = false;
let routeLayerGroup = null;

// DOM elements
const driverView = document.getElementById('driverView');
const passengerView = document.getElementById('passengerView');
const tabDriver = document.getElementById('tabDriver');
const tabPassenger = document.getElementById('tabPassenger');
const routeSelect = document.getElementById('routeSelect');
const passengerRouteSelect = document.getElementById('passengerRouteSelect');
const directionSelect = document.getElementById('directionSelect');
const btnStartTrip = document.getElementById('btnStartTrip');
const btnStopTrip = document.getElementById('btnStopTrip');
const driverStatus = document.getElementById('driverStatus');
const btnRefreshBuses = document.getElementById('btnRefreshBuses');
const busListElement = document.getElementById('busList');

// ==================== LOAD ROUTES ====================
async function loadRoutes() {
    // Try cache first
    const cached = localStorage.getItem('tunis_bus_routes');
    if (cached) {
        try {
            routeData = JSON.parse(cached);
            populateRouteSelects();
            console.log('Loaded routes from cache:', routeData.length);
        } catch (e) {
            console.warn('Cache parse error, will fetch.', e);
        }
    }

    // Fetch fresh from OSM
    try {
        const bbox = { south: 36.6000, west: 9.9000, north: 37.1000, east: 10.5000 };
        const query = `
            [out:json][timeout:60];
            (
                node["highway"="bus_stop"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
                node["public_transport"="platform"]["bus"="yes"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
            );
            node._ -> .stops;
            .stops <;
            relation(bn.stops)["type"="route"]["route"="bus"];
            out body;
            >;
            out skel qt;
        `;
        const response = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: 'data=' + encodeURIComponent(query)
        });
        const data = await response.json();
        const osmRoutes = parseOSMData(data);
        if (osmRoutes.length > 0) {
            routeData = osmRoutes;
            // Save to cache
            localStorage.setItem('tunis_bus_routes', JSON.stringify(routeData));
            populateRouteSelects();
            console.log('Fetched routes from OSM:', routeData.length);
        } else {
            console.warn('No routes found in OSM, using existing data.');
        }
    } catch (error) {
        console.error('Error fetching OSM:', error);
        // Keep whatever we have (cache or empty)
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
            if (rel.members) {
                rel.members.forEach(member => {
                    if (member.role === 'stop' || member.role === 'platform') {
                        if (nodes[member.ref]) {
                            const node = nodes[member.ref];
                            if (node.lat && node.lon) {
                                stops.push({
                                    name: node.tags && node.tags.name ? node.tags.name : 'Unknown',
                                    lat: node.lat,
                                    lng: node.lon
                                });
                            }
                        }
                    }
                });
            }
            if (stops.length === 0 && rel.members) {
                const wayIds = rel.members.filter(m => m.type === 'way').map(m => m.ref);
                wayIds.forEach(wayId => {
                    const way = ways[wayId];
                    if (way && way.nodes) {
                        way.nodes.forEach(nodeId => {
                            const node = nodes[nodeId];
                            if (node && node.lat && node.lon) {
                                if (node.tags && node.tags.name) {
                                    stops.push({ name: node.tags.name, lat: node.lat, lng: node.lon });
                                }
                            }
                        });
                    }
                });
            }
            if (stops.length > 0) {
                routes.push({ id: ref, name: name, stops: stops });
            }
        }
    });
    return routes;
}

function populateRouteSelects() {
    routeSelect.innerHTML = '<option value="">-- Choose Route --</option>';
    passengerRouteSelect.innerHTML = '<option value="">-- All Buses --</option>';
    routeData.forEach(route => {
        const option1 = document.createElement('option');
        option1.value = route.id;
        option1.textContent = `${route.id} - ${route.name}`;
        routeSelect.appendChild(option1);
        const option2 = document.createElement('option');
        option2.value = route.id;
        option2.textContent = `${route.id} - ${route.name}`;
        passengerRouteSelect.appendChild(option2);
    });
}

// ==================== TAB SWITCHING ====================
tabDriver.addEventListener('click', () => {
    driverView.classList.add('active');
    passengerView.classList.remove('active');
    tabDriver.classList.add('active');
    tabPassenger.classList.remove('active');
});

tabPassenger.addEventListener('click', () => {
    passengerView.classList.add('active');
    driverView.classList.remove('active');
    tabPassenger.classList.add('active');
    tabDriver.classList.remove('active');
    initMap();
    listenToActiveBuses();
});

// ==================== MAP INITIALIZATION ====================
function initMap() {
    if (map) return;
    map = L.map('map').setView([36.8065, 10.1815], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    routeLayerGroup = L.layerGroup().addTo(map);
}

// ==================== HAVERSINE ====================
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ==================== AUTO-DETECT ROUTE ====================
function autoDetectRoute(lat, lng) {
    if (routeData.length === 0) return null;
    let bestRoute = null, bestDirection = 'forward', bestDistance = Infinity;
    routeData.forEach(route => {
        if (route.stops.length > 0) {
            const firstStop = route.stops[0];
            const dForward = haversineDistance(lat, lng, firstStop.lat, firstStop.lng);
            if (dForward < bestDistance) { bestDistance = dForward; bestRoute = route; bestDirection = 'forward'; }
            const lastStop = route.stops[route.stops.length - 1];
            const dBackward = haversineDistance(lat, lng, lastStop.lat, lastStop.lng);
            if (dBackward < bestDistance) { bestDistance = dBackward; bestRoute = route; bestDirection = 'backward'; }
        }
    });
    if (bestDistance > 0.5) return null;
    return { route: bestRoute, direction: bestDirection };
}

// ==================== DRIVER LOGIC ====================
btnStartTrip.addEventListener('click', startTrip);
btnStopTrip.addEventListener('click', stopTrip);

function startTrip() {
    if (autoDetectionDone && currentRoute) {
        beginTrip(currentRoute, currentDirection);
        return;
    }
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.textContent = '🔄 Detecting your route...';
    if (!navigator.geolocation) { alert('Geolocation not supported'); resetDriverUI(); return; }
    navigator.geolocation.getCurrentPosition(position => {
        const { latitude, longitude } = position.coords;
        const detection = autoDetectRoute(latitude, longitude);
        if (detection) {
            currentRoute = detection.route;
            currentDirection = detection.direction;
            autoDetectionDone = true;
            beginTrip(currentRoute, currentDirection);
        } else {
            driverStatus.textContent = '❌ No route detected nearby. Please select manually.';
            routeSelect.disabled = false;
            directionSelect.disabled = false;
            autoDetectionDone = false;
            alert('Could not automatically detect route. Select manually.');
        }
    }, error => {
        console.error(error);
        driverStatus.textContent = 'Error: ' + error.message;
        resetDriverUI();
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function beginTrip(route, direction) {
    const driverName = document.getElementById('driverName').value.trim() || 'Unknown';
    if (!route) { alert('No route selected.'); return; }
    currentTripId = `${route.id}_${Date.now()}`;
    firebase.database().ref(`activeBuses/${currentTripId}`).set({
        routeId: route.id, direction, driverName,
        startedAt: firebase.database.ServerValue.TIMESTAMP,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
    }).catch(err => { console.error(err); alert('Failed to start trip.'); return; });
    watchId = navigator.geolocation.watchPosition(position => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        firebase.database().ref(`activeBuses/${currentTripId}`).update({
            lat: latitude, lng: longitude, accuracy, heading: heading||0, speed: speed||0,
            lastUpdate: firebase.database.ServerValue.TIMESTAMP
        }).catch(err => console.error(err));
        driverStatus.textContent = `📍 Sharing location (accuracy: ${Math.round(accuracy)}m)`;
    }, error => {
        driverStatus.textContent = 'Error: ' + error.message;
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });

    btnStartTrip.classList.add('hidden');
    btnStopTrip.classList.remove('hidden');
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.textContent = `🚌 Trip started on ${route.id} (${route.name}) – ${direction}`;
}

function stopTrip() {
    if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (currentTripId) {
        firebase.database().ref(`activeBuses/${currentTripId}`).remove().catch(console.error);
        currentTripId = null;
    }
    resetDriverUI();
    driverStatus.textContent = 'Trip ended.';
}

function resetDriverUI() {
    btnStartTrip.classList.remove('hidden');
    btnStopTrip.classList.add('hidden');
    routeSelect.disabled = false;
    directionSelect.disabled = false;
    autoDetectionDone = false;
    currentRoute = null;
}

// ==================== PASSENGER LOGIC ====================
function listenToActiveBuses() {
    const ref = firebase.database().ref('activeBuses');
    for (let id in markers) { map.removeLayer(markers[id]); delete markers[id]; }
    activeBuses = {};
    if (routeLayerGroup) routeLayerGroup.clearLayers();

    ref.on('child_added', snap => addOrUpdateBus(snap.key, snap.val()));
    ref.on('child_changed', snap => addOrUpdateBus(snap.key, snap.val()));
    ref.on('child_removed', snap => {
        const id = snap.key;
        if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
        delete activeBuses[id];
        updateBusList();
    });
}

function addOrUpdateBus(busId, data) {
    if (!data.lat || !data.lng) return;
    const { routeId, lat, lng, lastUpdate, driverName } = data;
    const route = routeData.find(r => r.id === routeId);
    let popup = `<b>Bus ${routeId}</b>`;
    if (route) popup += `<br>${route.name}`;
    if (driverName) popup += `<br>Driver: ${driverName}`;
    popup += `<br>Updated: ${new Date(lastUpdate).toLocaleTimeString()}`;

    if (markers[busId]) {
        markers[busId].setLatLng([lat, lng]).setPopupContent(popup);
    } else {
        const icon = L.divIcon({ className: 'bus-marker', html: `<div class="bus-icon">${routeId}</div>`, iconSize: [32,32], iconAnchor: [16,16] });
        markers[busId] = L.marker([lat,lng], { icon }).addTo(map).bindPopup(popup);
    }
    activeBuses[busId] = { ...data, lat, lng, routeId, lastUpdate, driverName };
    updateBusList();
    if (passengerRouteSelect.value) showRoutePath(passengerRouteSelect.value);
}

function showRoutePath(routeId) {
    if (!routeLayerGroup) return;
    routeLayerGroup.clearLayers();
    const route = routeData.find(r => r.id === routeId);
    if (!route || route.stops.length < 2) return;
    const latlngs = route.stops.map(s => [s.lat, s.lng]);
    const polyline = L.polyline(latlngs, { className: 'route-path' }).addTo(routeLayerGroup);
    route.stops.forEach(stop => {
        L.circleMarker([stop.lat, stop.lng], { radius: 5, color: '#3498db', fillColor: '#fff', fillOpacity: 1, weight: 2 })
            .addTo(routeLayerGroup).bindPopup(stop.name);
    });
    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
}

function updateBusList() {
    busListElement.innerHTML = '';
    const filter = passengerRouteSelect.value;
    for (let id in activeBuses) {
        const bus = activeBuses[id];
        if (filter && bus.routeId !== filter) continue;
        const li = document.createElement('li');
        const num = document.createElement('span'); num.className = 'bus-number'; num.textContent = bus.routeId;
        const time = document.createElement('span'); time.className = 'eta'; time.textContent = `Updated ${new Date(bus.lastUpdate).toLocaleTimeString()}`;
        li.appendChild(num); li.appendChild(time);
        busListElement.appendChild(li);
    }
}

btnRefreshBuses.addEventListener('click', () => {
    firebase.database().ref('activeBuses').off();
    listenToActiveBuses();
});

passengerRouteSelect.addEventListener('change', () => {
    updateBusList();
    const filter = passengerRouteSelect.value;
    if (filter) showRoutePath(filter); else if (routeLayerGroup) routeLayerGroup.clearLayers();
    for (let id in markers) {
        const bus = activeBuses[id];
        if (!bus) continue;
        if (filter && bus.routeId !== filter) map.removeLayer(markers[id]);
        else if (!map.hasLayer(markers[id])) markers[id].addTo(map);
    }
});

// ==================== INIT ====================
window.addEventListener('DOMContentLoaded', () => {
    loadRoutes();
});
