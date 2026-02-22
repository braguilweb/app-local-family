// src/screens/room.ts
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
  onDisconnect,
  serverTimestamp,
  type Unsubscribe
} from "firebase/database";

import L, { type Map as LeafletMap, type Marker as LeafletMarker } from "leaflet";

import { navigateToHome } from "../app/router";
import type { Role } from "../app/router";
import { db, auth } from "../lib/firebase";
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
 * - mensagens em rooms/{token}/chat/messages/{pushId}
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

type RoomMeta = {
  createdAt?: number;
  expiresAt?: number;
  parentUid?: string;
  childUid?: string;
};

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Helper: querySelector que nunca retorna null (evita TS "possibly null"). */
function qs<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Elemento não encontrado: ${selector}`);
  return el as T;
}

export function renderRoom(container: HTMLElement, token: string, role?: Role): void {
  const uid = auth.currentUser?.uid;

  const childLink = `${window.location.origin}/#room=${encodeURIComponent(token)}&role=child`;
  const parentLink = `${window.location.origin}/#room=${encodeURIComponent(token)}&role=parent`;

  const isParent = role === "parent";
  const isChild = role === "child";

  const showMap = isParent;
  const showParentStop = isParent;

  // UX: criança não precisa ver link do responsável (reduz risco de print/repasse)
  const pairingHtml = isParent
    ? `
      <p style="margin: 0 0 8px;">
        <strong>Link Criança:</strong>
        <a href="${childLink}" target="_blank" rel="noreferrer">${childLink}</a>
      </p>
      <p style="margin: 0;">
        <strong>Seu link (Responsável):</strong>
        <a href="${parentLink}" target="_blank" rel="noreferrer">${parentLink}</a>
      </p>
    `
    : `
      <p style="margin: 0;">
        <strong>Seu link (Criança):</strong>
        <a href="${childLink}" target="_blank" rel="noreferrer">${childLink}</a>
      </p>
    `;

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
        ${pairingHtml}
        <p id="room-status" style="margin: 8px 0 0; font-size: 12px;"></p>
      </section>

      <section class="card" style="margin-top:12px;">
        <h2>Localização</h2>
        <p style="margin: 0 0 8px;"><strong>Role:</strong> <span id="role-label">${escapeHtml(role ?? "(não definido)")}</span></p>

        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button id="btn-start" type="button">Iniciar compartilhamento (Criança)</button>

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

  const backBtn = qs<HTMLButtonElement>(container, "#btn-back");
  const btnStart = qs<HTMLButtonElement>(container, "#btn-start");
  const statusEl = qs<HTMLParagraphElement>(container, "#loc-status");
  const roomStatusEl = qs<HTMLParagraphElement>(container, "#room-status");

  // Para evitar vazamento de listeners/timers ao trocar de rota, guardamos cleanups
  const unsubscribers: Unsubscribe[] = [];
  let intervalId: number | null = null;
  let stopWatching: StopWatching | null = null;
  let disposed = false;

  function dispose(): void {
    if (disposed) return;
    disposed = true;

    if (stopWatching) stopWatching();
    stopWatching = null;

    for (const unsub of unsubscribers) unsub();
    unsubscribers.length = 0;

    if (intervalId != null) window.clearInterval(intervalId);
    intervalId = null;
  }

  async function cleanupPresenceBestEffort(): Promise<void> {
    // Best effort: se a aba fechar “do nada”, onDisconnect cuida do principal.
    // Aqui limpamos quando o usuário usa o botão Voltar.
    if (!uid || (!isParent && !isChild)) return;

    const presPath = isParent ? `rooms/${token}/presence/parent` : `rooms/${token}/presence/child`;
    await remove(ref(db, presPath));
  }

  backBtn.addEventListener("click", () => {
    void (async () => {
      try {
        dispose();
        await cleanupPresenceBestEffort();
      } finally {
        navigateToHome();
      }
    })().catch(console.error);
  });

  // Se trocar hash (router vai re-renderizar), fazemos cleanup local também
  window.addEventListener(
    "hashchange",
    () => {
      // evita deixar watchPosition/interval rodando enquanto troca de tela
      dispose();
    },
    { once: true }
  );

  // Verificação básica
  if (!uid) {
    roomStatusEl.textContent = "Erro: sem usuário autenticado (Anonymous). Recarregue a página.";
    btnStart.disabled = true;
    return;
  }

  // ---------------------------
  // Room meta (expiração / info)
  // ---------------------------
  void (async () => {
    try {
      const metaSnap = await get(ref(db, `rooms/${token}`));
      const meta = (metaSnap.val() ?? {}) as RoomMeta;

      if (!metaSnap.exists()) {
        roomStatusEl.textContent = "Sala não encontrada (talvez tenha sido encerrada).";
        btnStart.disabled = true;
        return;
      }

      if (typeof meta.expiresAt === "number" && Date.now() > meta.expiresAt) {
        roomStatusEl.textContent = "Sala expirada.";
        btnStart.disabled = true;
        return;
      }

      roomStatusEl.textContent = "Sala OK.";
    } catch (e) {
      console.error(e);
      roomStatusEl.textContent = "Falha ao carregar metadados da sala (ver console).";
    }
  })();

  // ---------------------------
  // Join automático da criança
  // ---------------------------
  async function joinAsChildIfNeeded(): Promise<void> {
    if (!isChild) return;

    // Se já tem childUid, não tenta entrar (evita “roubar” sala)
    const childUidSnap = await get(ref(db, `rooms/${token}/childUid`));
    const existing = childUidSnap.val() as string | null;

    if (existing && existing !== uid) {
      roomStatusEl.textContent = "Esta sala já tem uma criança pareada.";
      btnStart.disabled = true;
      return;
    }

    // Faz update multi-path no root da sala (members/<uid> + childUid juntos)
    await update(ref(db, `rooms/${token}`), {
      [`members/${uid}`]: { role: "child" },
      childUid: uid
    });

    roomStatusEl.textContent = "Criança pareada nesta sala.";
  }

  void joinAsChildIfNeeded().catch((e) => {
    console.error(e);
    roomStatusEl.textContent = "Falha ao parear como criança (ver console).";
    btnStart.disabled = true;
  });

  // ---------------------------
  // Presença com onDisconnect()
  // ---------------------------
  async function setPresenceOnline(): Promise<void> {
    if (!isParent && !isChild) return;

    const presPath = isParent ? `rooms/${token}/presence/parent` : `rooms/${token}/presence/child`;
    const presRef = ref(db, presPath);

    // Atualiza presença agora
    await set(presRef, { online: true, lastSeenTs: Date.now() });

    // onDisconnect vive no servidor e executa quando a conexão cair/fechar
    onDisconnect(presRef).set({ online: false, lastSeenTs: serverTimestamp() });
  }

  void setPresenceOnline().catch(console.error);

  // ---------------------------
  // Controle do "stop" (pai manda)
  // ---------------------------
  if (showParentStop) {
    const btnParentStop = qs<HTMLButtonElement>(container, "#btn-parent-stop");
    btnParentStop.addEventListener("click", async () => {
      statusEl.textContent = "Enviando comando de parar para a criança...";
      await set(ref(db, `rooms/${token}/control/stopShareRequested`), true);
      statusEl.textContent = "Comando enviado ✅";
    });
  }

  // Criança obedece ao comando do pai (realtime)
  if (isChild) {
    const stopRef = ref(db, `rooms/${token}/control/stopShareRequested`);
    const unsub = onValue(stopRef, async (snap) => {
      const requested = snap.val() as boolean | null;
      if (requested !== true) return;

      if (stopWatching) {
        stopWatching();
        stopWatching = null;
      }

      await update(ref(db, `rooms/${token}/presence/child`), {
        online: false,
        lastSeenTs: Date.now()
      });

      // reseta para false (para não ficar travado)
      await set(ref(db, `rooms/${token}/control/stopShareRequested`), false);

      statusEl.textContent = "Compartilhamento interrompido pelo Responsável.";
    });
    unsubscribers.push(unsub);
  }

  // ---------------------------
  // Child: compartilhar localização (iniciar)
  // ---------------------------
  let lastWriteTs = 0;

  function setUiSharing(sharing: boolean): void {
    btnStart.disabled = sharing;
  }

  btnStart.addEventListener("click", async () => {
    if (!isChild) {
      statusEl.textContent = "Somente a Criança pode iniciar o compartilhamento.";
      return;
    }

    statusEl.textContent = "Solicitando permissão de localização...";
    setUiSharing(true);

    // A criança só para por comando do responsável (não tem botão local de parar)
    await set(ref(db, `rooms/${token}/control/stopShareRequested`), false);

    await update(ref(db, `rooms/${token}/presence/child`), {
      online: true,
      lastSeenTs: Date.now()
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
            lastSeenTs: Date.now()
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

  // ---------------------------
  // Chat efêmero (últimas 5)
  // ---------------------------
  const TTL_MS = 60_000;
  const MAX_UI = 5;

  const chatList = qs<HTMLUListElement>(container, "#chat-list");
  const chatForm = qs<HTMLFormElement>(container, "#chat-form");
  const chatInput = qs<HTMLInputElement>(container, "#chat-input");

  const messagesRef = ref(db, `rooms/${token}/chat/messages`);

  function addMsgToUi(listEl: HTMLUListElement, id: string, msg: ChatMessage): void {
    const when = new Date(msg.ts).toLocaleTimeString();
    const li = document.createElement("li");
    li.dataset.id = id;
    li.textContent = `[${when}] ${msg.from}: ${msg.text}`;
    listEl.appendChild(li);

    while (listEl.children.length > MAX_UI) {
      listEl.removeChild(listEl.firstElementChild!);
    }

    const delay = msg.expiresAt - Date.now();
    window.setTimeout(() => {
      const el = listEl.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);
      if (el) el.remove();
    }, Math.max(0, delay));
  }

  chatList.innerHTML = "";

  const recent = query(messagesRef, limitToLast(20));
  unsubscribers.push(
    onChildAdded(recent, async (snap) => {
      const id = snap.key;
      if (!id) return;

      const msg = snap.val() as ChatMessage;

      if (msg.expiresAt <= Date.now()) {
        await remove(snap.ref);
        return;
      }

      addMsgToUi(chatList, id, msg);
    })
  );

  unsubscribers.push(
    onChildRemoved(messagesRef, (snap) => {
      const id = snap.key;
      if (!id) return;
      const el = chatList.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);
      if (el) el.remove();
    })
  );

  chatForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!isParent && !isChild) return;

    const text = chatInput.value.trim();
    if (!text) return;

    const now = Date.now();

    await push(messagesRef, {
      from: role,
      text,
      ts: now,
      expiresAt: now + TTL_MS
    } satisfies ChatMessage);

    chatInput.value = "";
    chatInput.focus();
  });

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

  intervalId = window.setInterval(() => {
    cleanupExpired().catch(console.error);
  }, 5000);

  // ---------------------------
  // Parent: mapa Leaflet (última localização)
  // ---------------------------
  if (showMap) {
    setupLeafletDefaultIcon();

    const mapEl = qs<HTMLDivElement>(container, "#map");
    const mapStatus = qs<HTMLParagraphElement>(container, "#map-status");

    let map: LeafletMap | null = null;
    let marker: LeafletMarker | null = null;
    let hasCentered = false;

    map = L.map(mapEl).setView([-14.235, -51.9253], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19
    }).addTo(map);

    mapStatus.textContent = "Aguardando localização da criança...";

    const locRef = ref(db, `rooms/${token}/location/current`);
    unsubscribers.push(
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
      })
    );
  }
}
