// ============================================================
// 🚌 TUNIS BUS LIVE – v14.1 (Smart Routing Fix)
// ============================================================

import { initMap, showRoute, updateBuses, clearMap, focusStop, getMap, focusOnBus } from './map.js';
import { openDB, saveRoutes, getRoutes, saveTrip, getTrips, toggleFavorite, getFavorites } from './db.js';
import { buildSearchIndex, search, getRoute } from './search.js';
import { initPWA, isOnline, onOnline, onOffline } from './pwa.js';

// ============ CONSTANTS ============
const STALE_THRESHOLD = 3 * 60 * 1000;
const REMOVE_THRESHOLD = 10 * 60 * 1000;
const AUTO_END_TIMEOUT = 5 * 60;
const CLEANUP_INTERVAL = 30000;
const WALK_SPEED_KMH = 5;
const BUS_SPEED_KMH = 15;
const WAITING_TIME_MIN = 5;
const TRANSFER_WALK_RADIUS_KM = 0.8;

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
let fullscreenBusActive = false;
let currentLang = 'en';
let adminInterval = null;
let userLocationForTrip = null;
let destinationSelectionMode = false;
let destinationSelectionCallback = null;
let userLocationMarker = null;
let tripLayer = null;
let selectedDestinationStop = null;
let pendingWrites = [];
let syncInProgress = false;
let isAdmin = false;
let currentUser = null;

const isNative = window.Capacitor && Capacitor.isNative;

// ============ FIREBASE AUTH ============
let auth = firebase.auth();
let performance = null;
let crashlytics = null;

try {
  if (firebase.performance) performance = firebase.performance();
  if (firebase.crashlytics) crashlytics = firebase.crashlytics();
} catch(e) {}

// ============ TRANSLATIONS ============
const translations = {
  en: {
    driver: 'Driver',
    passenger: 'Passenger',
    driverPanel: 'Driver Panel',
    yourName: 'Your Name',
    route: 'Route',
    direction: 'Direction',
    startTrip: 'Start Trip',
    stopTrip: 'Stop Trip',
    findBus: 'Find Your Bus',
    activeBuses: 'Active Buses',
    noBuses: 'No active buses right now.',
    favorite: 'Favorite',
    history: 'History',
    feedback: 'Feedback',
    routeDetails: 'Route Details',
    close: 'Close',
    tripHistory: 'Trip History',
    appTitle: 'Tunis Bus Live',
    login: 'Login',
    logout: 'Logout',
    admin: 'Admin'
  },
  fr: {
    driver: 'Conducteur',
    passenger: 'Passager',
    driverPanel: 'Panneau Conducteur',
    yourName: 'Votre Nom',
    route: 'Itinéraire',
    direction: 'Direction',
    startTrip: 'Démarrer Trajet',
    stopTrip: 'Arrêter Trajet',
    findBus: 'Trouvez Votre Bus',
    activeBuses: 'Bus Actifs',
    noBuses: 'Aucun bus actif pour le moment.',
    favorite: 'Favori',
    history: 'Historique',
    feedback: 'Avis',
    routeDetails: 'Détails de l\'itinéraire',
    close: 'Fermer',
    tripHistory: 'Historique des Trajets',
    appTitle: 'Tunis Bus Live',
    login: 'Connexion',
    logout: 'Déconnexion',
    admin: 'Admin'
  },
  ar: {
    driver: 'سائق',
    passenger: 'راكب',
    driverPanel: 'لوحة السائق',
    yourName: 'اسمك',
    route: 'المسار',
    direction: 'الاتجاه',
    startTrip: 'بدء الرحلة',
    stopTrip: 'إنهاء الرحلة',
    findBus: 'ابحث عن حافلتك',
    activeBuses: 'الحافلات النشطة',
    noBuses: 'لا توجد حافلات نشطة حالياً.',
    favorite: 'المفضلة',
    history: 'السجل',
    feedback: 'تقييم',
    routeDetails: 'تفاصيل المسار',
    close: 'إغلاق',
    tripHistory: 'سجل الرحلات',
    appTitle: 'تونس باص لايف',
    login: 'تسجيل الدخول',
    logout: 'تسجيل الخروج',
    admin: 'المشرف'
  }
};

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
const langSwitcher = $('langSwitcher');
const adminToggle = $('adminToggle');
const adminPanel = $('adminPanel');
const closeAdmin = $('closeAdmin');
const statBuses = $('statBuses');
const statDrivers = $('statDrivers');
const statRoutes = $('statRoutes');
const statTrips = $('statTrips');
const adminBusList = $('adminBusList');
const feedbackBtn = $('feedbackBtn');
const feedbackModal = $('feedbackModal');
const closeFeedback = $('closeFeedback');
const submitFeedback = $('submitFeedback');
const feedbackText = $('feedbackText');
const nearbyBtn = $('nearbyBtn');
const nearbyModal = $('nearbyModal');
const nearbyResults = $('nearbyResults');
const closeNearby = $('closeNearby');
const planTripBtn = $('planTripBtn');
const planTripModal = $('planTripModal');
const destinationInput = $('destinationInput');
const searchTripBtn = $('searchTripBtn');
const tripResults = $('tripResults');
const closePlanTrip = $('closePlanTrip');
const pickDestinationMap = $('pickDestinationMap');

const fullscreenOverlay = $('fullscreenBusView');
const fullscreenMapContainer = $('fullscreenMapContainer');
const fsBusTitle = $('fsBusTitle');
const fsBusRoute = $('fsBusRoute');
const fsBusDriver = $('fsBusDriver');
const fsBusStops = $('fsBusStops');
const closeFullscreenBtn = $('closeFullscreenBus');

const loginModal = $('loginModal');
const loginEmail = $('loginEmail');
const loginPassword = $('loginPassword');
const loginBtn = $('loginBtn');
const loginCancel = $('loginCancel');
const loginError = $('loginError');
const logoutBtn = $('logoutBtn');
const userStatus = $('userStatus');

const routeManagementModal = $('routeManagementModal');
const closeRouteMgmt = $('closeRouteMgmt');
const addRouteBtn = $('addRouteBtn');
const routeMgmtForm = $('routeMgmtForm');
const routeMgmtId = $('routeMgmtId');
const routeMgmtName = $('routeMgmtName');
const routeMgmtStops = $('routeMgmtStops');
const routeMgmtAller = $('routeMgmtAller');
const routeMgmtRetour = $('routeMgmtRetour');
const routeMgmtSubmit = $('routeMgmtSubmit');
const routeMgmtList = $('routeMgmtList');

// ============ LANGUAGE FUNCTIONS ============
function setLanguage(lang) {
  currentLang = lang;
  const t = translations[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (t[key]) el.textContent = t[key];
  });
  const titleEl = document.getElementById('appTitle');
  if (titleEl && t.appTitle) titleEl.textContent = t.appTitle;
  if (logoutBtn) logoutBtn.textContent = t.logout || 'Logout';
  if (adminToggle) adminToggle.textContent = t.admin || 'Admin';
  localStorage.setItem('lang', lang);
}

function loadLanguage() {
  const saved = localStorage.getItem('lang') || 'en';
  if (langSwitcher) langSwitcher.value = saved;
  setLanguage(saved);
}

// ============ HELPER FUNCTIONS ============
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

