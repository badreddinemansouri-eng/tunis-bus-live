// ============================================================
// 🚌 TUNIS BUS LIVE – ULTIMATE EDITION (Updated)
// ============================================================

import { initMap, showRoute, updateBuses, clearMap, focusStop, getMap } from './map.js';
import { openDB, saveRoutes, getRoutes, saveTrip, getTrips, toggleFavorite, getFavorites } from './db.js';
import { buildSearchIndex, search, getRoute } from './search.js';
import { initPWA, isOnline, onOnline, onOffline } from './pwa.js';

// ============ CONSTANTS ============
const STALE_THRESHOLD = 3 * 60 * 1000;
const REMOVE_THRESHOLD = 10 * 60 * 1000;
const AUTO_END_TIMEOUT = 5 * 60;
const CLEANUP_INTERVAL = 30000;

// ============ STATE ============
let currentView = 'passenger';
let currentTripId = null;
let watchId = null;
let bgWatcherId = null;
let routeData = [];
let activeBuses = {};
let favorites = [];
let isListening = false;
let map = null;
let driverName = '';
let selectedRouteId = null;
let selectedDirection = 'forward';
let autoEndTimer = null;
let lastMovementTime = Date.now();
let driverSpeed = 0;
let driverLocation = null;
let isTripActive = false;
let cleanupTimer = null;

const isNative = window.Capacitor && Capacitor.isNative;

// ============ DOM REFS ============
const $ = (id) => document.getElementById(id);
const driverView = $('driverView');
const passengerView = $('passengerView');
const tabDriver = $('tabDriver');
const tabPassenger = $('tabPassenger');
const routeSelect = $('routeSelect');
const driverNameInput = $('driverName');
const directionSelect = $('directionSelect');
const btnStartTrip = $('btnStartTrip');
const btnStopTrip = $('btnStopTrip');
const driverStatus = $('driverStatus');
const searchInput = $('searchInput');
const searchResults = $('searchResults');
const busList = $('busList');
const noBuses = $('noBuses');
const routeDetailPanel = $('routeDetailPanel');
const routeDetailContent = $('routeDetailContent');
const btnCloseDetail = $('btnCloseDetail');
const connectionStatus = $('connectionStatus');
const driverSearchInput = $('driverSearchInput');
const btnClearSearch = $('btnClearSearch');
const favoriteBtn = $('favoriteBtn');
const historyBtn = $('historyBtn');
const historyPanel = $('historyPanel');
const historyList = $('historyList');
const btnCloseHistory = $('btnCloseHistory');
const busCount = $('busCount');

// Full Route Panel
const fullRoutePanel = $('fullRoutePanel');
const fullRouteContent = $('fullRouteContent');
const fullRouteTitle = $('fullRouteTitle');
const closeFullRoute = $('closeFullRoute');

// ============ INIT ============
async function init() {
  console.log(`🚌 Tunis Bus Live v6.0 – ${isNative ? 'Native (Background)' : 'PWA'} mode`);
  initPWA();
  await loadRoutes();
  setupTabs();
  setupDriverUI();
  setupPassengerUI();
  setupSearch();
  setupHistory();
  setupFavorites();
  setupConnection();
  map = initMap('map');
  listenToActiveBuses();

  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(cleanupStaleBuses, CLEANUP_INTERVAL);

  onOnline(() => {
    connectionStatus.textContent = 'Online ✅';
    connectionStatus.className = 'connection-badge online';
    listenToActiveBuses();
  });
  onOffline(() => {
    connectionStatus.textContent = 'Offline ⚠️';
    connectionStatus.className = 'connection-badge offline';
    showToast('You are offline. Live updates paused.', 'warning');
  });

  favorites = await getFavorites();
  updateFavoriteButton();

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => autoDetectRoute(pos.coords.latitude, pos.coords.longitude),
      () => {},
      { timeout: 5000, enableHighAccuracy: false }
    );
  }
  console.log('✅ App ready');
}

