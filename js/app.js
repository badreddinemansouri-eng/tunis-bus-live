// ==================== GLOBAL STATE ====================
let map = null;
let routeData = [];
let activeBuses = {};
let markers = {};
let currentTripId = null;
let watchId = null;
let currentRoute = null;
let currentDirection = 'forward';
let autoDetectionDone = false;
let routeLayerGroup = null;
let legendControl = null;

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
const connectionStatus = document.getElementById('connectionStatus');

function init() {
    loadRoutes();
    checkFirebaseConnection();
}

function loadRoutes() {
    if (typeof routesData !== 'undefined' && Array.isArray(routesData) && routesData.length > 0) {
        routeData = routesData;
        console.log('Loaded local routes:', routeData.length);
        populateRouteSelects();
        fetchRoutesFromOSM(true);
    } else {
        console.warn('No local routes found, fetching from OSM...');
        fetchRoutesFromOSM(false);
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
            if (rel.members) {
                rel.members.forEach(member => {
                    if ((member.role === 'stop' || member.role === 'platform') && nodes[member.ref]) {
                        const node = nodes[member.ref];
                        if (node.lat && node.lon) stops.push({ name: node.tags?.name || 'Unknown', lat: node.lat, lng: node.lon });
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
                            if (node && node.lat && node.lon && node.tags?.name) stops.push({ name: node.tags.name, lat: node.lat, lng: node.lon });
                        });
                    }
                });
            }
            if (stops.length > 0) routes.push({ id: ref, name, stops });
        }
    });
    return routes;
}

function populateRouteSelects() {
    routeSelect.innerHTML = '<option value="">-- Choose Route --</option>';
    passengerRouteSelect.innerHTML = '<option value="">-- All Buses --</option>';
    routeData.forEach(route => {
        const optionText = `${route.id} - ${route.name}`;

        const opt1 = document.createElement('option');
        opt1.value = route.id;
        opt1.textContent = optionText;
        routeSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = route.id;
        opt2.textContent = optionText;
        passengerRouteSelect.appendChild(opt2);
    });
}

function checkFirebaseConnection() {
    const connectedRef = firebase.database().ref('.info/connected');
    connectedRef.on('value', (snap) => {
        if (snap.val() === true) {
            connectionStatus.textContent = 'Online';
            connectionStatus.className = 'connection-badge online';
        } else {
            connectionStatus.textContent = 'Offline';
            connectionStatus.className = 'connection-badge offline';
        }
    });
}

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

function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: true }).setView([36.8065, 10.1815], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    routeLayerGroup = L.layerGroup().addTo(map);

    // Add legend control
    legendControl = L.control({ position: 'bottomleft' });
    legendControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'map-legend');
        div.innerHTML = `
            <strong>Legend</strong><br>
            <span style="color:#3498db;">●</span> Route path<br>
            <span style="color:#fff; border:2px solid #3498db; border-radius:50%; display:inline-block; width:10px; height:10px;"></span> Stop<br>
            <span style="background:#f9a826; color:white; padding:2px 6px; border-radius:10px;">1</span> Bus
        `;
        return div;
    };
    legendControl.addTo(map);

    // Add fullscreen button if available
    if (L.control.fullscreen) {
        L.control.fullscreen({ position: 'topright' }).addTo(map);
    }
}

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Check if the given lat,lng is within 500 meters of any stop of the route
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

btnStartTrip.addEventListener('click', startTrip);
btnStopTrip.addEventListener('click', stopTrip);

