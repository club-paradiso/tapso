self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = {}; }
  const title = payload.title || "TAPSO";
  const body = payload.body || "백그라운드 수집 상태가 업데이트되었습니다.";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: "tapso-background-acceptance",
    renotify: true,
    data: { url: payload.url || "./acceptance.html", verdict: payload.verdict },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./acceptance.html", self.registration.scope).href;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clientsList) {
      if ("focus" in client) {
        await client.navigate(url);
        return client.focus();
      }
    }
    return clients.openWindow(url);
  })());
});