// ============ LOAD ROUTES ============
async function loadRoutes() {
  try {
    let routes = await getRoutes();
    if (routes && routes.length > 0) {
      routeData = routes;
      console.log('📦 Loaded', routes.length, 'routes from IndexedDB');
      populateRouteSelects();
      return;
    }
    if (typeof routesData !== 'undefined' && routesData.length > 0) {
      routeData = routesData;
      await saveRoutes(routeData);
      console.log('📦 Loaded', routeData.length, 'routes from script');
      populateRouteSelects();
      return;
    }
    const resp = await fetch('/js/routes.js');
    const text = await resp.text();
    const match = text.match(/routesData\s*=\s*(\[[\s\S]*?\]);/);
    if (match) {
      routeData = eval(match[1]);
      await saveRoutes(routeData);
      console.log('📦 Loaded', routeData.length, 'routes from fetch');
      populateRouteSelects();
    }
  } catch (e) {
    console.error('Failed to load routes:', e);
    showToast('Failed to load route data', 'error');
  }
}

function populateRouteSelects() {
  if (!routeSelect) return;
  routeSelect.innerHTML = '<option value="">-- Choose Route --</option>';
  routeData.forEach(route => {
    const opt = document.createElement('option');
    opt.value = route.id;
    opt.textContent = `${route.id} - ${route.name}`;
    routeSelect.appendChild(opt);
  });
  if (driverSearchInput) {
    driverSearchInput.addEventListener('input', function() {
      const q = this.value.toLowerCase();
      const opts = routeSelect.options;
      for (let i = 0; i < opts.length; i++) {
        opts[i].style.display = opts[i].text.toLowerCase().includes(q) ? '' : 'none';
      }
    });
  }
  buildSearchIndex();
}

// ============ TABS ============
function setupTabs() {
  tabDriver.addEventListener('click', () => switchView('driver'));
  tabPassenger.addEventListener('click', () => switchView('passenger'));
}

function switchView(view) {
  currentView = view;
  if (view === 'driver') {
    driverView.classList.add('active');
    passengerView.classList.remove('active');
    tabDriver.classList.add('active');
    tabPassenger.classList.remove('active');
    if (isListening) {
      firebase.database().ref('activeBuses').off();
      isListening = false;
    }
  } else {
    passengerView.classList.add('active');
    driverView.classList.remove('active');
    tabPassenger.classList.add('active');
    tabDriver.classList.remove('active');
    listenToActiveBuses();
    initMap();
  }
}

// ============ DRIVER UI ============
function setupDriverUI() {
  btnStartTrip.addEventListener('click', startTrip);
  btnStopTrip.addEventListener('click', stopTrip);
}

async function startTrip() {
  if (isTripActive) {
    showToast('Trip already active', 'warning');
    return;
  }

  let routeId = routeSelect.value;
  let direction = directionSelect.value;

  if (!routeId) {
    driverStatus.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Detecting route...';
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          const detection = autoDetectRoute(pos.coords.latitude, pos.coords.longitude);
          if (detection) {
            routeSelect.value = detection.route.id;
            directionSelect.value = detection.direction;
            routeId = detection.route.id;
            direction = detection.direction;
            startTripConfirmed(routeId, direction);
          } else {
            driverStatus.textContent = '❌ No route detected. Please select manually.';
          }
        },
        () => { driverStatus.textContent = '❌ Could not get location. Select manually.'; },
        { timeout: 8000, enableHighAccuracy: true }
      );
      return;
    }
    alert('Please select a route');
    return;
  }
  startTripConfirmed(routeId, direction);
}

