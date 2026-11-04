'use strict';
const CACHE='bashkar-waiter-shell-v26',SHELL=['/waiter/','/waiter/style.css','/waiter/bg.jpeg','/waiter/draft-store.js','/waiter/app.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener('fetch',e=>{const url=new URL(e.request.url);if(e.request.method!=='GET'||url.origin!==self.location.origin||!SHELL.includes(url.pathname))return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));});
