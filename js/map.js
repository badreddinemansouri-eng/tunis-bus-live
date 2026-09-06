// ============ MAP.JS – SMART & SMOOTH ============

import { getRoutes } from './db.js';

let map = null;
let routeLayer = null;
let busMarkers = {};
let routeData = [];
let activeBuses = {};
let animationFrame = null;
let lastUpdateTime = {};

export function initMap(containerId, center = [36.8065, 10.1815], zoom = 12) {
  if (map) return map;
  map = L.map(containerId, { zoomControl: true }).setView(center, zoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
  L.control.scale({ metric: true, imperial: false }).addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  addLegend();
  // Start animation loop for smooth movement
  if (!animationFrame) {
    animationFrame = requestAnimationFrame(smoothMove);
  }
  return map;
}

function addLegend() {
  const Legend = L.Control.extend({
    onAdd: function() {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <strong>Legend</strong>
        <div><span style="color:#2196F3;">●</span> Aller</div>
        <div><span style="color:#FF9800;">●</span> Retour</div>
        <div><span style="color:#4CAF50;">●</span> Active Bus</div>
        <div><span style="font-size:0.7rem;">⬤</span> Stop</div>
      `;
      return div;
    }
  });
  map.addControl(new Legend({ position: 'bottomleft' }));
}

export function clearMap() {
  if (routeLayer) routeLayer.clearLayers();
  for (let key in busMarkers) {
    if (busMarkers[key]) map.removeLayer(busMarkers[key]);
  }
  busMarkers = {};
  activeBuses = {};
}

export function showRoute(routeId, routes) {
  const route = routes.find(r => r.id === routeId);
  if (!route) return;
  if (!routeLayer) return;
  routeLayer.clearLayers();

  // Aller (blue)
  if (route.aller && route.aller.length > 1) {
    const coords = route.aller.map(s => [s.lat, s.lng]);
    L.polyline(coords, { color: '#2196F3', weight: 5, opacity: 0.9 }).addTo(routeLayer);
  }
  // Retour (orange, dashed)
  if (route.retour && route.retour.length > 1) {
    const coords = route.retour.map(s => [s.lat, s.lng]);
    L.polyline(coords, { color: '#FF9800', weight: 5, opacity: 0.9, dashArray: '8, 6' }).addTo(routeLayer);
  }

  // Stops
  const stopSet = new Map();
  route.stops.forEach(stop => {
    const key = `${stop.lat},${stop.lng}`;
    if (!stopSet.has(key)) {
      const marker = L.circleMarker([stop.lat, stop.lng], {
        radius: 5,
        color: '#3498db',
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 2
      }).addTo(routeLayer);
      const hasAller = route.aller.some(s => s.lat === stop.lat && s.lng === stop.lng);
      const hasRetour = route.retour.some(s => s.lat === stop.lat && s.lng === stop.lng);
      let dir = hasAller && hasRetour ? '↕' : hasAller ? '↑' : '↓';
      marker.bindPopup(`<b>${stop.name}</b> ${dir}`);
      stopSet.set(key, marker);
    }
  });

  const allCoords = route.stops.map(s => [s.lat, s.lng]);
  if (allCoords.length > 0) {
    const bounds = L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

export function updateBuses(buses, routes) {
  // buses is an object grouped by routeId (only the most recent per route)
  activeBuses = buses;
  const now = Date.now();

  // Remove markers for routes that no longer have a bus
  const activeRouteIds = Object.keys(buses);
  for (let key in busMarkers) {
    if (!activeRouteIds.includes(key)) {
      map.removeLayer(busMarkers[key]);
      delete busMarkers[key];
    }
  }

  activeRouteIds.forEach(routeId => {
    const bus = buses[routeId];
    if (!bus.lat || !bus.lng) return;
    const route = routes.find(r => r.id === routeId);
    if (!route) return;

    const isAller = bus.direction === 'forward';
    const color = isAller ? '#4CAF50' : '#FF6B6B';
    const dirArrow = isAller ? '↑' : '↓';

    // Store previous position and time for smoothing
    if (!lastUpdateTime[routeId]) {
      lastUpdateTime[routeId] = { lat: bus.lat, lng: bus.lng, time: now };
    } else {
      // Update only if new data is fresh
      if (bus.lastUpdate > lastUpdateTime[routeId].time) {
        lastUpdateTime[routeId] = { lat: bus.lat, lng: bus.lng, time: now };
      }
    }

    const icon = L.divIcon({
      className: 'bus-marker',
      html: `
        <div class="bus-icon" style="background:${color};color:#fff;">
          ${bus.routeId}
          <span style="font-size:10px;display:block;">${dirArrow}</span>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const popupContent = `
      <b>Bus ${bus.routeId}</b><br>
      ${route.name}<br>
      ${isAller ? '🟦 Aller' : '🟧 Retour'}<br>
      Driver: ${bus.driverName || 'Unknown'}<br>
      Updated: ${new Date(bus.lastUpdate).toLocaleTimeString()}<br>
      ${bus.speed ? `Speed: ${(bus.speed * 3.6).toFixed(1)} km/h` : ''}
    `;

    if (!busMarkers[routeId]) {
      busMarkers[routeId] = L.marker([bus.lat, bus.lng], { icon })
        .addTo(map)
        .bindPopup(popupContent);
    } else {
      // The marker exists; we'll update its position in the animation loop
      // Just store the target position
      busMarkers[routeId]._targetLat = bus.lat;
      busMarkers[routeId]._targetLng = bus.lng;
      // Update popup if needed
      busMarkers[routeId].setPopupContent(popupContent);
    }
  });
}

// Smooth movement animation loop
function smoothMove() {
  if (!map) { animationFrame = requestAnimationFrame(smoothMove); return; }
  const now = Date.now();

  for (let routeId in busMarkers) {
    const marker = busMarkers[routeId];
    if (!marker._targetLat || !marker._targetLng) continue;

    // Calculate current position by interpolating towards target
    const currentLat = marker.getLatLng().lat;
    const currentLng = marker.getLatLng().lng;
    const dLat = marker._targetLat - currentLat;
    const dLng = marker._targetLng - currentLng;

    // If far, snap; else smooth
    const dist = Math.sqrt(dLat*dLat + dLng*dLng);
    if (dist < 0.0001) {
      // Snap if very close
      marker.setLatLng([marker._targetLat, marker._targetLng]);
    } else {
      // Move towards target with a smoothing factor (0.15 per frame ~ 15% per frame)
      const factor = 0.15;
      const newLat = currentLat + dLat * factor;
      const newLng = currentLng + dLng * factor;
      marker.setLatLng([newLat, newLng]);
    }
  }

  animationFrame = requestAnimationFrame(smoothMove);
}

export function focusStop(lat, lng, name) {
  if (!map) return;
  map.setView([lat, lng], 16);
  const marker = L.marker([lat, lng]).addTo(map);
  marker.bindPopup(`<b>${name}</b>`).openPopup();
  setTimeout(() => map.removeLayer(marker), 5000);
}

export function getMap() { return map; }