async function startTripConfirmed(routeId, direction) {
  const route = routeData.find(r => r.id === routeId);
  if (!route) { alert('Route not found'); return; }

  if (navigator.geolocation) {
    try {
      const pos = await getCurrentPosition();
      if (!isNearRoute(route, pos.coords.latitude, pos.coords.longitude)) {
        if (!confirm('You are not near this route. Continue anyway?')) {
          driverStatus.textContent = '❌ Trip cancelled - not near route';
          return;
        }
      }
    } catch(e) {}
  }

  const driver = driverNameInput.value.trim() || 'Anonymous';
  currentTripId = `${routeId}_${Date.now()}`;

  const tripData = {
    routeId,
    direction,
    driverName: driver,
    startedAt: firebase.database.ServerValue.TIMESTAMP,
    lastUpdate: firebase.database.ServerValue.TIMESTAMP,
    lat: null,
    lng: null
  };

  try {
    await firebase.database().ref(`activeBuses/${currentTripId}`).set(tripData);
  } catch(e) {
    console.error('Firebase error:', e);
    showToast('Could not start trip. Check connection.', 'error');
    return;
  }

  isTripActive = true;

  // Native background or web geolocation
  if (isNative) {
    try {
      const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation');
      await BackgroundGeolocation.requestPermissions();
      bgWatcherId = await BackgroundGeolocation.addWatcher({
        backgroundMessage: 'Tunis Bus Live is tracking your bus',
        backgroundTitle: 'Bus Tracking Active',
        requestPermissions: false,
        stale: false,
        distanceFilter: 10,
        interval: 5000,
        notificationTitle: 'Tunis Bus Live',
        notificationText: 'Tracking your bus location',
        notificationIconColor: '#f5a623',
        notificationIconLarge: 'ic_stat_bus'
      }, (location, error) => {
        if (error) { console.error('BG error:', error); return; }
        driverLocation = location;
        driverSpeed = location.speed || 0;
        lastMovementTime = Date.now();
        firebase.database().ref(`activeBuses/${currentTripId}`).update({
          lat: location.latitude,
          lng: location.longitude,
          accuracy: location.accuracy,
          speed: driverSpeed,
          heading: location.heading || 0,
          lastUpdate: firebase.database.ServerValue.TIMESTAMP
        });
        driverStatus.innerHTML = `<i class="fas fa-broadcast-tower"></i> BG Sharing (acc: ${Math.round(location.accuracy)}m)`;
      });
      driverStatus.innerHTML = '✅ Native background tracking active';
    } catch (e) {
      console.error('Failed to start background geolocation:', e);
      showToast('Background tracking unavailable. Using web geolocation.', 'warning');
      startWebGeolocation();
    }
  } else {
    startWebGeolocation();
  }

  await saveTrip({ id: currentTripId, routeId, direction, driver, startedAt: Date.now(), endedAt: null });

  btnStartTrip.classList.add('hidden');
  btnStopTrip.classList.remove('hidden');
  routeSelect.disabled = true;
  directionSelect.disabled = true;
  driverStatus.innerHTML = `<i class="fas fa-check-circle" style="color:#27ae60;"></i> Trip started on ${routeId} (${direction})`;
  showToast(`🚌 Trip started on ${routeId}`, 'success');

  if (autoEndTimer) clearInterval(autoEndTimer);
  autoEndTimer = setInterval(checkAutoEnd, 30000);

  setTimeout(() => switchView('passenger'), 500);
}

