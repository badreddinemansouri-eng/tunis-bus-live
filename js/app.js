// ==================== GLOBAL STATE ====================
let map = null;
let routeData = [];          // Array of route objects { id, name, stops: [{name, lat, lng}] }
let activeBuses = {};        // Cache of active buses { busId: data }
let markers = {};            // Leaflet markers { busId: marker }
let currentTripId = null;    // Driver's active trip ID
let watchId = null;          // Geolocation watch ID
let currentRoute = null;     // Driver's selected route
let currentDirection = 'forward';
let autoDetectionDone = false; // Flag to prevent repeated detection

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

// ==================== LOAD ROUTES FROM OSM + MANUAL ====================
async function loadRoutesFromOSM() {
    try {
        // Bounding box for Greater Tunis (approximate)
        const bbox = {
            south: 36.7000,
            west: 10.0000,
            north: 37.0000,
            east: 10.4000
        };

        // Query all bus route relations that have at least one stop within bbox
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
        routeData = parseOSMData(data);

        // Load manual routes if available
        await loadManualRoutes();

        if (routeData.length === 0) {
            // Fallback: demo route
            routeData = [{
                id: '1',
                name: 'Tunis Centre - La Marsa (Demo)',
                stops: [
                    { name: 'Tunis Marine', lat: 36.8002, lng: 10.1806 },
                    { name: 'Place Barcelone', lat: 36.7992, lng: 10.1799 },
                    { name: 'Avenue Habib Bourguiba', lat: 36.8010, lng: 10.1812 },
                    { name: 'Le Passage', lat: 36.8110, lng: 10.1845 },
                    { name: 'La Marsa', lat: 36.8765, lng: 10.3250 }
                ]
            }];
            console.warn('No routes found, using demo route.');
        }
        populateRouteSelects();
    } catch (error) {
        console.error('Error fetching OSM data:', error);
        // Fallback to demo
        routeData = [{
            id: '1',
            name: 'Tunis Centre - La Marsa (Demo)',
            stops: [
                { name: 'Tunis Marine', lat: 36.8002, lng: 10.1806 },
                { name: 'Place Barcelone', lat: 36.7992, lng: 10.1799 },
                { name: 'Avenue Habib Bourguiba', lat: 36.8010, lng: 10.1812 },
                { name: 'Le Passage', lat: 36.8110, lng: 10.1845 },
                { name: 'La Marsa', lat: 36.8765, lng: 10.3250 }
            ]
        }];
        populateRouteSelects();
    }
}

async function loadManualRoutes() {
    try {
        const response = await fetch('js/routes_manual.json');
        if (!response.ok) return;
        const manualData = await response.json();
        manualData.forEach(manualRoute => {
            const index = routeData.findIndex(r => r.id === manualRoute.id);
            if (index >= 0) {
                routeData[index] = manualRoute;
            } else {
                routeData.push(manualRoute);
            }
        });
        console.log(`Loaded ${manualData.length} manual routes.`);
    } catch (error) {
        console.warn('No manual routes file found or error loading it:', error);
    }
}

function parseOSMData(osmData) {
    const routes = [];
    const nodes = {};
    const ways = {};
    const relations = {};

    // Index nodes and ways
    osmData.elements.forEach(el => {
        if (el.type === 'node') nodes[el.id] = el;
        else if (el.type === 'way') ways[el.id] = el;
        else if (el.type === 'relation') relations[el.id] = el;
    });

    // Process each bus route relation
    Object.values(relations).forEach(rel => {
        if (rel.tags && rel.tags.route === 'bus') {
            const ref = rel.tags.ref || rel.id.toString();
            const name = rel.tags.name || `Bus ${ref}`;
            const stops = [];

            // Extract stops from relation members (nodes with role 'stop' or 'platform')
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

            // If no explicit stops, try to get from ways
            if (stops.length === 0 && rel.members) {
                const wayIds = rel.members.filter(m => m.type === 'way').map(m => m.ref);
                wayIds.forEach(wayId => {
                    const way = ways[wayId];
                    if (way && way.nodes) {
                        way.nodes.forEach(nodeId => {
                            const node = nodes[nodeId];
                            if (node && node.lat && node.lon) {
                                if (node.tags && node.tags.name) {
                                    stops.push({
                                        name: node.tags.name,
                                        lat: node.lat,
                                        lng: node.lon
                                    });
                                }
                            }
                        });
                    }
                });
            }

            if (stops.length > 0) {
                routes.push({
                    id: ref,
                    name: name,
                    stops: stops
                });
            }
        }
    });

    return routes;
}

