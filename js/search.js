import { getRoutes } from './db.js';

let searchIndex = [];
let searchResults = [];

export async function buildSearchIndex() {
  const routes = await getRoutes();
  searchIndex = [];
  routes.forEach(route => {
    searchIndex.push({
      type: 'route',
      id: route.id,
      name: route.name,
      searchText: `${route.id} ${route.name}`.toLowerCase()
    });
    route.stops.forEach(stop => {
      const key = `${stop.lat},${stop.lng}`;
      if (!searchIndex.find(s => s.key === key && s.type === 'stop')) {
        searchIndex.push({
          type: 'stop',
          key: key,
          name: stop.name,
          lat: stop.lat,
          lng: stop.lng,
          routeId: route.id,
          searchText: `${stop.name} ${route.id}`.toLowerCase()
        });
      }
    });
  });
  return searchIndex;
}

export function search(query, limit = 20) {
  if (!query || query.trim().length < 1) return [];
  const q = query.trim().toLowerCase();
  const results = [];
  const seen = new Set();

  searchIndex.forEach(item => {
    if (seen.has(item.id || item.key)) return;
    let score = 0;
    const text = item.searchText;
    if (text === q) score = 100;
    else if (text.startsWith(q)) score = 80;
    else if (text.includes(q)) score = 60;
    else if (q.split(' ').every(word => text.includes(word))) score = 40;
    if (score > 0) {
      results.push({ ...item, score });
      seen.add(item.id || item.key);
    }
  });

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export async function getRoute(routeId) {
  const routes = await getRoutes();
  return routes.find(r => r.id === routeId);
}

export function getSearchIndex() { return searchIndex; }
