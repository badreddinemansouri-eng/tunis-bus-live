// ==================== GLOBAL STATE ====================
let map = null;
let routeData = [];          // Array of route objects { id, name, stops: [{name, lat, lng}] }
let activeBuses = {};        // Cache of active buses { busId: data }
let markers = {};            // Leaflet markers { busId: marker }
let currentTripId = null;    // Driver's active trip ID
let watchId = null;          // Geolocation watch ID
let currentRoute = null;     // Driver's selected route
let currentDirection = 'forward';

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

// ==================== LOAD ROUTES FROM OSM ====================
async function loadRoutesFromOSM() {
    try {
        const query = `
            [out:json][timeout:25];
            area["name"="تونس"]->.tunis;
            (
                relation["type"="route"]["route"="bus"](area.tunis);
            );
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
        if (routeData.length === 0) {
            // Fallback: use a sample route so app still works
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
            console.warn('No real routes found, using demo route.');
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
    // Populate driver route select
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

// ==================== DRIVER LOGIC ====================
btnStartTrip.addEventListener('click', startTrip);
btnStopTrip.addEventListener('click', stopTrip);

function startTrip() {
    const routeId = routeSelect.value;
    const direction = directionSelect.value;
    const driverName = document.getElementById('driverName').value.trim() || 'Unknown';

    if (!routeId) {
        alert('Please select a route.');
        return;
    }

    const route = routeData.find(r => r.id === routeId);
    if (!route) {
        alert('Invalid route selected.');
        return;
    }

    currentRoute = route;
    currentDirection = direction;

    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
    }

    currentTripId = `${routeId}_${Date.now()}`;

    firebase.database().ref(`activeBuses/${currentTripId}`).set({
        routeId: routeId,
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
    driverStatus.textContent = 'Starting trip...';
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
    btnStartTrip.classList.remove('hidden');
    btnStopTrip.classList.add('hidden');
    routeSelect.disabled = false;
    directionSelect.disabled = false;
    driverStatus.textContent = 'Trip ended.';
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
