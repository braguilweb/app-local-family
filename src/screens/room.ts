import {
  endAt,
  get,
  limitToLast,
  onChildAdded,
  onChildRemoved,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  remove,
  set,
  update,
} from "firebase/database";
import L, { type Map as LeafletMap, type Marker as LeafletMarker } from "leaflet";

import { navigateToHome } from "../app/router";
import type { Role } from "../app/router";
import { db } from "../lib/firebase";
import { watchPosition, type StopWatching } from "../lib/geolocation";
import { setupLeafletDefaultIcon } from "../lib/leaflet";

type LocationCurrent = {
  lat: number;
  lng: number;
  accuracy: number;
  ts: number;
};

/**
 * Chat efêmero:
 * - guardamos mensagens em lista: rooms/{token}/chat/messages/{pushId}
 * - UI mostra só as últimas 5
 * - cada msg tem expiresAt (TTL)
 * - limpeza é "best effort" no cliente (sem backend)
 */
type ChatMessage = {
  from: "parent" | "child";
  text: string;
  ts: number;
  expiresAt: number;
};

export function renderRoom(container: HTMLElement, token: string, role?: Role): void {
  const childLink = `${window.location.origin}/#room=${encodeURIComponent(token)}&role=child`;
  const parentLink = `${window.location.origin}/#room=${encodeURIComponent(token)}&role=parent`;

  const showMap = role === "parent";
  const showParentStop = role === "parent";

  container.innerHTML = `
    <main class="container">
      <header style="display:flex; gap:12px; align-items:center;">
        <button id="btn-back" type="button">Voltar</button>
        <h1 style="margin:0;">Sala</h1>
      </header>

      <section class="card" style="margin-top:12px;">
        <h2>Pareamento</h2>
        <p style="margin: 0 0 8px;">
          <strong>Token:</strong>
          <code style="word-break: break-all;">${escapeHtml(token)}</code>
        </p>

        <p style="margin: 0 0 8px;">
          <strong>Link Criança:</strong>
          <a href="${childLink}" target="_blank" rel="noreferrer">${childLink}</a>
        </p>
        <p style="margin: 0;">
          <strong>Link Responsável:</strong>
          <a href="${parentLink}" target="_blank" rel="noreferrer">${parentLink}</a>
        </p>
      </section>

      <section class="card" style="margin-top:12px;">
        <h2>Localização</h2>
        <p><strong>Role:</strong> <span id="role-label">${role ?? "(não definido)"}</span></p>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btn-start" type="button">Iniciar compartilhamento (Criança)</button>
          <button id="btn-stop" type="button" disabled>Parar (local)</button>

          ${
            showParentStop
              ? `<button id="btn-parent-stop" type="button">Parar compartilhamento (Responsável)</button>`
              : ""
          }
        </div>

        <p id="loc-status" style="margin: 8px 0 0; font-size: 12px;"></p>
      </section>

      <section class="card" style="margin-top:12px;">
        <h2>Chat (efêmero)</h2>

        <ul id="chat-list" style="margin:0 0 8px; padding-left:16px; font-size:12px;"></ul>

        <form id="chat-form" style="display:flex; gap:8px;">
          <input
            id="chat-input"
            type="text"
            maxlength="280"
            placeholder="Digite uma mensagem..."
            style="flex:1;"
            autocomplete="off"
          />
          <button type="submit">Enviar</button>
        </form>
      </section>

      ${
        showMap
          ? `
      <section class="card" style="margin-top:12px;">
        <h2>Mapa (Responsável)</h2>
        <div id="map"></div>
        <p id="map-status" style="margin: 8px 0 0; font-size: 12px;"></p>
      </section>
      `
          : ""
      }
    </main>
  `;

  /**
   * Helper: querySelector que nunca retorna null.
   * Isso evita os erros TS18047 ("possibly null") no build.
   */
  function qs<T extends Element>(selector: string): T {
    const el = container.querySelector(selector);
    if (!el) throw new Error(`Elemento não encontrado: ${selector}`);
    return el as T;
  }

  // Elementos base
  const backBtn = qs<HTMLButtonElement>("#btn-back");
  const btnStart = qs<HTMLButtonElement>("#btn-start");
  const btnStop = qs<HTMLButtonElement>("#btn-stop");
  const statusEl = qs<HTMLParagraphElement>("#loc-status");

  backBtn.addEventListener("click", () => navigateToHome());

  // ---------------------------
  // Chat efêmero (últimas 5)
  // ---------------------------
  const TTL_MS = 60_000; // sugestão: 60s (ajuste se quiser)
  const MAX_UI = 5;

  const chatList = qs<HTMLUListElement>("#chat-list");
  const chatForm = qs<HTMLFormElement>("#chat-form");
  const chatInput = qs<HTMLInputElement>("#chat-input");

  const messagesRef = ref(db, `rooms/${token}/chat/messages`);

  function addMsgToUi(listEl: HTMLUListElement, id: string, msg: ChatMessage): void {
    const when = new Date(msg.ts).toLocaleTimeString();

    const li = document.createElement("li");
    li.dataset.id = id;
    li.textContent = `[${when}] ${msg.from}: ${msg.text}`;
    listEl.appendChild(li);

    // mantém no máximo 5 no painel
    while (listEl.children.length > MAX_UI) {
      listEl.removeChild(listEl.firstElementChild!);
    }

    // remove da UI quando expirar (mesmo se o delete no RTDB atrasar)
    const delay = msg.expiresAt - Date.now();
    window.setTimeout(() => {
      const el = listEl.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);
      if (el) el.remove();
    }, Math.max(0, delay));
  }

  // Evita duplicar visual se re-renderizar a tela
  chatList.innerHTML = "";

  // Pegamos um pouco mais que 5 para não perder eventos, mas o painel limita em 5
  const recent = query(messagesRef, limitToLast(20));

  onChildAdded(recent, async (snap) => {
    const id = snap.key;
    if (!id) return;

    const msg = snap.val() as ChatMessage;

    // Se já expirou, tenta limpar do RTDB e não renderiza
    if (msg.expiresAt <= Date.now()) {
      await remove(snap.ref);
      return;
    }

    addMsgToUi(chatList, id, msg);
  });

  // Quando apagar do DB (limpeza), remove da UI
  onChildRemoved(messagesRef, (snap) => {
    const id = snap.key;
    if (!id) return;
    const el = chatList.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);
    if (el) el.remove();
  });

  chatForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();

    if (role !== "parent" && role !== "child") return;

    const text = chatInput.value.trim();
    if (!text) return;

    const now = Date.now();

    await push(messagesRef, {
      from: role,
      text,
      ts: now,
      expiresAt: now + TTL_MS,
    } satisfies ChatMessage);

    chatInput.value = "";
    chatInput.focus();
  });

  // Limpeza best-effort (sem backend): remove mensagens expiradas a cada 5s
  async function cleanupExpired(): Promise<void> {
    const now = Date.now();
    const q = query(messagesRef, orderByChild("expiresAt"), endAt(now), limitToLast(50));
    const snap = await get(q);
    if (!snap.exists()) return;

    const deletes: Promise<void>[] = [];
    snap.forEach((child) => {
      deletes.push(remove(child.ref));
    });
    await Promise.all(deletes);
  }

  // não guardar em const (evita TS6133: unused local)
  window.setInterval(() => {
    cleanupExpired().catch(console.error);
  }, 5000);

  // ---------------------------
  // Controle de UI do sharing
  // ---------------------------
  function setUiSharing(sharing: boolean): void {
    btnStart.disabled = sharing;
    btnStop.disabled = !sharing;
  }

  // ---------------------------
  // Botão "Parar" do responsável
  // ---------------------------
  if (showParentStop) {
    const btnParentStop = qs<HTMLButtonElement>("#btn-parent-stop");

    btnParentStop.addEventListener("click", async () => {
      statusEl.textContent = "Enviando comando de parar para a criança...";
      await set(ref(db, `rooms/${token}/control/stopShareRequested`), true);
      statusEl.textContent = "Comando enviado ✅";
    });
  }

  // ---------------------------
  // Child: compartilhar localização
  // ---------------------------
  let stopWatching: StopWatching | null = null;
  let lastWriteTs = 0;

  btnStart.addEventListener("click", async () => {
    if (role !== "child") {
      statusEl.textContent = "Abra o link com role=child para compartilhar localização.";
      return;
    }

    // Reseta o comando quando a criança começa (pra não herdar 'true' antigo)
    await set(ref(db, `rooms/${token}/control/stopShareRequested`), false);

    statusEl.textContent = "Solicitando permissão de localização...";
    setUiSharing(true);

    await update(ref(db, `rooms/${token}/presence/child`), {
      online: true,
      lastSeenTs: Date.now(),
    });

    try {
      stopWatching = watchPosition(
        async (p) => {
          const now = Date.now();
          if (now - lastWriteTs < 4000) return; // throttle ~4s
          lastWriteTs = now;

          await set(ref(db, `rooms/${token}/location/current`), p);
          await update(ref(db, `rooms/${token}/presence/child`), {
            online: true,
            lastSeenTs: Date.now(),
          });

          statusEl.textContent = `Enviando... lat=${p.lat.toFixed(5)} lng=${p.lng.toFixed(
            5
          )} acc=${Math.round(p.accuracy)}m`;
        },
        (err) => {
          console.error(err);
          statusEl.textContent = `Erro de geolocalização: ${err.message}`;
          setUiSharing(false);
        }
      );
    } catch (e) {
      console.error(e);
      statusEl.textContent = `Falha ao iniciar: ${(e as Error).message}`;
      setUiSharing(false);
    }
  });

  btnStop.addEventListener("click", async () => {
    if (stopWatching) stopWatching();
    stopWatching = null;

    setUiSharing(false);

    await update(ref(db, `rooms/${token}/presence/child`), {
      online: false,
      lastSeenTs: Date.now(),
    });

    statusEl.textContent = "Compartilhamento parado (local).";
  });

  // Child obedece comando do responsável (realtime)
  if (role === "child") {
    const stopRef = ref(db, `rooms/${token}/control/stopShareRequested`);

    onValue(stopRef, async (snap) => {
      const requested = snap.val() as boolean | null;

      if (requested !== true) return;
      if (!stopWatching) return;

      stopWatching();
      stopWatching = null;
      setUiSharing(false);

      await update(ref(db, `rooms/${token}/presence/child`), {
        online: false,
        lastSeenTs: Date.now(),
      });

      // reset pra não ficar travado em true
      await set(ref(db, `rooms/${token}/control/stopShareRequested`), false);

      statusEl.textContent = "Parado por comando do Responsável.";
    });
  }

  // ---------------------------
  // Parent: mapa Leaflet (última localização)
  // ---------------------------
  if (showMap) {
    setupLeafletDefaultIcon();

    const mapEl = qs<HTMLDivElement>("#map");
    const mapStatus = qs<HTMLParagraphElement>("#map-status");

    let map: LeafletMap | null = null;
    let marker: LeafletMarker | null = null;
    let hasCentered = false;

    // Init map (default Brasil)
    map = L.map(mapEl).setView([-14.235, -51.9253], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    mapStatus.textContent = "Aguardando localização da criança...";

    const locRef = ref(db, `rooms/${token}/location/current`);

    onValue(locRef, (snap) => {
      const val = snap.val() as LocationCurrent | null;

      if (!val) {
        mapStatus.textContent = "Sem localização ainda (a criança iniciou o compartilhamento?).";
        return;
      }

      mapStatus.textContent = `Atualizado: ${new Date(val.ts).toLocaleTimeString()} (±${Math.round(
        val.accuracy
      )}m)`;

      const latlng: [number, number] = [val.lat, val.lng];

      if (!marker) marker = L.marker(latlng).addTo(map!);
      else marker.setLatLng(latlng);

      if (!hasCentered) {
        map!.setView(latlng, 16);
        hasCentered = true;
      }
    });
  }
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}