function populateRouteSelects() {
    // Populate driver route select (only used if auto-detection fails)
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
    map = L.map('map').setView([36.8065, 10.1815], 12); // Tunis center
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
}

// ==================== HAVERSINE DISTANCE ====================
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // distance in km
}

// ==================== AUTO-DETECT ROUTE ====================
function autoDetectRoute(lat, lng) {
    if (routeData.length === 0) return null;
    
    let bestRoute = null;
    let bestDirection = 'forward';
    let bestDistance = Infinity;

    routeData.forEach(route => {
        // Check distance to first stop (forward direction)
        if (route.stops.length > 0) {
            const firstStop = route.stops[0];
            const dForward = haversineDistance(lat, lng, firstStop.lat, firstStop.lng);
            if (dForward < bestDistance) {
                bestDistance = dForward;
                bestRoute = route;
                bestDirection = 'forward';
            }
            // Check distance to last stop (backward direction)
            const lastStop = route.stops[route.stops.length - 1];
            const dBackward = haversineDistance(lat, lng, lastStop.lat, lastStop.lng);
            if (dBackward < bestDistance) {
                bestDistance = dBackward;
                bestRoute = route;
                bestDirection = 'backward';
            }
        }
    });

    // If the nearest stop is more than 500 meters away, assume no route detected
    if (bestDistance > 0.5) { // 500 meters threshold
        return null;
    }
    return { route: bestRoute, direction: bestDirection };
}

// ==================== DRIVER LOGIC ====================
btnStartTrip.addEventListener('click', startTrip);
btnStopTrip.addEventListener('click', stopTrip);