// ============ MIN HEAP ============
class MinHeap {
  constructor() { this.heap = []; }
  push(val) { this.heap.push(val); this._siftUp(this.heap.length - 1); }
  pop() {
    if (this.heap.length === 0) return null;
    this._swap(0, this.heap.length - 1);
    const top = this.heap.pop();
    this._siftDown(0);
    return top;
  }
  isEmpty() { return this.heap.length === 0; }
  _siftUp(i) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.heap[p].dist <= this.heap[i].dist) break;
      this._swap(i, p);
      i = p;
    }
  }
  _siftDown(i) {
    const n = this.heap.length;
    while (true) {
      let l = 2 * i + 1, r = 2 * i + 2, smallest = i;
      if (l < n && this.heap[l].dist < this.heap[smallest].dist) smallest = l;
      if (r < n && this.heap[r].dist < this.heap[smallest].dist) smallest = r;
      if (smallest === i) break;
      this._swap(i, smallest);
      i = smallest;
    }
  }
  _swap(i, j) { [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]]; }
}

// ============ AUTHENTICATION ============
function initAuth() {
  auth.onAuthStateChanged(user => {
    currentUser = user;
    if (user) {
      isAdmin = user.email && user.email === 'admin@tunisbus.tn';
      userStatus.textContent = `👤 ${user.email || user.uid}`;
      userStatus.style.color = '#27ae60';
      logoutBtn.style.display = 'inline-block';
      driverNameInput.value = user.displayName || user.email || 'Driver';
      driverNameInput.disabled = false;
      if (isAdmin) {
        adminToggle.style.display = 'inline-block';
        if (routeMgmtList) routeMgmtList.style.display = 'block';
      }
      if (loginModal) loginModal.classList.add('hidden');
    } else {
      isAdmin = false;
      userStatus.textContent = '👤 Not logged in';
      userStatus.style.color = '#e74c3c';
      logoutBtn.style.display = 'none';
      driverNameInput.disabled = true;
      driverNameInput.value = 'Driver (login required)';
      adminToggle.style.display = 'none';
      if (routeMgmtList) routeMgmtList.style.display = 'none';
      if (!loginModal.classList.contains('hidden')) return;
      if (currentView === 'driver') {
        loginModal.classList.remove('hidden');
      }
    }
  });
}

async function loginUser(email, password) {
  try {
    loginError.textContent = '';
    await auth.signInWithEmailAndPassword(email, password);
    showToast('✅ Login successful', 'success');
    loginModal.classList.add('hidden');
  } catch (err) {
    loginError.textContent = err.message;
    showToast('❌ Login failed: ' + err.message, 'error');
  }
}

function logoutUser() {
  auth.signOut();
  showToast('Logged out', 'info');
}

// ============ OFFLINE WRITE QUEUE ============
const DB_NAME = 'TunisBusDB';

async function initWriteQueue() {
  const db = await openDB();
  if (!db.objectStoreNames.contains('pendingWrites')) {
    const version = db.version;
    db.close();
    const request = indexedDB.open(DB_NAME, version + 1);
    request.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('pendingWrites')) {
        d.createObjectStore('pendingWrites', { keyPath: 'id', autoIncrement: true });
      }
    };
    await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  const db2 = await openDB();
  const tx = db2.transaction('pendingWrites', 'readonly');
  const store = tx.objectStore('pendingWrites');
  const cursor = store.openCursor();
  pendingWrites = [];
  return new Promise((resolve) => {
    cursor.onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) {
        pendingWrites.push(cur.value);
        cur.continue();
      } else {
        resolve();
      }
    };
    cursor.onerror = () => resolve();
  });
}

async function addPendingWrite(write) {
  const db = await openDB();
  const tx = db.transaction('pendingWrites', 'readwrite');
  const store = tx.objectStore('pendingWrites');
  store.add(write);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  pendingWrites.push(write);
  updateSyncBadge();
}

async function removePendingWrite(id) {
  const db = await openDB();
  const tx = db.transaction('pendingWrites', 'readwrite');
  const store = tx.objectStore('pendingWrites');
  store.delete(id);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = (e) => reject(e.target.error);
  });
  pendingWrites = pendingWrites.filter(w => w.id !== id);
  updateSyncBadge();
}

async function processPendingWrites() {
  if (syncInProgress || pendingWrites.length === 0) return;
  syncInProgress = true;
  showToast(`🔄 Syncing ${pendingWrites.length} pending operations...`, 'info');
  let success = 0;
  for (let i = pendingWrites.length - 1; i >= 0; i--) {
    const write = pendingWrites[i];
    try {
      const ref = firebase.database().ref(write.path);
      if (write.type === 'set') await ref.set(write.data);
      else if (write.type === 'update') await ref.update(write.data);
      else if (write.type === 'push') await ref.push(write.data);
      else if (write.type === 'remove') await ref.remove();
      await removePendingWrite(write.id);
      success++;
    } catch (err) {
      console.error('Failed to sync write:', err);
    }
  }
  syncInProgress = false;
  if (success > 0) showToast(`✅ Synced ${success} operations`, 'success');
  updateSyncBadge();
}

function updateSyncBadge() {
  const badge = document.getElementById('syncBadge');
  if (!badge) return;
  const count = pendingWrites.length;
  if (count === 0) badge.style.display = 'none';
  else { badge.textContent = count; badge.style.display = 'inline-block'; }
}

async function secureWrite(path, data, type = 'set') {
  if (isOnline()) {
    try {
      const ref = firebase.database().ref(path);
      if (type === 'set') await ref.set(data);
      else if (type === 'update') await ref.update(data);
      else if (type === 'push') await ref.push(data);
      else if (type === 'remove') await ref.remove();
      return true;
    } catch (err) {
      console.error('Write failed, queuing:', err);
      await addPendingWrite({ path, data, type, timestamp: Date.now() });
      return false;
    }
  } else {
    await addPendingWrite({ path, data, type, timestamp: Date.now() });
    return false;
  }
}

// ============ ADMIN DASHBOARD ============
async function updateAdminStats() {
  try {
    const snapshot = await firebase.database().ref('activeBuses').once('value');
    const buses = snapshot.val() || {};
    const busList = Object.values(buses);
    const drivers = new Set(busList.map(b => b.driverName)).size;
    if (statBuses) statBuses.textContent = busList.length;
    if (statDrivers) statDrivers.textContent = drivers;
    if (statRoutes) statRoutes.textContent = routeData.length;
    if (statTrips) {
      const todayTrips = busList.filter(b => {
        const started = b.startedAt;
        if (!started) return false;
        const day = new Date(started).toDateString();
        return day === new Date().toDateString();
      }).length;
      statTrips.textContent = todayTrips;
    }
    if (adminBusList) {
      adminBusList.innerHTML = busList.map(b => `
        <div class="admin-bus-item" data-trip="${b.tripId}" style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;">
          <span>🚌 ${b.routeId}</span>
          <span>${b.driverName || 'Unknown'}</span>
          <span>${b.direction || '—'}</span>
          <span>${new Date(b.lastUpdate).toLocaleTimeString()}</span>
          <button class="zoom-bus-btn" data-trip="${b.tripId}" style="background:#3498db;border:none;border-radius:4px;padding:2px 10px;color:white;cursor:pointer;">Zoom</button>
        </div>
      `).join('');
      document.querySelectorAll('.zoom-bus-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          const tripId = this.dataset.trip;
          const bus = activeBuses[tripId];
          if (bus && bus.lat && bus.lng) focusStop(bus.lat, bus.lng, `Bus ${bus.routeId}`);
        });
      });
      const filterInput = document.getElementById('adminFilterRoute');
      if (filterInput) {
        filterInput.addEventListener('input', function() {
          const val = this.value.trim().toUpperCase();
          document.querySelectorAll('.admin-bus-item').forEach(item => {
            const route = item.querySelector('span:first-child')?.textContent || '';
            item.style.display = route.includes(val) ? 'flex' : 'none';
          });
        });
      }
    }
  } catch (e) {
    console.error('Admin stats error:', e);
  }
}

