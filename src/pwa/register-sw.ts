// src/pwa/registerSW.ts
export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
      // console.log("SW registrado");
    } catch (err) {
      console.error("Falha ao registrar SW", err);
    }
  });
}