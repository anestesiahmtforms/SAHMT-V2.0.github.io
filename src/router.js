const routes = new Set(['home', 'events', 'labels', 'management', 'checklist', 'training', 'notifications', 'occurrences', 'people', 'admin', 'offline']);

export function currentRoute() {
  const route = location.hash.replace(/^#\/?/, '').split('/')[0] || 'home';
  return routes.has(route) ? route : 'home';
}

export function navigate(route) {
  if (!routes.has(route)) return;
  location.hash = `#/${route}`;
}
