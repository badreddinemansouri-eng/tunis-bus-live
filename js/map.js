// ============================================================
// MAP.JS – PROFESSIONAL PERFORMANCE
// Uses marker clustering, canvas for routes, smooth updates
// ============================================================

// Note: Leaflet and MarkerCluster are loaded via CDN in index.html

let map = null;
let routeLayer = null;
let busMarkers = {};
let clusterGroup = null;
let routePolyline = null;
let animationFrame = null;
let lastUpdateTime = {};
let isMapReady = false;

export function initMap(containerId, center = [36.8065, 10.1815], zoom = 12) {
  if (map) return map;
  
  map = L.map(containerId, {
    zoomControl: true,
    fadeAnimation: true,
    zoomAnimation: true,
    markerZoomAnimation: true
  }).setView(center, zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap',
    maxZoom: 19,
    crossOrigin: true
  }).addTo(map);

  L.control.scale({ metric: true, imperial: false }).addTo(map);

  // Cluster group for stops
  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 30,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    zoomToBoundsOnClick: true
  });
  map.addLayer(clusterGroup);

  routeLayer = L.layerGroup().addTo(map);

  addLegend();

  isMapReady = true;
  animationFrame = requestAnimationFrame(smoothMove);

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
        <div><span style="color:#4CAF50;">●</span> Live Bus</div>
        <div><span style="color:#FFD700;">●</span> Estimated</div>
        <div><span style="font-size:0.7rem;">⬤</span> Stop</div>
      `;
      return div;
    }
  });
  map.addControl(new Legend({ position: 'bottomleft' }));
}

export function clearMap() {
  if (routeLayer) routeLayer.clearLayers();
  if (clusterGroup) clusterGroup.clearLayers();
  for (let key in busMarkers) {
    if (busMarkers[key]) map.removeLayer(busMarkers[key]);
  }
  busMarkers = {};
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
}

export function showRoute(routeId, routes) {
  const route = routes.find(r => r.id === routeId);
  if (!route) return;
  if (!routeLayer) return;
  routeLayer.clearLayers();
  if (clusterGroup) clusterGroup.clearLayers();

  // Draw Aller (blue)
  if (route.aller && route.aller.length > 1) {
    const coords = route.aller.map(s => [s.lat, s.lng]);
    const line = L.polyline(coords, {
      color: '#2196F3',
      weight: 5,
      opacity: 0.9,
      smoothFactor: 1
    }).addTo(routeLayer);
    line.bindPopup('🟦 Aller (outbound)');
    routePolyline = line;
  }

  // Draw Retour (orange dashed)
  if (route.retour && route.retour.length > 1) {
    const coords = route.retour.map(s => [s.lat, s.lng]);
    const line = L.polyline(coords, {
      color: '#FF9800',
      weight: 5,
      opacity: 0.9,
      dashArray: '8, 6',
      smoothFactor: 1
    }).addTo(routeLayer);
    line.bindPopup('🟧 Retour (inbound)');
  }

  // Add all stops to cluster
  const stopMarkers = [];
  route.stops.forEach(stop => {
    const hasAller = route.aller.some(s => s.lat === stop.lat && s.lng === stop.lng);
    const hasRetour = route.retour.some(s => s.lat === stop.lat && s.lng === stop.lng);
    let dir = hasAller && hasRetour ? '↕' : hasAller ? '↑' : '↓';
    const marker = L.circleMarker([stop.lat, stop.lng], {
      radius: 5,
      color: '#3498db',
      fillColor: '#fff',
      fillOpacity: 1,
      weight: 2
    });
    marker.bindPopup(`<b>${stop.name}</b> ${dir}`);
    stopMarkers.push(marker);
  });
  clusterGroup.addLayers(stopMarkers);

  // Fit bounds
  const allCoords = route.stops.map(s => [s.lat, s.lng]);
  if (allCoords.length > 0) {
    const bounds = L.latLngBounds(allCoords);
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

export function updateBuses(buses, routes) {
  const now = Date.now();
  const activeRouteIds = Object.keys(buses);

  // Remove markers for routes no longer present
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
    const isEstimated = bus.isEstimated || false;
    const color = isEstimated ? '#FFD700' : (isAller ? '#4CAF50' : '#FF6B6B');
    const dirArrow = isAller ? '↑' : '↓';
    const label = isEstimated ? `${bus.routeId}*` : bus.routeId;

    // Dead reckoning
    if (isEstimated && bus.speed && bus.speed > 0.5 && route) {
      const elapsedSeconds = (now - bus.lastUpdate) / 1000;
      const distance = bus.speed * elapsedSeconds;
      const stops = (bus.direction === 'forward') ? route.aller : route.retour;
      if (stops && stops.length > 0) {
        let nearestIdx = 0;
        let minDist = Infinity;
        stops.forEach((s, idx) => {
          const d = haversineDistance(bus.lat, bus.lng, s.lat, s.lng);
          if (d < minDist) {
            minDist = d;
            nearestIdx = idx;
          }
        });
        let accumulated = 0;
        let targetLat = bus.lat, targetLng = bus.lng;
        for (let i = nearestIdx; i < stops.length - 1; i++) {
          const segDist = haversineDistance(stops[i].lat, stops[i].lng, stops[i+1].lat, stops[i+1].lng);
          if (accumulated + segDist >= distance/1000) {
            const ratio = (distance/1000 - accumulated) / segDist;
            targetLat = stops[i].lat + (stops[i+1].lat - stops[i].lat) * ratio;
            targetLng = stops[i].lng + (stops[i+1].lng - stops[i].lng) * ratio;
            break;
          }
          accumulated += segDist;
        }
        bus._targetLat = targetLat;
        bus._targetLng = targetLng;
        bus.lat = targetLat;
        bus.lng = targetLng;
      }
    }

    // Store target for smooth animation
    if (!lastUpdateTime[routeId]) {
      lastUpdateTime[routeId] = { lat: bus.lat, lng: bus.lng, time: now };
    } else {
      if (bus.lastUpdate > lastUpdateTime[routeId].time) {
        lastUpdateTime[routeId] = { lat: bus.lat, lng: bus.lng, time: now };
      }
    }

    const icon = L.divIcon({
      className: 'bus-marker',
      html: `
        <div class="bus-icon" style="background:${color};color:#fff;">
          ${label}
          <span style="font-size:10px;display:block;">${dirArrow}</span>
        </div>
      `,
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    const isStale = (now - bus.lastUpdate > 120000);
    const statusText = isStale ? '⚠️ Stale – last seen ' + new Date(bus.lastUpdate).toLocaleTimeString() : '🟢 Live';
    const popupContent = `
      <b>Bus ${bus.routeId}</b>
      ${isEstimated ? '⚠️ Estimated position' : ''}<br>
      ${statusText}<br>
      ${route.name}<br>
      ${isAller ? '🟦 Aller' : '🟧 Retour'}<br>
      Driver: ${bus.driverName || 'Unknown'}<br>
      ${bus.speed ? `Speed: ${(bus.speed * 3.6).toFixed(1)} km/h` : ''}
      ${isStale ? '<br><button id="reportBtn" style="background:#f5a623;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;">📍 I see this bus</button>' : ''}
      <br><button id="fullRouteBtn" style="background:#3498db;border:none;border-radius:4px;padding:4px 12px;cursor:pointer;color:white;margin-top:4px;">🗺️ View Full Route</button>
    `;

    if (!busMarkers[routeId]) {
      busMarkers[routeId] = L.marker([bus.lat, bus.lng], { icon })
        .addTo(map)
        .bindPopup(popupContent);
    } else {
      busMarkers[routeId]._targetLat = bus.lat;
      busMarkers[routeId]._targetLng = bus.lng;
      busMarkers[routeId].setPopupContent(popupContent);
    }

    // Report button listener
    busMarkers[routeId].on('popupopen', function() {
      setTimeout(() => {
        const reportBtn = document.getElementById('reportBtn');
        if (reportBtn) {
          reportBtn.addEventListener('click', function() {
            firebase.database().ref(`activeBuses/${bus.tripId}`).update({
              lastUpdate: firebase.database.ServerValue.TIMESTAMP,
              reportedBy: 'passenger'
            });
            showToast('✅ Bus position confirmed!', 'success');
            busMarkers[routeId].closePopup();
          });
        }
        const fullRouteBtn = document.getElementById('fullRouteBtn');
        if (fullRouteBtn) {
          fullRouteBtn.addEventListener('click', function() {
            window.showFullRoute(routeId, bus);
            busMarkers[routeId].closePopup();
          });
        }
      }, 100);
    });
  });
}

// Smooth animation loop
function smoothMove() {
  if (!map) { animationFrame = requestAnimationFrame(smoothMove); return; }
  const now = Date.now();

  for (let routeId in busMarkers) {
    const marker = busMarkers[routeId];
    if (!marker._targetLat || !marker._targetLng) continue;

    const currentLat = marker.getLatLng().lat;
    const currentLng = marker.getLatLng().lng;
    const dLat = marker._targetLat - currentLat;
    const dLng = marker._targetLng - currentLng;

    const dist = Math.sqrt(dLat*dLat + dLng*dLng);
    if (dist < 0.0001) {
      marker.setLatLng([marker._targetLat, marker._targetLng]);
    } else {
      const factor = 0.2;
      const newLat = currentLat + dLat * factor;
      const newLng = currentLng + dLng * factor;
      marker.setLatLng([newLat, newLng]);
    }
  }

  animationFrame = requestAnimationFrame(smoothMove);
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
