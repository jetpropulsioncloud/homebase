self.addEventListener('push', event => {
  let data = { title: 'HomeBase', body: 'You have a household update.', url: '/' };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icon.svg', badge: '/icon.svg',
    data: { url: data.url || '/' }, tag: data.tag || 'homebase-update'
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