function openAdmin() {
  if (!isAdmin && !confirm('Admin access required. Are you admin?')) return;
  adminPanel.classList.remove('hidden');
  updateAdminStats();
  if (adminInterval) clearInterval(adminInterval);
  adminInterval = setInterval(updateAdminStats, 10000);
  if (isAdmin && routeMgmtList) {
    routeMgmtList.style.display = 'block';
    renderRouteManagementList();
  }
}

function closeAdminPanel() {
  adminPanel.classList.add('hidden');
  if (adminInterval) clearInterval(adminInterval);
}

// ============ ROUTE MANAGEMENT ============
function renderRouteManagementList() {
  if (!routeMgmtList) return;
  routeMgmtList.innerHTML = routeData.map(r => `
    <div class="route-mgmt-item" style="padding:8px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;">
      <span><strong>${r.id}</strong> - ${r.name}</span>
      <div>
        <button class="edit-route-btn" data-id="${r.id}" style="background:#f39c12;border:none;border-radius:4px;padding:2px 10px;color:white;cursor:pointer;">Edit</button>
        <button class="delete-route-btn" data-id="${r.id}" style="background:#e74c3c;border:none;border-radius:4px;padding:2px 10px;color:white;cursor:pointer;">Delete</button>
      </div>
    </div>
  `).join('');
  document.querySelectorAll('.edit-route-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      const id = this.dataset.id;
      const route = routeData.find(r => r.id === id);
      if (route) openRouteMgmtForm(route);
    });
  });
  document.querySelectorAll('.delete-route-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      if (confirm(`Delete route ${this.dataset.id}?`)) deleteRoute(this.dataset.id);
    });
  });
}

function openRouteMgmtForm(route = null) {
  routeManagementModal.classList.remove('hidden');
  if (route) {
    routeMgmtId.value = route.id;
    routeMgmtName.value = route.name;
    routeMgmtStops.value = JSON.stringify(route.stops, null, 2);
    routeMgmtAller.value = JSON.stringify(route.aller || [], null, 2);
    routeMgmtRetour.value = JSON.stringify(route.retour || [], null, 2);
    routeMgmtSubmit.textContent = 'Update Route';
  } else {
    routeMgmtId.value = '';
    routeMgmtName.value = '';
    routeMgmtStops.value = '';
    routeMgmtAller.value = '';
    routeMgmtRetour.value = '';
    routeMgmtSubmit.textContent = 'Add Route';
  }
}

async function saveRouteFromForm() {
  const id = routeMgmtId.value.trim();
  const name = routeMgmtName.value.trim();
  if (!id || !name) { showToast('Route ID and Name are required', 'warning'); return; }
  let stops, aller, retour;
  try {
    stops = JSON.parse(routeMgmtStops.value || '[]');
    aller = JSON.parse(routeMgmtAller.value || '[]');
    retour = JSON.parse(routeMgmtRetour.value || '[]');
  } catch(e) {
    showToast('Invalid JSON in stops/directions', 'error');
    return;
  }
  if (!stops.length) { showToast('At least one stop required', 'warning'); return; }
  const newRoute = { id, name, stops, aller, retour };
  const existingIndex = routeData.findIndex(r => r.id === id);
  if (existingIndex >= 0) routeData[existingIndex] = newRoute;
  else routeData.push(newRoute);
  await saveRoutes(routeData);
  await secureWrite(`routes/${id}`, newRoute, 'set');
  populateRouteSelects();
  renderRouteManagementList();
  showToast(`Route ${id} saved successfully`, 'success');
  routeManagementModal.classList.add('hidden');
}

async function deleteRoute(id) {
  routeData = routeData.filter(r => r.id !== id);
  await saveRoutes(routeData);
  await secureWrite(`routes/${id}`, null, 'remove');
  populateRouteSelects();
  renderRouteManagementList();
  showToast(`Route ${id} deleted`, 'info');
}

// ============ FEEDBACK ============
let selectedRating = 0;

function openFeedback() {
  feedbackModal.classList.remove('hidden');
  selectedRating = 0;
  document.querySelectorAll('.rating-star').forEach(el => el.classList.remove('active'));
  feedbackText.value = '';
}

function closeFeedbackModal() {
  feedbackModal.classList.add('hidden');
}

async function submitFeedbackHandler() {
  const rating = selectedRating;
  const comment = feedbackText.value.trim();
  if (rating === 0) { showToast('Please select a rating', 'warning'); return; }
  try {
    await secureWrite('feedback', {
      rating, comment,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      routeId: selectedRouteId || 'unknown',
      device: navigator.userAgent,
      userId: currentUser ? currentUser.uid : 'anonymous'
    }, 'push');
    showToast('Thank you for your feedback!', 'success');
    closeFeedbackModal();
  } catch (e) {
    showToast('Failed to send feedback', 'error');
  }
}

// ============ NEARBY STOPS ============
async function findNearbyStops() {
  if (!navigator.geolocation) { showToast('Geolocation not supported', 'error'); return; }
  showToast('Getting your location...', 'info');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      const results = getClosestStops(lat, lng, 8);
      displayNearbyResults(results);
    },
    (err) => { showToast('Could not get location. Please enable GPS.', 'error'); },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function getClosestStops(userLat, userLng, limit = 8) {
  const stopMap = new Map();
  routeData.forEach(route => {
    route.stops.forEach(stop => {
      const key = `${stop.lat},${stop.lng}`;
      if (!stopMap.has(key)) {
        stopMap.set(key, { name: stop.name, lat: stop.lat, lng: stop.lng, routes: new Set() });
      }
      stopMap.get(key).routes.add(route.id);
    });
  });
  const stops = Array.from(stopMap.values()).map(stop => {
    const dist = haversineDistance(userLat, userLng, stop.lat, stop.lng);
    return { ...stop, distance: dist };
  });
  stops.sort((a, b) => a.distance - b.distance);
  return stops.slice(0, limit);
}

function displayNearbyResults(stops) {
  if (!stops || stops.length === 0) {
    nearbyResults.innerHTML = '<p style="text-align:center;color:#999;">No stops found nearby.</p>';
  } else {
    let html = '';
    stops.forEach(stop => {
      const routeList = Array.from(stop.routes).join(', ');
      const distText = stop.distance < 1 ? `${Math.round(stop.distance * 1000)} m` : `${stop.distance.toFixed(1)} km`;
      html += `
        <div class="nearby-stop-item" data-lat="${stop.lat}" data-lng="${stop.lng}" data-name="${stop.name}" style="padding:10px;border-bottom:1px solid #eee;cursor:pointer;">
          <div style="font-weight:bold;">${stop.name}</div>
          <div style="font-size:0.85rem;color:#666;">${distText} · Routes: ${routeList}</div>
        </div>
      `;
    });
    nearbyResults.innerHTML = html;
    nearbyResults.querySelectorAll('.nearby-stop-item').forEach(el => {
      el.addEventListener('click', function() {
        const lat = parseFloat(this.dataset.lat), lng = parseFloat(this.dataset.lng), name = this.dataset.name;
        focusStop(lat, lng, name);
        nearbyModal.classList.add('hidden');
      });
    });
  }
  nearbyModal.classList.remove('hidden');
}