function startWebGeolocation() {
  watchId = navigator.geolocation.watchPosition(
    pos => {
      driverLocation = pos.coords;
      driverSpeed = pos.coords.speed || 0;
      lastMovementTime = Date.now();
      firebase.database().ref(`activeBuses/${currentTripId}`).update({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        speed: driverSpeed,
        heading: pos.coords.heading || 0,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
      });
      driverStatus.innerHTML = `<i class="fas fa-broadcast-tower"></i> Sharing (acc: ${Math.round(pos.coords.accuracy)}m)`;
    },
    err => {
      driverStatus.textContent = '⚠️ Location error: ' + err.message;
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

function stopTrip() {
  if (isNative && bgWatcherId) {
    try {
      import('@capacitor-community/background-geolocation').then(module => {
        module.BackgroundGeolocation.removeWatcher({ id: bgWatcherId });
      }).catch(() => {});
    } catch(e) {}
    bgWatcherId = null;
  }
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  if (currentTripId) {
    firebase.database().ref(`activeBuses/${currentTripId}`).remove();
    saveTrip({ id: currentTripId, endedAt: Date.now() });
    currentTripId = null;
  }
  isTripActive = false;
  if (autoEndTimer) {
    clearInterval(autoEndTimer);
    autoEndTimer = null;
  }
  btnStartTrip.classList.remove('hidden');
  btnStopTrip.classList.add('hidden');
  routeSelect.disabled = false;
  directionSelect.disabled = false;
  driverStatus.innerHTML = '<i class="fas fa-flag-checkered"></i> Trip ended.';
  showToast('🚏 Trip ended', 'info');
}

function checkAutoEnd() {
  if (!currentTripId || !isTripActive) return;
  if (!driverLocation) return;
  const now = Date.now();
  const timeSinceMove = (now - lastMovementTime) / 1000;
  if (driverSpeed < 0.5 && timeSinceMove > AUTO_END_TIMEOUT) {
    if (!confirm('⚠️ You haven\'t moved for 5 minutes. Did you end your trip?')) {
      lastMovementTime = now;
      return;
    }
    showToast('🛑 Trip auto‑ended due to inactivity', 'warning');
    stopTrip();
  }
}

// ============ AUTO‑DETECT ROUTE ============
function autoDetectRoute(lat, lng) {
  let best = null, bestDist = Infinity, bestDir = 'forward';
  routeData.forEach(route => {
    route.stops.forEach((stop, idx) => {
      const d = haversineDistance(lat, lng, stop.lat, stop.lng);
      if (d < bestDist) {
        bestDist = d;
        best = route;
        bestDir = (idx < route.stops.length / 2) ? 'forward' : 'backward';
      }
    });
  });
  if (bestDist > 0.5) return null;
  return { route: best, direction: bestDir };
}

function isNearRoute(route, lat, lng) {
  return route.stops.some(s => haversineDistance(lat, lng, s.lat, s.lng) <= 0.5);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000
    });
  });
}

// ============ PASSENGER UI ============
function setupPassengerUI() {
  btnCloseDetail.addEventListener('click', () => routeDetailPanel.classList.add('hidden'));
  closeFullRoute.addEventListener('click', () => fullRoutePanel.classList.add('hidden'));

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
  refreshBtn.style.width = 'auto';
  refreshBtn.style.marginTop = '8px';
  refreshBtn.addEventListener('click', () => {
    firebase.database().ref('activeBuses').off();
    listenToActiveBuses();
    showToast('🔄 Refreshing...', 'info');
  });
  document.querySelector('.bus-list-card').appendChild(refreshBtn);
}

function setupFavorites() {
  if (favoriteBtn) {
    favoriteBtn.addEventListener('click', async () => {
      if (!selectedRouteId) { showToast('Select a route first', 'warning'); return; }
      await toggleFavorite(selectedRouteId);
      favorites = await getFavorites();
      updateFavoriteButton();
      showToast(favorites.includes(selectedRouteId) ? '⭐ Added to favorites' : '⭐ Removed from favorites', 'info');
      renderBusList();
    });
  }
}

function updateFavoriteButton() {
  if (!favoriteBtn) return;
  const isFav = favorites.includes(selectedRouteId);
  favoriteBtn.innerHTML = isFav ? '<i class="fas fa-star"></i> Favorited' : '<i class="far fa-star"></i> Favorite';
  favoriteBtn.style.background = isFav ? '#f5a623' : 'transparent';
  favoriteBtn.style.color = isFav ? '#0d2b45' : '#333';
}

// ============ HISTORY ============
function setupHistory() {
  if (historyBtn) {
    historyBtn.addEventListener('click', async () => {
      const trips = await getTrips();
      if (trips.length === 0) {
        historyList.innerHTML = '<div class="empty-state"><i class="fas fa-history"></i><p>No trips yet</p></div>';
      } else {
        historyList.innerHTML = trips.map(t => `
          <div class="history-item">
            <strong>${t.routeId}</strong>
            <span>${t.direction || '—'}</span>
            <span>${t.driver || 'Anonymous'}</span>
            <span>${new Date(t.startedAt).toLocaleDateString()}</span>
            ${t.endedAt ? `<span>✅</span>` : `<span>🔄 Active</span>`}
          </div>
        `).join('');
      }
      historyPanel.classList.toggle('hidden');
    });
  }
  if (btnCloseHistory) {
    btnCloseHistory.addEventListener('click', () => historyPanel.classList.add('hidden'));
  }
}

