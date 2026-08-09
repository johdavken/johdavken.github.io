"use strict";

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type:"window", includeUncontrolled:true }).then(clients=>{
      const existing = clients[0];
      if (existing){
        existing.focus();
        return;
      }
      return self.clients.openWindow("./");
    })
  );
});