// ============ USER LOCATION MARKER ============
function updateUserLocation(lat, lng) {
  if (!map) return;
  if (!userLocationMarker) {
    userLocationMarker = L.circleMarker([lat, lng], {
      radius: 8, color: '#2196F3', fillColor: '#fff', fillOpacity: 1, weight: 3, className: 'user-location-marker'
    }).addTo(map);
    userLocationMarker.bindPopup('You are here');
  } else {
    userLocationMarker.setLatLng([lat, lng]);
  }
}

// ============ BUILD STOP GRAPH ============
function buildStopGraph() {
  const stopMap = new Map();
  routeData.forEach(route => {
    route.stops.forEach(stop => {
      const key = `${stop.lat},${stop.lng}`;
      if (!stopMap.has(key)) {
        stopMap.set(key, { name: stop.name, lat: stop.lat, lng: stop.lng, routes: new Set() });
      }
      stopMap.get(key).routes.add(route.id);
    });
  });
  return stopMap;
}

// ============ ROUTING ============
function runDijkstra(adj, startKey, endKey, weightFn) {
  const distMap = new Map();
  const prevMap = new Map();
  const prevEdgeMap = new Map();
  for (let key of adj.keys()) distMap.set(key, Infinity);
  distMap.set(startKey, 0);

  const pq = new MinHeap();
  pq.push({ key: startKey, dist: 0 });

  while (!pq.isEmpty()) {
    const { key, dist } = pq.pop();
    if (key === endKey) break;
    if (dist > distMap.get(key)) continue;

    for (const edge of adj.get(key) || []) {
      const weight = weightFn(edge);
      const candidateDist = dist + weight;
      if (candidateDist < distMap.get(edge.toKey)) {
        distMap.set(edge.toKey, candidateDist);
        prevMap.set(edge.toKey, key);
        prevEdgeMap.set(edge.toKey, edge);
        pq.push({ key: edge.toKey, dist: candidateDist });
      }
    }
  }

  if (!prevMap.has(endKey) && startKey !== endKey) return null;

  const path = [];
  let currentKey = endKey;
  while (currentKey !== startKey) {
    const edge = prevEdgeMap.get(currentKey);
    if (!edge) break;
    path.unshift(edge);
    currentKey = prevMap.get(currentKey);
  }

  return { path, totalWeight: distMap.get(endKey) };
}

function buildGraph(routeData) {
  const stopMap = buildStopGraph();
  const allKeys = Array.from(stopMap.keys());
  const adj = new Map();
  allKeys.forEach(k => adj.set(k, []));

  routeData.forEach(route => {
    const stops = route.stops;
    for (let i = 0; i < stops.length - 1; i++) {
      const s1 = stops[i], s2 = stops[i+1];
      const k1 = `${s1.lat},${s1.lng}`;
      const k2 = `${s2.lat},${s2.lng}`;
      const dist = haversineDistance(s1.lat, s1.lng, s2.lat, s2.lng);
      const timeWeight = (dist / BUS_SPEED_KMH) * 60;
      adj.get(k1).push({
        toKey: k2,
        timeWeight: timeWeight,
        walkDist: 0,
        type: 'bus',
        routeId: route.id,
        fromStop: s1,
        toStop: s2
      });
      adj.get(k2).push({
        toKey: k1,
        timeWeight: timeWeight,
        walkDist: 0,
        type: 'bus',
        routeId: route.id,
        fromStop: s2,
        toStop: s1
      });
    }
  });

  for (let i = 0; i < allKeys.length; i++) {
    for (let j = i + 1; j < allKeys.length; j++) {
      const k1 = allKeys[i], k2 = allKeys[j];
      const s1 = stopMap.get(k1), s2 = stopMap.get(k2);
      const dist = haversineDistance(s1.lat, s1.lng, s2.lat, s2.lng);
      if (dist < TRANSFER_WALK_RADIUS_KM) {
        const timeWeight = (dist / WALK_SPEED_KMH) * 60;
        adj.get(k1).push({
          toKey: k2,
          timeWeight: timeWeight,
          walkDist: dist,
          type: 'walk',
          fromStop: s1,
          toStop: s2
        });
        adj.get(k2).push({
          toKey: k1,
          timeWeight: timeWeight,
          walkDist: dist,
          type: 'walk',
          fromStop: s2,
          toStop: s1
        });
      }
    }
  }

  return { adj, stopMap, allKeys };
}

function reconstructResult(result, startKey, endKey, stopMap) {
  if (!result) return null;
  const { path, totalWeight } = result;

  let totalWalk = 0;
  path.forEach(edge => { if (edge.walkDist) totalWalk += edge.walkDist; });

  let busRides = 0;
  let prevRoute = null;
  for (const edge of path) {
    if (edge.type === 'bus') {
      if (prevRoute !== edge.routeId) {
        busRides++;
        prevRoute = edge.routeId;
      }
    } else {
      prevRoute = null;
    }
  }

  const mergedPath = [];
  for (const edge of path) {
    if (edge.type === 'walk') {
      mergedPath.push(edge);
    } else {
      const last = mergedPath[mergedPath.length - 1];
      if (last && last.type === 'bus' && last.routeId === edge.routeId && last.toStop === edge.fromStop) {
        last.toStop = edge.toStop;
      } else {
        mergedPath.push({ ...edge });
      }
    }
  }

  const totalTime = Math.round(totalWeight + busRides * WAITING_TIME_MIN);

  return {
    path: mergedPath,
    totalTime: totalTime,
    totalWalkDist: Math.round(totalWalk * 1000),
    busCount: busRides,
    startKey,
    endKey
  };
}

function generateTripInstructions(routePath, userLocation, destinationLocation) {
  let steps = [];
  if (!routePath || routePath.length === 0) {
    if (userLocation && destinationLocation) {
      const dist = haversineDistance(userLocation.lat, userLocation.lng, destinationLocation.lat, destinationLocation.lng);
      const walkTime = dist / WALK_SPEED_KMH * 60;
      steps.push({
        type: 'walk',
        from: userLocation,
        to: destinationLocation,
        distance: dist,
        time: walkTime,
        instruction: `Walk to your destination (${Math.round(dist*1000)}m, ~${Math.round(walkTime)} min)`
      });
    }
    return steps;
  }

  routePath.forEach((edge) => {
    if (edge.type === 'walk') {
      const dist = edge.walkDist || haversineDistance(edge.fromStop.lat, edge.fromStop.lng, edge.toStop.lat, edge.toStop.lng);
      const walkTime = (dist / WALK_SPEED_KMH) * 60;
      steps.push({
        type: 'walk',
        from: edge.fromStop,
        to: edge.toStop,
        distance: dist,
        time: walkTime,
        instruction: `🚶 Walk ${Math.round(dist*1000)}m to "${edge.toStop.name}" (~${Math.round(walkTime)} min)`
      });
    } else if (edge.type === 'bus') {
      const route = routeData.find(r => r.id === edge.routeId);
      steps.push({
        type: 'bus',
        routeId: edge.routeId,
        routeName: route ? route.name : edge.routeId,
        fromStop: edge.fromStop,
        toStop: edge.toStop,
        instruction: `🚌 Take ${edge.routeId} from "${edge.fromStop.name}" to "${edge.toStop.name}"`
      });
    }
  });

  if (destinationLocation && routePath.length > 0) {
    const lastEdge = routePath[routePath.length - 1];
    const lastStop = lastEdge.toStop;
    if (lastStop && destinationLocation) {
      const dist = haversineDistance(lastStop.lat, lastStop.lng, destinationLocation.lat, destinationLocation.lng);
      if (dist > 0.05) {
        const walkTime = dist / WALK_SPEED_KMH * 60;
        steps.push({
          type: 'walk',
          from: lastStop,
          to: destinationLocation,
          distance: dist,
          time: walkTime,
          instruction: `🚶 Walk to your destination (${Math.round(dist*1000)}m, ~${Math.round(walkTime)} min)`
        });
      }
    }
  }

  return steps;
}