function startTrip() {
    const selectedRouteId = routeSelect.value;
    if (selectedRouteId) {
        const route = routeData.find(r => r.id === selectedRouteId);
        if (!route) {
            alert('Selected route not found.');
            return;
        }
        if (!navigator.geolocation) {
            alert('Geolocation is not supported.');
            return;
        }
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
                alert('You must be near the route to start sharing. Please move to the route or select the correct one.');
            }
        }, error => {
            driverStatus.textContent = 'Error getting location: ' + error.message;
            routeSelect.disabled = false;
            directionSelect.disabled = false;
            alert('Failed to get your location. Check permissions and try again.');
        }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
        return;
    }

    // No manual route selected: try auto-detection
    routeSelect.disabled = true;
    directionSelect.disabled = true;
    driverStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting your route...';
    if (!navigator.geolocation) {
        alert('Geolocation not supported');
        resetDriverUI();
        return;
    }
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
            alert('Could not automatically detect route. Please select a route from the list and press Start Trip again.');
        }
    }, error => {
        driverStatus.textContent = 'Error getting location: ' + error.message;
        resetDriverUI();
        alert('Failed to get location. Check permissions and try again, or select a route manually.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function beginTrip(route, direction) {
    const driverName = document.getElementById('driverName').value.trim() || 'Unknown';
    if (!route) {
        alert('No route selected.');
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
        console.error(err);
        alert('Failed to start trip. Check Firebase connection.');
        return;
    });

    watchId = navigator.geolocation.watchPosition(position => {
        const { latitude, longitude, accuracy, heading, speed } = position.coords;
        firebase.database().ref(`activeBuses/${currentTripId}`).update({
            lat: latitude,
            lng: longitude,
            accuracy: accuracy,
            heading: heading || 0,
            speed: speed || 0,
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
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
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
    autoDetectionDone = false;
    currentRoute = null;
}

// ==================== PASSENGER LOGIC WITH DUPLICATE MERGING & IMPROVED MAP ====================
function listenToActiveBuses() {
    const ref = firebase.database().ref('activeBuses');
    for (let id in markers) {
        map.removeLayer(markers[id]);
        delete markers[id];
    }
    activeBuses = {};
    if (routeLayerGroup) routeLayerGroup.clearLayers();
    updateBusList();

    ref.on('child_added', snap => {
        const busData = snap.val();
        busData.tripId = snap.key;
        activeBuses[snap.key] = busData;
        refreshPassengerView();
    });

    ref.on('child_changed', snap => {
        const busData = snap.val();
        busData.tripId = snap.key;
        activeBuses[snap.key] = busData;
        refreshPassengerView();
    });

    ref.on('child_removed', snap => {
        delete activeBuses[snap.key];
        refreshPassengerView();
    });
}

function refreshPassengerView() {
    const uniqueBuses = getUniqueBuses();
    
    for (let key in markers) {
        if (!uniqueBuses.find(b => b.uniqueKey === key)) {
            map.removeLayer(markers[key]);
            delete markers[key];
        }
    }
    
    uniqueBuses.forEach(bus => {
        const markerKey = bus.uniqueKey;
        const routeId = bus.routeId;
        const lat = bus.lat;
        const lng = bus.lng;
        const lastUpdate = bus.lastUpdate;
        const driverName = bus.driverName;
        const route = routeData.find(r => r.id === routeId);
        
        let popup = `<b>Bus ${routeId}</b>`;
        if (route) popup += `<br>${route.name}`;
        if (driverName) popup += `<br>Driver: ${driverName}`;
        popup += `<br>Updated: ${new Date(lastUpdate).toLocaleTimeString()}`;
        
        if (markers[markerKey]) {
            markers[markerKey].setLatLng([lat, lng]).setPopupContent(popup);
        } else {
            const icon = L.divIcon({
                className: 'bus-marker',
                html: `<div class="bus-icon">${routeId}</div>`,
                iconSize: [34, 34],
                iconAnchor: [17, 17]
            });
            markers[markerKey] = L.marker([lat, lng], { icon }).addTo(map).bindPopup(popup);
        }
    });
    
    updateBusList();
    if (passengerRouteSelect.value) showRoutePath(passengerRouteSelect.value);
}

function getUniqueBuses() {
    const buses = Object.values(activeBuses).filter(b => b.lat && b.lng && b.routeId);
    const unique = [];
    
    buses.forEach(bus => {
        const duplicateOf = unique.find(u => {
            return u.routeId === bus.routeId &&
                   haversineDistance(u.lat, u.lng, bus.lat, bus.lng) <= 0.05;
        });
        
        if (!duplicateOf) {
            bus.uniqueKey = bus.tripId;
            unique.push(bus);
        } else {
            if (bus.lastUpdate > duplicateOf.lastUpdate) {
                duplicateOf.lat = bus.lat;
                duplicateOf.lng = bus.lng;
                duplicateOf.lastUpdate = bus.lastUpdate;
                duplicateOf.driverName = bus.driverName;
                duplicateOf.accuracy = bus.accuracy;
                duplicateOf.speed = bus.speed;
                duplicateOf.heading = bus.heading;
            }
        }
    });
    
    return unique;
}

function updateBusList() {
    busListElement.innerHTML = '';
    const filter = passengerRouteSelect.value;
    const uniqueBuses = getUniqueBuses();
    let hasBuses = false;
    uniqueBuses.forEach(bus => {
        if (filter && bus.routeId !== filter) return;
        hasBuses = true;
        const li = document.createElement('li');
        const num = document.createElement('span');
        num.className = 'bus-number';
        num.textContent = bus.routeId;
        const time = document.createElement('span');
        time.className = 'eta';
        time.innerHTML = `<i class="far fa-clock"></i> Updated ${new Date(bus.lastUpdate).toLocaleTimeString()}`;
        li.appendChild(num);
        li.appendChild(time);
        busListElement.appendChild(li);
    });
    document.getElementById('noBuses').style.display = hasBuses ? 'none' : 'block';
}

function showRoutePath(routeId) {
    if (!routeLayerGroup) return;
    routeLayerGroup.clearLayers();
    const route = routeData.find(r => r.id === routeId);
    if (!route || route.stops.length < 2) return;

    // Draw white outline for the route (background)
    const outlineLatLngs = route.stops.map(s => [s.lat, s.lng]);
    L.polyline(outlineLatLngs, {
        className: 'route-outline',
        color: '#ffffff',
        weight: 8,
        opacity: 0.6,
        lineJoin: 'round'
    }).addTo(routeLayerGroup);

    // Draw main route line
    const polyline = L.polyline(outlineLatLngs, {
        className: 'route-path',
        color: '#3498db',
        weight: 4,
        opacity: 0.9,
        lineJoin: 'round'
    }).addTo(routeLayerGroup);

    // Add numbered stop markers
    route.stops.forEach((stop, index) => {
        const isTerminus = (index === 0 || index === route.stops.length - 1);
        const marker = L.circleMarker([stop.lat, stop.lng], {
            radius: isTerminus ? 8 : 6,
            color: '#2980b9',
            fillColor: '#ffffff',
            fillOpacity: 1,
            weight: 3,
            className: 'stop-marker'
        }).addTo(routeLayerGroup);
        marker.bindPopup(`<b>${stop.name}</b>`);
    });

    // Fit map to route bounds
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
}

btnRefreshBuses.addEventListener('click', () => {
    firebase.database().ref('activeBuses').off();
    listenToActiveBuses();
});

passengerRouteSelect.addEventListener('change', () => {
    updateBusList();
    const filter = passengerRouteSelect.value;
    if (filter) {
        showRoutePath(filter);
    } else {
        if (routeLayerGroup) routeLayerGroup.clearLayers();
    }
    refreshPassengerView();
});

window.addEventListener('DOMContentLoaded', init);
