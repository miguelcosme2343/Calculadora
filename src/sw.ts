/// <reference lib="webworker" />
// Service worker: guarda la app para usarla sin conexión y recibe lo que se comparte con ella
// desde otras apps (menú «Compartir» de Android).
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
// ?compartido=1 y similares no deben impedir servir la página guardada
precacheAndRoute(self.__WB_MANIFEST, { ignoreURLParametersMatching: [/.*/] });

export const SHARE_CACHE = 'compartido';

// Android envía lo compartido como un POST a «compartir» (ver share_target en el manifest).
// Se guarda en una caché y se abre la app, que lo recoge al arrancar.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/compartir')) return;
  event.respondWith((async () => {
    const form = await event.request.formData();
    const cache = await caches.open(SHARE_CACHE);
    const file = form.get('image');
    if (file instanceof File && file.size > 0) {
      await cache.put('imagen', new Response(file, { headers: { 'content-type': file.type || 'image/png' } }));
    }
    const text = [form.get('text'), form.get('title')].find(v => typeof v === 'string' && v.trim());
    if (typeof text === 'string') await cache.put('texto', new Response(text));
    return Response.redirect(new URL('./?compartido=1', self.registration.scope).href, 303);
  })());
});