function drawTripOnMap(routePath, userLocation, destinationLocation) {
  try {
    const mapInstance = getMap();
    if (!mapInstance) {
      showToast('Map not ready. Please refresh.', 'error');
      return;
    }
    if (!routePath || routePath.length === 0) {
      showToast('Invalid route data.', 'error');
      return;
    }
    if (tripLayer) {
      mapInstance.removeLayer(tripLayer);
      tripLayer = null;
    }
    tripLayer = L.layerGroup().addTo(mapInstance);

    routePath.forEach((edge, idx) => {
      if (edge.type === 'walk') {
        const walkLine = L.polyline([
          [edge.fromStop.lat, edge.fromStop.lng],
          [edge.toStop.lat, edge.toStop.lng]
        ], { color: '#9E9E9E', weight: 4, dashArray: '8, 8', opacity: 0.9 }).addTo(tripLayer);
        walkLine.bindPopup(`🚶 Walk to ${edge.toStop.name}`);
      } else if (edge.type === 'bus') {
        const route = routeData.find(r => r.id === edge.routeId);
        if (!route) return;
        const allStops = route.stops;
        const fromIdx = allStops.findIndex(s => s.lat === edge.fromStop.lat && s.lng === edge.fromStop.lng);
        const toIdx = allStops.findIndex(s => s.lat === edge.toStop.lat && s.lng === edge.toStop.lng);
        if (fromIdx === -1 || toIdx === -1) return;
        const start = Math.min(fromIdx, toIdx);
        const end = Math.max(fromIdx, toIdx);
        const segment = allStops.slice(start, end + 1).map(s => [s.lat, s.lng]);
        const colors = ['#2196F3', '#FF9800', '#4CAF50', '#9C27B0', '#F44336'];
        const color = colors[idx % colors.length];
        const line = L.polyline(segment, { color: color, weight: 6, opacity: 0.8 }).addTo(tripLayer);
        line.bindPopup(`🚌 ${edge.routeId}`);
      }
    });

    let bounds = null;
    try {
      if (typeof tripLayer.getBounds === 'function') bounds = tripLayer.getBounds();
    } catch (e) {}
    if (bounds && bounds.isValid && bounds.isValid()) {
      mapInstance.fitBounds(bounds, { padding: [50, 50] });
    } else if (userLocation) {
      mapInstance.setView([userLocation.lat, userLocation.lng], 14);
    }

    showToast('Trip shown on map ✅', 'success');
  } catch (e) {
    console.error('Error drawing trip:', e);
    showToast('Error showing trip: ' + e.message, 'error');
  }
}

// ============ PLAN TRIP ============
function openPlanTrip() {
  planTripModal.classList.remove('hidden');
  tripResults.innerHTML = '';
  destinationInput.value = '';
  selectedDestinationStop = null;
  window._selectedDestinationStop = null;
  window._tripOptions = [];
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLocationForTrip = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        updateUserLocation(pos.coords.latitude, pos.coords.longitude);
        showToast('📍 Location detected! Enter your destination.', 'success');
      },
      err => {
        showToast('Could not get location. Enter starting stop manually.', 'warning');
        userLocationForTrip = null;
      }
    );
  }
}

function startDestinationMapPicker() {
  destinationSelectionMode = true;
  planTripModal.classList.add('hidden');
  showToast('📍 Tap on the map to select your destination.', 'info');
  const mapInstance = getMap();
  if (!mapInstance) return;
  destinationSelectionCallback = function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const nearest = findNearestStopFromCoords(lat, lng);
    if (nearest) {
      selectedDestinationStop = nearest;
      window._selectedDestinationStop = nearest;
      destinationInput.value = nearest.name;
      destinationSelectionMode = false;
      mapInstance.off('click', destinationSelectionCallback);
      destinationSelectionCallback = null;
      planTripModal.classList.remove('hidden');
      showToast(`✅ Selected: ${nearest.name}`, 'success');
      setTimeout(planTrip, 300);
    } else {
      showToast('No stop found near that location. Try again.', 'warning');
    }
  };
  mapInstance.on('click', destinationSelectionCallback);
}

function findNearestStopFromCoords(lat, lng) {
  const stopMap = buildStopGraph();
  const allStops = Array.from(stopMap.values());
  let minDist = Infinity;
  let nearest = null;
  allStops.forEach(stop => {
    const d = haversineDistance(lat, lng, stop.lat, stop.lng);
    if (d < minDist) { minDist = d; nearest = stop; }
  });
  return nearest;
}

async function planTrip() {
  const destInput = destinationInput.value.trim();
  let destStop = selectedDestinationStop || window._selectedDestinationStop;

  if (!destStop) {
    if (!destInput) {
      showToast('Please enter a destination or tap the map.', 'warning');
      return;
    }
    const stopMap = buildStopGraph();
    const allStops = Array.from(stopMap.values());
    const matchedStops = allStops.filter(s => s.name.toLowerCase().includes(destInput.toLowerCase()));
    if (matchedStops.length === 0) {
      tripResults.innerHTML = `<p style="color:red;">❌ No stops found matching "${destInput}".</p>`;
      return;
    }
    destStop = matchedStops[0];
  }

  if (!destStop) {
    tripResults.innerHTML = `<p style="color:red;">❌ Could not determine destination.</p>`;
    return;
  }

  const stopMap = buildStopGraph();
  const allStops = Array.from(stopMap.values());
  let userStop = null;
  let userLocation = userLocationForTrip;

  if (userLocation) {
    let minDist = Infinity;
    allStops.forEach(stop => {
      const d = haversineDistance(userLocation.lat, userLocation.lng, stop.lat, stop.lng);
      if (d < minDist) { minDist = d; userStop = stop; }
    });
  } else {
    tripResults.innerHTML = `
      <p style="color:orange;">⚠️ Select your current stop:</p>
      <div style="max-height:150px;overflow-y:auto;margin-top:5px;">
        ${allStops.slice(0, 20).map(s => 
          `<div class="stop-select-item" data-lat="${s.lat}" data-lng="${s.lng}" data-name="${s.name}" style="padding:6px;border-bottom:1px solid #eee;cursor:pointer;">${s.name}</div>`
        ).join('')}
      </div>
    `;
    tripResults.querySelectorAll('.stop-select-item').forEach(el => {
      el.addEventListener('click', function() {
        const lat = parseFloat(this.dataset.lat);
        const lng = parseFloat(this.dataset.lng);
        const stop = allStops.find(s => s.lat === lat && s.lng === lng);
        if (stop) {
          userStop = stop;
          userLocation = { lat, lng };
          executeSmartRoute(userStop, destStop, userLocation);
        }
      });
    });
    return;
  }

  if (!userStop) {
    tripResults.innerHTML = `<p style="color:red;">❌ Could not detect your location. Please select manually.</p>`;
    return;
  }

  executeSmartRoute(userStop, destStop, userLocation);
}

