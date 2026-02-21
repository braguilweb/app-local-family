import "leaflet/dist/leaflet.css";
import "./style.css";

import { getRouteFromHash, onHashChange } from "./app/router";
import { renderHome } from "./screens/home";
import { renderRoom } from "./screens/room";
import { registerServiceWorker } from "./pwa/register-sw.ts";

function getRequiredEl<T extends Element>(selector: string): T {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Elemento obrigatório não encontrado: ${selector}`);
  return el as T;
}

const appEl = getRequiredEl<HTMLDivElement>("#app");

function render(): void {
  const route = getRouteFromHash();

  if (route.name === "home") {
    renderHome(appEl);
    return;
  }

  renderRoom(appEl, route.token, route.role);
}

render();
onHashChange(() => render());
registerServiceWorker();