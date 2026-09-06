import { getRoutes } from './db.js';

let map = null;
let routeLayer = null;
let busMarkers = {};
let routeData = [];
let activeBuses = {};
let etaCache = {};
let selectedRouteId = null;
let popupTimeout = null;

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
  return map;
}

function addLegend() {
  const Legend = L.Control.extend({
    onAdd: function() {
      const div = L.DomUtil.create('div', 'map-legend');
      div.innerHTML = `
        <strong>Legend</strong>
        <div><span style="color:#2196F3;">●</span> Aller (outbound)</div>
        <div><span style="color:#FF9800;">●</span> Retour (inbound)</div>
        <div><span style="color:#4CAF50;">●</span> Active Bus</div>
        <div><span style="font-size:0.7rem;">⬤</span> Stop</div>
        <div style="margin-top:4px;font-size:0.7rem;color:#666;">Tap a bus for details</div>
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
  etaCache = {};
}

export function showRoute(routeId, routes) {
  selectedRouteId = routeId;
  const route = routes.find(r => r.id === routeId);
  if (!route) return;
  if (!routeLayer) return;
  routeLayer.clearLayers();

  // Aller (blue)
  if (route.aller && route.aller.length > 1) {
    const coords = route.aller.map(s => [s.lat, s.lng]);
    const line = L.polyline(coords, {
      color: '#2196F3',
      weight: 5,
      opacity: 0.9,
      className: 'route-aller'
    }).addTo(routeLayer);
    line.bindPopup('🟦 Aller (outbound)');
  }

  // Retour (orange, dashed)
  if (route.retour && route.retour.length > 1) {
    const coords = route.retour.map(s => [s.lat, s.lng]);
    const line = L.polyline(coords, {
      color: '#FF9800',
      weight: 5,
      opacity: 0.9,
      dashArray: '8, 6',
      className: 'route-retour'
    }).addTo(routeLayer);
    line.bindPopup('🟧 Retour (inbound)');
  }

  // Stops with direction labels
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
      let dir = '';
      if (hasAller && hasRetour) dir = '↕';
      else if (hasAller) dir = '↑';
      else if (hasRetour) dir = '↓';
      marker.bindPopup(`<b>${stop.name}</b> ${dir}`);
      stopSet.set(key, marker);
    }
  });

  // Fit bounds
  const allCoords = route.stops.map(s => [s.lat, s.lng]);
  if (allCoords.length > 0) {
    const bounds = L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

export function updateBuses(buses, routes) {
  activeBuses = buses;
  const now = Date.now();

  // Remove old markers
  const activeKeys = Object.keys(buses);
  for (let key in busMarkers) {
    if (!activeKeys.includes(key)) {
      map.removeLayer(busMarkers[key]);
      delete busMarkers[key];
    }
  }

  activeKeys.forEach(key => {
    const bus = buses[key];
    if (!bus.lat || !bus.lng) return;
    const route = routes.find(r => r.id === bus.routeId);
    if (!route) return;

    const isAller = bus.direction === 'forward';
    const color = isAller ? '#4CAF50' : '#FF6B6B';
    const dirArrow = isAller ? '↑' : '↓';

    // Create custom icon with direction arrow
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

    if (busMarkers[key]) {
      busMarkers[key].setLatLng([bus.lat, bus.lng]);
      busMarkers[key].setPopupContent(popupContent);
    } else {
      busMarkers[key] = L.marker([bus.lat, bus.lng], { icon })
        .addTo(map)
        .bindPopup(popupContent);
    }

    // ETA calculation (if we have route data)
    if (route.stops && route.stops.length > 0) {
      const nearestStop = findNearestStop(bus.lat, bus.lng, route.stops);
      if (nearestStop) {
        const stopIndex = route.stops.indexOf(nearestStop);
        if (stopIndex !== -1 && stopIndex < route.stops.length - 2) {
          const nextStops = route.stops.slice(stopIndex + 1, stopIndex + 4);
          const eta = now + (nextStops.length * 60 * 1000); // rough: 1 min per stop
          const etaTime = new Date(eta);
          // Cache ETA
          etaCache[key] = etaTime;
          // Update popup with ETA
          const etaText = etaTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          if (busMarkers[key]) {
            const currentPopup = busMarkers[key].getPopup().getContent();
            if (!currentPopup.includes('ETA')) {
              busMarkers[key].setPopupContent(
                popupContent + `<br>⏱ ETA to next stop: ~${etaText}`
              );
            }
          }
        }
      }
    }
  });
}

function findNearestStop(lat, lng, stops) {
  let minDist = Infinity;
  let nearest = null;
  stops.forEach(stop => {
    const d = haversineDistance(lat, lng, stop.lat, stop.lng);
    if (d < minDist) {
      minDist = d;
      nearest = stop;
    }
  });
  return (minDist < 0.5) ? nearest : null;
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

export function focusStop(lat, lng, name) {
  if (!map) return;
  map.setView([lat, lng], 16);
  const marker = L.marker([lat, lng]).addTo(map);
  marker.bindPopup(`<b>${name}</b>`).openPopup();
  setTimeout(() => map.removeLayer(marker), 5000);
}

export function getMap() { return map; }