function executeSmartRoute(fromStop, toStop, userLocation) {
  const startKey = `${fromStop.lat},${fromStop.lng}`;
  const endKey = `${toStop.lat},${toStop.lng}`;
  const destLocation = { lat: toStop.lat, lng: toStop.lng };

  const { adj, stopMap } = buildGraph(routeData);

  const resTime = runDijkstra(adj, startKey, endKey, (e) => e.timeWeight);
  const resTransfers = runDijkstra(adj, startKey, endKey, (e) => e.type === 'bus' ? 1 : 0.001);
  const resWalk = runDijkstra(adj, startKey, endKey, (e) => e.type === 'walk' ? e.walkDist : 0.001);
  const resBalanced = runDijkstra(adj, startKey, endKey, (e) => {
    const walkPenalty = (e.walkDist || 0) * 2;
    const transferPenalty = e.type === 'bus' ? 0.5 : 0;
    return e.timeWeight + walkPenalty + transferPenalty;
  });

  const opt1 = reconstructResult(resTime, startKey, endKey, stopMap);
  const opt2 = reconstructResult(resTransfers, startKey, endKey, stopMap);
  const opt3 = reconstructResult(resWalk, startKey, endKey, stopMap);
  const opt4 = reconstructResult(resBalanced, startKey, endKey, stopMap);

  const options = [];
  const seen = new Set();
  [opt1, opt2, opt3, opt4].forEach(opt => {
    if (!opt) return;
    const key = opt.path.map(e => `${e.type}_${e.fromStop.lat}_${e.toStop.lat}`).join('|');
    if (!seen.has(key)) { seen.add(key); options.push(opt); }
  });

  if (options.length === 0) {
    const dist = haversineDistance(fromStop.lat, fromStop.lng, toStop.lat, toStop.lng);
    if (dist < 3) {
      const walkTime = (dist / WALK_SPEED_KMH) * 60;
      tripResults.innerHTML = `
        <div style="background:#fff3cd;padding:10px;border-radius:8px;">
          <p>🚶 No bus route, but walking is possible.</p>
          <p><strong>Distance:</strong> ${Math.round(dist*1000)}m</p>
          <p><strong>Time:</strong> ~${Math.round(walkTime)} min</p>
          <button class="btn btn-primary" onclick="drawTripOnMap([{type:'walk', fromStop:{lat:${fromStop.lat},lng:${fromStop.lng}}, toStop:{lat:${toStop.lat},lng:${toStop.lng}}}], {lat:${fromStop.lat}, lng:${fromStop.lng}}, {lat:${toStop.lat}, lng:${toStop.lng}}); planTripModal.classList.add('hidden');">
            Show on map
          </button>
        </div>
      `;
      window.drawTripOnMap = drawTripOnMap;
      return;
    }
    tripResults.innerHTML = `<p style="color:red;">❌ No route found from ${fromStop.name} to ${toStop.name}.</p>`;
    return;
  }

  window._tripOptions = options.map(opt => ({
    path: opt.path,
    userLocation: userLocation,
    destLocation: destLocation
  }));

  let html = `<div style="margin-bottom:10px;font-weight:bold;font-size:0.95rem;">✅ ${options.length} route(s) found. Choose one:</div>`;
  html += `<div style="display:flex;flex-direction:column;gap:12px;max-height:350px;overflow-y:auto;">`;

  const labels = ['⚡ Fastest (Time)', '🔄 Fewest Buses', '🚶 Least Walking', '⚖️ Balanced'];
  const colors = ['#2196F3', '#FF9800', '#4CAF50', '#9C27B0'];

  options.forEach((opt, idx) => {
    const instructions = generateTripInstructions(opt.path, userLocation, destLocation);
    const totalWalk = opt.totalWalkDist;
    const totalTime = opt.totalTime;
    const busCount = opt.busCount;

    let stepsHtml = instructions.map(step => 
      `<div style="font-size:0.8rem;padding:2px 0;border-bottom:1px solid #f0f0f0;">${step.instruction}</div>`
    ).join('');

    html += `
      <div style="background:#f8f9fa;border-radius:10px;padding:12px;border-left:4px solid ${colors[idx]};">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;">
          <strong style="font-size:0.95rem;">${labels[idx]}</strong>
          <div style="display:flex;gap:12px;font-size:0.75rem;color:#555;">
            <span>⏱️ ${totalTime} min</span>
            <span>🚶 ${totalWalk}m</span>
            <span>🚌 ${busCount} bus(es)</span>
          </div>
        </div>
        <div style="margin-top:6px;max-height:80px;overflow-y:auto;background:white;padding:6px;border-radius:6px;border:1px solid #eee;">
          ${stepsHtml}
        </div>
        <button class="btn btn-primary" style="width:auto;padding:4px 12px;font-size:0.75rem;margin-top:8px;" onclick="window.selectTripOption(${idx}); planTripModal.classList.add('hidden');">
          <i class="fas fa-map"></i> Show on map
        </button>
      </div>
    `;
  });

  html += `</div>`;
  tripResults.innerHTML = html;

  window.selectTripOption = function(idx) {
    const option = window._tripOptions[idx];
    if (option) {
      drawTripOnMap(option.path, option.userLocation, option.destLocation);
    } else {
      showToast('Route data not found.', 'error');
    }
  };
  window.drawTripOnMap = drawTripOnMap;
}