// ============ SEARCH ============
function setupSearch() {
  searchInput.addEventListener('input', handleSearch);
  btnClearSearch.addEventListener('click', () => {
    searchInput.value = '';
    searchResults.classList.add('hidden');
    searchResults.innerHTML = '';
  });
}

async function handleSearch() {
  const q = searchInput.value.trim();
  if (q.length < 1) {
    searchResults.classList.add('hidden');
    return;
  }
  const results = search(q);
  if (results.length === 0) {
    searchResults.innerHTML = '<div class="search-result-item" style="color:#999;">No results</div>';
    searchResults.classList.remove('hidden');
    return;
  }
  let html = '';
  results.slice(0, 15).forEach(item => {
    if (item.type === 'route') {
      html += `<div class="search-result-item" data-routeid="${item.id}" data-type="route">
        <span>🚌 ${item.id} - ${item.name}</span>
        <span class="badge">Route</span>
      </div>`;
    } else {
      html += `<div class="search-result-item" data-stoplat="${item.lat}" data-stoplng="${item.lng}" data-stopname="${item.name}" data-type="stop">
        <span>📍 ${item.name} (${item.routeId})</span>
        <span class="badge">Stop</span>
      </div>`;
    }
  });
  searchResults.innerHTML = html;
  searchResults.classList.remove('hidden');

  searchResults.querySelectorAll('.search-result-item').forEach(el => {
    el.addEventListener('click', function() {
      const type = this.dataset.type;
      if (type === 'route') {
        const routeId = this.dataset.routeid;
        selectedRouteId = routeId;
        showRoute(routeId, routeData);
        updateFavoriteButton();
        searchInput.value = '';
        searchResults.classList.add('hidden');
        showRouteDetail(routeId);
        showFullRoute(routeId, null);
      } else if (type === 'stop') {
        const lat = parseFloat(this.dataset.stoplat);
        const lng = parseFloat(this.dataset.stoplng);
        const name = this.dataset.stopname;
        focusStop(lat, lng, name);
        searchInput.value = '';
        searchResults.classList.add('hidden');
        showStopDetail(lat, lng, name);
      }
    });
  });
}

function showRouteDetail(routeId) {
  const route = routeData.find(r => r.id === routeId);
  if (!route) return;
  const isFav = favorites.includes(routeId);
  routeDetailContent.innerHTML = `
    <h4>${route.id} - ${route.name}</h4>
    <p><span style="color:#2196F3;">Aller:</span> ${route.aller ? route.aller.length : 0} stops</p>
    <p><span style="color:#FF9800;">Retour:</span> ${route.retour ? route.retour.length : 0} stops</p>
    <div style="margin-top:8px;max-height:200px;overflow-y:auto;">
      ${route.stops.map(s => `<div class="stop-item"><i class="fas fa-circle" style="font-size:8px;color:#3498db;"></i> ${s.name}</div>`).join('')}
    </div>
    <div style="margin-top:10px;display:flex;gap:10px;">
      <button class="btn btn-primary" style="width:auto;padding:8px 16px;" onclick="window.showOnMap('${routeId}')">
        <i class="fas fa-map"></i> Show on map
      </button>
      <button class="btn btn-secondary" style="width:auto;padding:8px 16px;background:${isFav ? '#f5a623' : '#e0e0e0'};color:${isFav ? '#0d2b45' : '#333'};" onclick="window.toggleFavoriteRoute('${routeId}')">
        <i class="fas fa-star"></i>
      </button>
      <button class="btn btn-secondary" style="width:auto;padding:8px 16px;" onclick="window.showFullRoute('${routeId}', null)">
        <i class="fas fa-expand"></i> Full route
      </button>
    </div>
  `;
  routeDetailPanel.classList.remove('hidden');

  window.showOnMap = (id) => {
    showRoute(id, routeData);
    updateFavoriteButton();
  };
  window.toggleFavoriteRoute = async (id) => {
    await toggleFavorite(id);
    favorites = await getFavorites();
    updateFavoriteButton();
    showRouteDetail(id);
  };
  window.showFullRoute = showFullRoute;
}