function startTrip() {
    // If auto-detection already done, just use existing route
    if (autoDetectionDone && currentRoute) {
        beginTrip(currentRoute, currentDirection);
        return;
    }

    // First, hide manual selection and show status
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.textContent = 'Detecting your route...';

    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        resetDriverUI();
        return;
    }

    // Get current position for auto-detection
    navigator.geolocation.getCurrentPosition(
        position => {
            const { latitude, longitude } = position.coords;
            const detection = autoDetectRoute(latitude, longitude);
            if (detection) {
                currentRoute = detection.route;
                currentDirection = detection.direction;
                autoDetectionDone = true;
                beginTrip(currentRoute, currentDirection);
            } else {
                // No route detected, fall back to manual selection
                driverStatus.textContent = 'No route detected nearby. Please select manually.';
                routeSelect.disabled = false;
                directionSelect.disabled = false;
                autoDetectionDone = false;
                alert('Could not automatically detect route. Please select your route and direction manually, then press "Start Trip" again.');
            }
        },
        error => {
            console.error('Geolocation error:', error);
            driverStatus.textContent = 'Error getting location: ' + error.message;
            resetDriverUI();
            alert('Failed to get location. Check permissions and try again.');
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}

function beginTrip(route, direction) {
    const driverName = document.getElementById('driverName').value.trim() || 'Unknown';

    if (!route) {
        alert('No route selected.');
        return;
    }

    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }

    currentTripId = `${route.id}_${Date.now()}`;

    firebase.database().ref(`activeBuses/${currentTripId}`).set({
        routeId: route.id,
        direction: direction,
        driverName: driverName,
        startedAt: firebase.database.ServerValue.TIMESTAMP,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
    }).catch(err => {
        console.error('Error starting trip:', err);
        alert('Failed to start trip. Check Firebase connection.');
        return;
    });

    watchId = navigator.geolocation.watchPosition(
        position => {
            const { latitude, longitude, accuracy, heading, speed } = position.coords;
            firebase.database().ref(`activeBuses/${currentTripId}`).update({
                lat: latitude,
                lng: longitude,
                accuracy: accuracy,
                heading: heading || 0,
                speed: speed || 0,
                lastUpdate: firebase.database.ServerValue.TIMESTAMP
            }).catch(err => console.error('Error updating location:', err));

            driverStatus.textContent = `Sharing location (accuracy: ${Math.round(accuracy)} m)`;
        },
        error => {
            console.error('Geolocation error:', error);
            driverStatus.textContent = 'Error getting location: ' + error.message;
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    btnStartTrip.classList.add('hidden');
    btnStopTrip.classList.remove('hidden');
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.textContent = `Trip started on ${route.id} (${route.name}) – ${direction}`;
}

function stopTrip() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    if (currentTripId) {
        firebase.database().ref(`activeBuses/${currentTripId}`).remove()
            .catch(err => console.error('Error removing trip:', err));
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
    const activeBusesRef = firebase.database().ref('activeBuses');

    for (let id in markers) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
    activeBuses = {};

    activeBusesRef.on('child_added', snapshot => {
        const busData = snapshot.val();
        addOrUpdateBus(snapshot.key, busData);
    });

    activeBusesRef.on('child_changed', snapshot => {
        const busData = snapshot.val();
        addOrUpdateBus(snapshot.key, busData);
    });

    activeBusesRef.on('child_removed', snapshot => {
        const busId = snapshot.key;
        if (markers[busId]) {
            map.removeLayer(markers[busId]);
            delete markers[busId];
        }
        delete activeBuses[busId];
        updateBusList();
    });
}

function addOrUpdateBus(busId, busData) {
    if (!busData.lat || !busData.lng) return;

    const { routeId, lat, lng, heading, lastUpdate, driverName } = busData;
    const route = routeData.find(r => r.id === routeId);

    let popupHtml = `<b>Bus ${routeId}</b>`;
    if (route) popupHtml += `<br>${route.name}`;
    if (driverName) popupHtml += `<br>Driver: ${driverName}`;
    popupHtml += `<br>Updated: ${new Date(lastUpdate).toLocaleTimeString()}`;

    if (markers[busId]) {
        markers[busId].setLatLng([lat, lng]);
        markers[busId].setPopupContent(popupHtml);
    } else {
        const busIcon = L.divIcon({
            className: 'bus-marker',
            html: `<div class="bus-icon">${routeId}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        markers[busId] = L.marker([lat, lng], { icon: busIcon })
            .addTo(map)
            .bindPopup(popupHtml);
    }

    activeBuses[busId] = { ...busData, lat, lng, routeId, lastUpdate, driverName };
    updateBusList();
}

function updateBusList() {
    busListElement.innerHTML = '';
    const filterRouteId = passengerRouteSelect.value;

    for (let busId in activeBuses) {
        const bus = activeBuses[busId];
        if (filterRouteId && bus.routeId !== filterRouteId) continue;

        const li = document.createElement('li');
        const busNumberSpan = document.createElement('span');
        busNumberSpan.className = 'bus-number';
        busNumberSpan.textContent = bus.routeId;

        const etaSpan = document.createElement('span');
        etaSpan.className = 'eta';
        etaSpan.textContent = `Updated ${new Date(bus.lastUpdate).toLocaleTimeString()}`;

        li.appendChild(busNumberSpan);
        li.appendChild(etaSpan);
        busListElement.appendChild(li);
    }
}

btnRefreshBuses.addEventListener('click', () => {
    firebase.database().ref('activeBuses').off();
    listenToActiveBuses();
});

passengerRouteSelect.addEventListener('change', () => {
    updateBusList();
    const filterRouteId = passengerRouteSelect.value;
    for (let busId in markers) {
        const bus = activeBuses[busId];
        if (!bus) continue;
        if (filterRouteId && bus.routeId !== filterRouteId) {
            map.removeLayer(markers[busId]);
        } else {
            if (!map.hasLayer(markers[busId])) {
                markers[busId].addTo(map);
            }
        }
    }
});

// ==================== INITIAL LOAD ====================
window.addEventListener('DOMContentLoaded', () => {
    loadRoutesFromOSM();
});