// ============ CONSOLE VIEWER ============
function addConsoleViewer() {
  const panel = document.createElement('div');
  panel.id = 'consolePanel';
  panel.style.cssText = `
    position: fixed;
    bottom: 60px;
    right: 10px;
    width: 90%;
    max-width: 400px;
    max-height: 200px;
    background: rgba(0,0,0,0.9);
    color: #0f0;
    font-size: 11px;
    font-family: monospace;
    padding: 8px;
    border-radius: 8px;
    overflow-y: auto;
    z-index: 999999;
    display: none;
    pointer-events: auto;
    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  `;
  document.body.appendChild(panel);

  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = '🐞';
  toggleBtn.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    z-index: 999999;
    background: #0d2b45;
    color: white;
    border: none;
    border-radius: 50%;
    width: 44px;
    height: 44px;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    pointer-events: auto;
  `;
  document.body.appendChild(toggleBtn);

  let logs = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = function(...args) {
    logs.push({ level: 'log', msg: args.join(' ') });
    if (logs.length > 50) logs.shift();
    updatePanel();
    originalLog.apply(console, args);
  };
  console.warn = function(...args) {
    logs.push({ level: 'warn', msg: args.join(' ') });
    if (logs.length > 50) logs.shift();
    updatePanel();
    originalWarn.apply(console, args);
  };
  console.error = function(...args) {
    logs.push({ level: 'error', msg: args.join(' ') });
    if (logs.length > 50) logs.shift();
    updatePanel();
    originalError.apply(console, args);
  };

  function updatePanel() {
    const content = logs.map(log => {
      const color = log.level === 'warn' ? '#ffa500' : log.level === 'error' ? '#ff4444' : '#0f0';
      return `<div style="color:${color};">${log.msg}</div>`;
    }).join('');
    panel.innerHTML = content;
    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    clear.style.cssText = `
      position: sticky;
      top: 0;
      float: right;
      background: #e74c3c;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 2px 8px;
      font-size: 10px;
      cursor: pointer;
      z-index: 1;
    `;
    clear.onclick = function() { logs = []; updatePanel(); };
    panel.prepend(clear);
  }

  let visible = false;
  toggleBtn.onclick = function() {
    visible = !visible;
    panel.style.display = visible ? 'block' : 'none';
    if (visible) updatePanel();
  };
}

// ============ GLOBAL ERROR HANDLER ============
window.addEventListener('error', function(e) {
  console.error('Global error:', e);
  try {
    if (crashlytics) {
      crashlytics.recordException(e.error || e.message);
    }
    firebase.database().ref('errors').push({
      message: e.message,
      stack: e.stack,
      url: window.location.href,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      userId: currentUser ? currentUser.uid : 'anonymous'
    });
  } catch (err) { /* ignore */ }
});

// ============ INIT ============
async function init() {
  console.log(`🚌 Tunis Bus Live v14.1 – Official Release`);
  
  initPWA();
  loadLanguage();
  initAuth();
  
  if (performance) {
    performance.dataCollectionEnabled = true;
    performance.instrumentationEnabled = true;
    console.log('✅ Performance Monitoring enabled');
  }
  if (crashlytics) {
    console.log('✅ Crashlytics enabled');
  }

  if (langSwitcher) langSwitcher.addEventListener('change', function() { setLanguage(this.value); });
  if (adminToggle) adminToggle.addEventListener('click', openAdmin);
  if (closeAdmin) closeAdmin.addEventListener('click', closeAdminPanel);
  if (feedbackBtn) feedbackBtn.addEventListener('click', openFeedback);
  if (closeFeedback) closeFeedback.addEventListener('click', closeFeedbackModal);
  if (submitFeedback) submitFeedback.addEventListener('click', submitFeedbackHandler);
  document.querySelectorAll('.rating-star').forEach(el => {
    el.addEventListener('click', function() {
      selectedRating = parseInt(this.dataset.rating);
      document.querySelectorAll('.rating-star').forEach(s => s.classList.remove('active'));
      this.classList.add('active');
    });
  });
  feedbackModal.addEventListener('click', function(e) { if (e.target === this) closeFeedbackModal(); });
  if (closeFullscreenBtn) closeFullscreenBtn.addEventListener('click', closeFullscreenBus);

  if (nearbyBtn) nearbyBtn.addEventListener('click', findNearbyStops);
  if (closeNearby) closeNearby.addEventListener('click', function() { nearbyModal.classList.add('hidden'); });
  if (nearbyModal) nearbyModal.addEventListener('click', function(e) { if (e.target === this) this.classList.add('hidden'); });

  if (planTripBtn) planTripBtn.addEventListener('click', openPlanTrip);
  if (searchTripBtn) searchTripBtn.addEventListener('click', planTrip);
  if (destinationInput) destinationInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') planTrip(); });
  if (pickDestinationMap) pickDestinationMap.addEventListener('click', startDestinationMapPicker);
  if (closePlanTrip) closePlanTrip.addEventListener('click', function() {
    planTripModal.classList.add('hidden');
    if (destinationSelectionMode) {
      destinationSelectionMode = false;
      const mapInstance = getMap();
      if (mapInstance && destinationSelectionCallback) {
        mapInstance.off('click', destinationSelectionCallback);
        destinationSelectionCallback = null;
      }
    }
  });
  if (planTripModal) planTripModal.addEventListener('click', function(e) { if (e.target === this) this.classList.add('hidden'); });

  if (loginBtn) loginBtn.addEventListener('click', function() {
    const email = loginEmail.value.trim();
    const password = loginPassword.value.trim();
    if (email && password) loginUser(email, password);
    else showToast('Please enter email and password', 'warning');
  });
  if (loginCancel) loginCancel.addEventListener('click', function() {
    loginModal.classList.add('hidden');
  });
  if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);
  if (loginModal) loginModal.addEventListener('click', function(e) { if (e.target === this) this.classList.add('hidden'); });

  if (addRouteBtn) addRouteBtn.addEventListener('click', function() { openRouteMgmtForm(null); });
  if (closeRouteMgmt) closeRouteMgmt.addEventListener('click', function() { routeManagementModal.classList.add('hidden'); });
  if (routeMgmtSubmit) routeMgmtSubmit.addEventListener('click', saveRouteFromForm);
  if (routeManagementModal) routeManagementModal.addEventListener('click', function(e) { if (e.target === this) this.classList.add('hidden'); });

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
    processPendingWrites();
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
      pos => {
        autoDetectRoute(pos.coords.latitude, pos.coords.longitude);
        updateUserLocation(pos.coords.latitude, pos.coords.longitude);
      },
      () => {},
      { timeout: 5000, enableHighAccuracy: false }
    );
  }

  await initWriteQueue();
  if (isOnline()) processPendingWrites();

  addConsoleViewer();
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
  routeSelect.innerHTML = '<option value="">-- Choose --</option>';
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
    if (!currentUser) {
      loginModal.classList.remove('hidden');
      return;
    }
    driverView.classList.add('active');
    passengerView.classList.remove('active');
    tabDriver.classList.add('active');
    tabPassenger.classList.remove('active');
    if (isListening) { firebase.database().ref('activeBuses').off(); isListening = false; }
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
  if (!currentUser) {
    showToast('Please login to start a trip', 'warning');
    loginModal.classList.remove('hidden');
    return;
  }
  if (isTripActive) { showToast('Trip already active', 'warning'); return; }
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
    } catch (e) {}
  }
  const driver = driverNameInput.value.trim() || currentUser.displayName || currentUser.email || 'Anonymous';
  currentTripId = `${routeId}_${Date.now()}`;
  const tripData = {
    routeId, direction, driverName: driver,
    driverUid: currentUser.uid,
    startedAt: firebase.database.ServerValue.TIMESTAMP,
    lastUpdate: firebase.database.ServerValue.TIMESTAMP,
    lat: null, lng: null
  };
  try {
    await secureWrite(`activeBuses/${currentTripId}`, tripData, 'set');
  } catch (e) {
    console.error('Firebase error:', e);
    showToast('Could not start trip. Check connection.', 'error');
    return;
  }
  isTripActive = true;
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
        secureWrite(`activeBuses/${currentTripId}`, {
          lat: location.latitude, lng: location.longitude,
          accuracy: location.accuracy, speed: driverSpeed,
          heading: location.heading || 0,
          lastUpdate: firebase.database.ServerValue.TIMESTAMP
        }, 'update');
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
      secureWrite(`activeBuses/${currentTripId}`, {
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy, speed: driverSpeed,
        heading: pos.coords.heading || 0,
        lastUpdate: firebase.database.ServerValue.TIMESTAMP
      }, 'update');
      driverStatus.innerHTML = `<i class="fas fa-broadcast-tower"></i> Sharing (acc: ${Math.round(pos.coords.accuracy)}m)`;
    },
    err => { driverStatus.textContent = '⚠️ Location error: ' + err.message; },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
  );
}

function stopTrip() {
  if (isNative && bgWatcherId) {
    try {
      import('@capacitor-community/background-geolocation').then(module => {
        module.BackgroundGeolocation.removeWatcher({ id: bgWatcherId });
      }).catch(() => {});
    } catch (e) {}
    bgWatcherId = null;
  }
  if (watchId) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (currentTripId) {
    secureWrite(`activeBuses/${currentTripId}`, null, 'remove');
    saveTrip({ id: currentTripId, endedAt: Date.now() });
    currentTripId = null;
  }
  isTripActive = false;
  if (autoEndTimer) { clearInterval(autoEndTimer); autoEndTimer = null; }
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

function autoDetectRoute(lat, lng) {
  let best = null, bestDist = Infinity, bestDir = 'forward';
  routeData.forEach(route => {
    route.stops.forEach((stop, idx) => {
      const d = haversineDistance(lat, lng, stop.lat, stop.lng);
      if (d < bestDist) { bestDist = d; best = route; bestDir = (idx < route.stops.length / 2) ? 'forward' : 'backward'; }
    });
  });
  if (bestDist > 0.5) return null;
  return { route: best, direction: bestDir };
}

function isNearRoute(route, lat, lng) {
  return route.stops.some(s => haversineDistance(lat, lng, s.lat, s.lng) <= 0.5);
}

// ============ PASSENGER UI ============
function setupPassengerUI() {
  btnCloseDetail.addEventListener('click', () => routeDetailPanel.classList.add('hidden'));
}

// ============ FAVORITES ============
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
  if (btnCloseHistory) btnCloseHistory.addEventListener('click', () => historyPanel.classList.add('hidden'));
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
  if (q.length < 1) { searchResults.classList.add('hidden'); return; }
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
        openFullscreenBus(routeId, null);
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
    <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;">
      <button class="btn btn-primary" style="width:auto;padding:8px 16px;" onclick="window.showOnMap('${routeId}')">
        <i class="fas fa-map"></i> Show on map
      </button>
      <button class="btn btn-secondary" style="width:auto;padding:8px 16px;background:${isFav ? '#f5a623' : '#e0e0e0'};color:${isFav ? '#0d2b45' : '#333'};" onclick="window.toggleFavoriteRoute('${routeId}')">
        <i class="fas fa-star"></i>
      </button>
      <button class="btn btn-secondary" style="width:auto;padding:8px 16px;" onclick="window.openFullscreenBus('${routeId}', null)">
        <i class="fas fa-expand"></i> Full route
      </button>
    </div>
  `;
  routeDetailPanel.classList.remove('hidden');
  window.showOnMap = (id) => { showRoute(id, routeData); updateFavoriteButton(); };
  window.toggleFavoriteRoute = async (id) => {
    await toggleFavorite(id);
    favorites = await getFavorites();
    updateFavoriteButton();
    showRouteDetail(id);
  };
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

// ============ FULL SCREEN BUS VIEW ============
function openFullscreenBus(routeId, bus) {
  const route = routeData.find(r => r.id === routeId);
  if (!route) return;
  fsBusTitle.textContent = `Bus ${routeId}`;
  const directionText = bus && bus.direction === 'forward' ? 'Aller ↑' : (bus && bus.direction === 'backward' ? 'Retour ↓' : '—');
  fsBusRoute.textContent = `${route.name} – ${directionText}`;
  fsBusDriver.textContent = `Driver: ${bus && bus.driverName || 'Unknown'}`;
  fullscreenOverlay.classList.remove('hidden');
  fullscreenBusActive = true;
  const mapElement = document.getElementById('map');
  const originalParent = mapElement.parentNode;
  fullscreenMapContainer.appendChild(mapElement);
  mapElement._originalParent = originalParent;
  const mapInstance = getMap();
  if (mapInstance) {
    setTimeout(() => {
      mapInstance.invalidateSize();
      focusOnBus(routeId, bus, routeData);
    }, 100);
  }
  const allerSet = new Set(route.aller.map(s => `${s.lat},${s.lng}`));
  const retourSet = new Set(route.retour.map(s => `${s.lat},${s.lng}`));
  const busPos = bus ? { lat: bus.lat, lng: bus.lng } : null;
  let html = '';
  route.stops.forEach((stop, idx) => {
    const key = `${stop.lat},${stop.lng}`;
    let dir = '';
    if (allerSet.has(key) && retourSet.has(key)) dir = '↕';
    else if (allerSet.has(key)) dir = '↑';
    else if (retourSet.has(key)) dir = '↓';
    let eta = '', isBusHere = false;
    if (busPos) {
      const dist = haversineDistance(busPos.lat, busPos.lng, stop.lat, stop.lng);
      if (dist < 0.5) { eta = '📍 Bus here'; isBusHere = true; } else if (bus.speed && bus.speed > 0.5) {
        const timeSec = (dist / bus.speed) * 3600;
        if (timeSec < 60) eta = '~' + Math.round(timeSec) + 's';
        else if (timeSec < 3600) eta = '~' + Math.round(timeSec / 60) + 'm';
        else eta = '>1h';
      }
    }
    html += `<div class="fs-stop-item ${isBusHere ? 'bus-here' : ''}">
      <span class="fs-stop-index">#${idx+1}</span>
      <span class="fs-stop-name">${stop.name}</span>
      ${dir ? `<span style="font-size:0.7rem;color:#666;">${dir}</span>` : ''}
      ${eta ? `<span class="fs-stop-eta">${eta}</span>` : ''}
      ${isBusHere ? `<span class="fs-stop-bus-here">🚌</span>` : ''}
    </div>`;
  });
  fsBusStops.innerHTML = html;
}

function closeFullscreenBus() {
  fullscreenOverlay.classList.add('hidden');
  fullscreenBusActive = false;
  const mapElement = document.getElementById('map');
  if (mapElement._originalParent) {
    mapElement._originalParent.appendChild(mapElement);
    const mapInstance = getMap();
    if (mapInstance) setTimeout(() => mapInstance.invalidateSize(), 50);
  }
  updateBusUI();
}

window.openFullscreenBus = openFullscreenBus;
window.closeFullscreenBus = closeFullscreenBus;
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
        secureWrite(`activeBuses/${key}`, null, 'remove');
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
    const route = routeData.find(r => r.id === bus.routeId);
    if (route && (!bus.direction || bus.direction === 'unknown')) {
      const firstStop = route.stops[0];
      const lastStop = route.stops[route.stops.length - 1];
      if (firstStop && lastStop) {
        const distToFirst = haversineDistance(bus.lat, bus.lng, firstStop.lat, firstStop.lng);
        const distToLast = haversineDistance(bus.lat, bus.lng, lastStop.lat, lastStop.lng);
        const detectedDir = distToFirst < distToLast ? 'forward' : 'backward';
        if (bus.direction !== detectedDir) {
          bus.direction = detectedDir;
          secureWrite(`activeBuses/${bus.tripId}/direction`, detectedDir, 'update');
        }
      }
    }
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
      if (route) { selectedRouteId = bus.routeId; openFullscreenBus(bus.routeId, bus); }
    });
    li.querySelector('.report-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const tripId = e.target.dataset.trip;
      await secureWrite(`activeBuses/${tripId}`, {
        lastUpdate: firebase.database.ServerValue.TIMESTAMP,
        reportedBy: currentUser ? currentUser.uid : 'passenger'
      }, 'update');
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
    style.textContent =
      `@keyframes fadeInUp { from { opacity:0; transform:translateX(-50%) translateY(20px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }`;
    document.head.appendChild(style);
  }
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

window.showToast = showToast;

// ============ START ============
document.addEventListener('DOMContentLoaded', init);