function showStopDetail(lat, lng, name) {
  const routesWithStop = routeData.filter(r => r.stops.some(s => s.lat === lat && s.lng === lng));
  routeDetailContent.innerHTML = `
    <h4>📍 ${name}</h4>
    <p><strong>Served by:</strong></p>
    <ul>
      ${routesWithStop.map(r => `<li>${r.id} - ${r.name}</li>`).join('')}
    </ul>
    <button class="btn btn-primary" style="width:auto;padding:8px 16px;margin-top:8px;" onclick="window.focusStop(${lat}, ${lng}, '${name}')">
      <i class="fas fa-location-dot"></i> Center
    </button>
  `;
  routeDetailPanel.classList.remove('hidden');
}

// ============ FULL ROUTE VIEW ============
function showFullRoute(routeId, busData = null) {
  const route = routeData.find(r => r.id === routeId);
  if (!route) return;
  fullRouteTitle.textContent = `${route.id} - ${route.name}`;

  const allerSet = new Set(route.aller.map(s => `${s.lat},${s.lng}`));
  const retourSet = new Set(route.retour.map(s => `${s.lat},${s.lng}`));
  const busPos = busData ? { lat: busData.lat, lng: busData.lng } : null;

  let html = '';
  route.stops.forEach((stop, idx) => {
    const key = `${stop.lat},${stop.lng}`;
    let dir = '';
    if (allerSet.has(key) && retourSet.has(key)) dir = '↕ Both';
    else if (allerSet.has(key)) dir = '↑ Aller';
    else if (retourSet.has(key)) dir = '↓ Retour';

    let eta = '';
    let isBusHere = false;
    if (busPos) {
      const dist = haversineDistance(busPos.lat, busPos.lng, stop.lat, stop.lng);
      if (dist < 0.5) {
        eta = '📍 Bus here';
        isBusHere = true;
      } else if (busData.speed && busData.speed > 0.5) {
        const timeSec = (dist / busData.speed) * 3600;
        if (timeSec < 60) eta = '~' + Math.round(timeSec) + 's';
        else if (timeSec < 3600) eta = '~' + Math.round(timeSec/60) + 'm';
        else eta = '>1h';
      }
    }

    html += `
      <div class="route-stop-item ${isBusHere ? 'bus-here' : ''}">
        <span class="stop-index">#${idx+1}</span>
        <span class="stop-name">${stop.name}</span>
        <span class="stop-direction">${dir}</span>
        ${eta ? `<span class="stop-eta">${eta}</span>` : ''}
        ${isBusHere ? `<span class="stop-bus-here">🚌</span>` : ''}
      </div>
    `;
  });
  fullRouteContent.innerHTML = html;
  fullRoutePanel.classList.remove('hidden');
}

// Expose to global
window.showFullRoute = showFullRoute;
window.focusStop = focusStop;

// ============ LIVE BUSES ============
function listenToActiveBuses() {
  if (isListening) return;
  const ref = firebase.database().ref('activeBuses');
  isListening = true;
  clearMap();
  ref.on('child_added', snap => {
    const data = snap.val();
    data.tripId = snap.key;
    activeBuses[snap.key] = data;
    updateBusUI();
  });
  ref.on('child_changed', snap => {
    const data = snap.val();
    data.tripId = snap.key;
    activeBuses[snap.key] = data;
    updateBusUI();
  });
  ref.on('child_removed', snap => {
    delete activeBuses[snap.key];
    updateBusUI();
  });
  firebase.database().ref('.info/connected').on('value', snap => {
    if (snap.val() === true) {
      connectionStatus.textContent = 'Online ✅';
      connectionStatus.className = 'connection-badge online';
    } else {
      connectionStatus.textContent = 'Offline ⚠️';
      connectionStatus.className = 'connection-badge offline';
    }
  });
}

