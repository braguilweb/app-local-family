import "leaflet/dist/leaflet.css";
import "./style.css";

import { getRouteFromHash, onHashChange } from "./app/router";
import { renderHome } from "./screens/home";
import { renderRoom } from "./screens/room";
import { registerServiceWorker } from "./pwa/register-sw";
import { ensureSignedIn } from "./lib/firebase";

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

async function start(): Promise<void> {
  // Feedback rápido enquanto autentica
  appEl.innerHTML = `<main class="container"><p style="font-size:12px;">Carregando...</p></main>`;

  // Garante usuário anônimo (uid) antes de qualquer uso do RTDB
  await ensureSignedIn(); // usa signInAnonymously por baixo [page:0]

  render();
  onHashChange(() => render());
  registerServiceWorker();
}

void start().catch((err) => {
  console.error(err);
  appEl.innerHTML = `
    <main class="container">
      <h1>App Família</h1>
      <p style="font-size:12px;">
        Falha ao iniciar (veja o console). Verifique Firebase Auth (Anonymous habilitado) e .env.
      </p>
    </main>
  `;
});