function cleanupStaleBuses() {
  const now = Date.now();
  let removed = false;
  for (let key in activeBuses) {
    const bus = activeBuses[key];
    if (!bus.lastUpdate) continue;
    if (now - bus.lastUpdate > REMOVE_THRESHOLD) {
      if (key !== currentTripId) {
        firebase.database().ref(`activeBuses/${key}`).remove().catch(() => {});
        delete activeBuses[key];
        removed = true;
      }
    }
  }
  if (removed) updateBusUI();
}

function updateBusUI() {
  const now = Date.now();
  const validBuses = Object.values(activeBuses).filter(bus => {
    if (!bus.lat || !bus.lng || !bus.routeId) return false;
    if (now - bus.lastUpdate > REMOVE_THRESHOLD) return false;
    return true;
  });
  validBuses.forEach(bus => {
    bus.isEstimated = (now - bus.lastUpdate > STALE_THRESHOLD);
  });
  const grouped = {};
  validBuses.forEach(bus => {
    if (!grouped[bus.routeId] || bus.lastUpdate > grouped[bus.routeId].lastUpdate) {
      grouped[bus.routeId] = bus;
    }
  });
  updateBuses(grouped, routeData);
  renderBusList(Object.values(grouped));
}

function renderBusList(buses) {
  if (!busList) return;
  busList.innerHTML = '';
  if (buses.length === 0) {
    noBuses.style.display = 'block';
    if (busCount) busCount.textContent = '';
    return;
  }
  noBuses.style.display = 'none';
  if (busCount) busCount.textContent = `(${buses.length})`;

  buses.forEach(bus => {
    const li = document.createElement('li');
    const route = routeData.find(r => r.id === bus.routeId);
    const isStale = (Date.now() - bus.lastUpdate > 120000);
    const status = isStale ? '🟡 Stale' : '🟢 Live';
    const time = new Date(bus.lastUpdate).toLocaleTimeString();

    li.innerHTML = `
      <div class="bus-item">
        <span class="bus-number">${bus.routeId}</span>
        <span>${route ? route.name : ''}</span>
        <span style="font-size:0.7rem;color:${isStale ? 'orange' : 'green'};">${status}</span>
        <button class="report-btn" data-trip="${bus.tripId}" style="background:#f5a623;border:none;border-radius:4px;padding:2px 8px;cursor:pointer;">📍 I see it</button>
        <span style="font-size:0.7rem;color:#999;">${time}</span>
      </div>
    `;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => {
      if (route) {
        selectedRouteId = bus.routeId;
        showRoute(bus.routeId, routeData);
        updateFavoriteButton();
        showFullRoute(bus.routeId, bus);
        showRouteDetail(bus.routeId);
      }
    });
    li.querySelector('.report-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const tripId = e.target.dataset.trip;
      await firebase.database().ref(`activeBuses/${tripId}`).update({
        lastUpdate: firebase.database.ServerValue.TIMESTAMP,
        reportedBy: 'passenger'
      });
      showToast('✅ Bus position confirmed by passenger', 'success');
    });
    busList.appendChild(li);
  });
}

// ============ CONNECTION ============
function setupConnection() {
  connectionStatus.textContent = 'Connecting...';
  connectionStatus.className = 'connection-badge';
  firebase.database().ref('/').once('value')
    .then(() => {
      connectionStatus.textContent = 'Online ✅';
      connectionStatus.className = 'connection-badge online';
    })
    .catch(() => {
      connectionStatus.textContent = 'Offline ⚠️';
      connectionStatus.className = 'connection-badge offline';
    });
}

// ============ TOAST ============
function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : type === 'warning' ? '#f39c12' : '#2c3e50'};
    color: white;
    padding: 12px 24px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 99999;
    font-weight: 600;
    max-width: 90%;
    animation: fadeInUp 0.3s ease;
    font-size: 0.9rem;
  `;
  document.body.appendChild(toast);
  if (!document.getElementById('toastStyle')) {
    const style = document.createElement('style');
    style.id = 'toastStyle';
    style.textContent = `@keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
    document.head.appendChild(style);
  }
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}
window.showToast = showToast;

// ============ START ============
document.addEventListener('DOMContentLoaded', init);
