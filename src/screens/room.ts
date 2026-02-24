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

function formatLastSeen(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(diff / 60000);
  
  if (seconds < 60) return "agora";
  if (minutes < 60) return "há " + minutes + " min";
  return "há " + Math.floor(minutes / 60) + "h";
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function qs<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error("Elemento não encontrado: " + selector);
  return el as T;
}

export function renderRoom(container: HTMLElement, token: string, role?: Role): void {
  const uid = auth.currentUser?.uid;

  const childLink = window.location.origin + "/#room=" + encodeURIComponent(token) + "&role=child";
  

  const isParent = role === "parent";
  const isChild = role === "child";

  

  // Status bar baseado no papel
  let statusHtml: string;
  if (isParent) {
    statusHtml = '<div class="status-bar" id="child-status"><div style="display: flex; align-items: center; gap: 8px;"><span class="status-dot offline" id="status-dot"></span><span class="status-text offline" id="status-text">Criança offline</span></div><span class="last-seen" id="last-seen">--</span></div>';
  } else {
    statusHtml = '<div class="status-bar"><div style="display: flex; align-items: center; gap: 8px;"><span class="status-dot online"></span><span class="status-text online">Você está online</span></div></div>';
  }

  // HTML moderno e organizado - SEM TEMPLATE STRINGS ANINHADAS
  let html = "";
  
  // Header
  html += '<div class="app-header"><h1>App Família</h1><span class="badge badge-role">' + (isParent ? "Responsável" : isChild ? "Criança" : "Visitante") + "</span></div>";
  
  // Status
  html += statusHtml;
  
  // Card Pareamento
  html += '<div class="card"><div class="card-title">Pareamento</div>';
  html += '<div style="font-size: 0.9rem; color: var(--text-light); margin-bottom: 12px;">Sala: <code style="background: var(--bg); padding: 4px 8px; border-radius: 4px; font-size: 0.8rem;">' + escapeHtml(token.slice(0, 16)) + "...</code></div>";
  
  if (isParent) {
    html += '<div class="qr-section"><div class="qr-code" id="qrcode"></div><p style="font-size: 0.85rem; color: var(--text-light); margin-bottom: 12px;">Peça para a criança escanear este QR Code</p><button class="btn btn-secondary" id="btn-copy-link">Copiar link da criança</button></div>';
  } else {
    html += '<div style="text-align: center; padding: 16px; background: var(--bg); border-radius: 8px;"><p style="margin: 0; color: var(--text-light);">Você entrou como criança nesta sala</p></div>';
  }
  
  html += '<p id="room-status" style="margin-top: 12px; font-size: 0.85rem; color: var(--text-light);"></p></div>';
  
  // Card Localização
  html += '<div class="card"><div class="card-title">Localização</div>';
  html += '<div id="loc-status" style="color: var(--text-light); font-size: 0.9rem; margin-bottom: 12px;">Aguardando início...</div>';
  
  if (isChild) {
    html += '<button id="btn-start" class="btn btn-primary">Iniciar Compartilhamento</button>';
  }
  
  if (isParent) {
    html += '<button id="btn-parent-stop" class="btn btn-danger">Parar Compartilhamento</button>';
  }
  
  html += "</div>";
  
  // Card Mapa (apenas parent)
  if (isParent) {
    html += '<div class="card"><div class="card-title">Mapa</div><div id="map" class="map-container"></div><div id="map-status" class="map-status">Aguardando localização...</div></div>';
  }
  
  // Card Chat
  let placeholderText: string;
  if (isParent) {
    placeholderText = "Mensagem para criança...";
  } else {
    placeholderText = "Mensagem para responsável...";
  }
  
  html += '<div class="card"><div class="card-title">Chat</div><ul id="chat-list" class="chat-container"></ul>';
  html += '<form id="chat-form" class="chat-form"><input type="text" id="chat-input" class="chat-input" placeholder="' + placeholderText + '" maxlength="200" autocomplete="off"><button type="submit" class="btn btn-primary" style="width: auto; padding: 12px 20px;">Enviar</button></form></div>';
  
  // Botão voltar
  html += '<button id="btn-back" class="btn btn-secondary">Voltar para início</button>';
  
  container.innerHTML = html;

  // Gerar QR Code se for parent
  if (isParent) {
    import("qrcode").then(QRCode => {
      const qrContainer = container.querySelector("#qrcode");
      if (qrContainer) {
        // Cria um canvas dinamicamente
        const canvas = document.createElement("canvas");
        qrContainer.appendChild(canvas);
        
        QRCode.toCanvas(canvas, childLink, { width: 200 }, (err: any) => {
          if (err) console.error("Erro ao gerar QR:", err);
        });
      }
    }).catch(() => {
      const qrContainer = container.querySelector("#qrcode");
      if (qrContainer) {
        qrContainer.innerHTML = '<div style="padding: 20px; background: white; border-radius: 8px;"><a href="' + childLink + '" style="font-size: 0.8rem; word-break: break-all;">' + childLink + "</a></div>";
      }
    });

    // Botão copiar link
    const btnCopy = container.querySelector("#btn-copy-link");
    btnCopy?.addEventListener("click", () => {
      navigator.clipboard.writeText(childLink).then(() => {
        const btn = btnCopy as HTMLButtonElement;
        const original = btn.textContent || "";
        btn.textContent = "Copiado!";
        setTimeout(() => btn.textContent = original, 2000);
      });
    });
  }

  const backBtn = qs<HTMLButtonElement>(container, "#btn-back");
  //const btnStart = qs<HTMLButtonElement>(container, "#btn-start");
  const statusEl = qs<HTMLDivElement>(container, "#loc-status");
  const roomStatusEl = qs<HTMLParagraphElement>(container, "#room-status");

  // CORREÇÃO: btnStart só existe para child, então buscamos condicionalmente
let btnStart: HTMLButtonElement | null = null;
if (isChild) {
  btnStart = qs<HTMLButtonElement>(container, "#btn-start");
}

// CORREÇÃO: btnParentStop só existe para parent, então buscamos condicionalmente  
let btnParentStop: HTMLButtonElement | null = null;
if (isParent) {
  btnParentStop = qs<HTMLButtonElement>(container, "#btn-parent-stop");
}


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
    if (!uid || (!isParent && !isChild)) return;

    const presPath = isParent ? "rooms/" + token + "/presence/parent" : "rooms/" + token + "/presence/child";
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

  window.addEventListener(
    "hashchange",
    () => {
      dispose();
    },
    { once: true }
  );

  if (!uid) {
    roomStatusEl.textContent = "Erro: sem usuário autenticado. Recarregue a página.";
    if (btnStart) btnStart.disabled = true;
    return;
  }

  // Room meta
  void (async () => {
    try {
      const metaSnap = await get(ref(db, "rooms/" + token));
      const meta = (metaSnap.val() ?? {}) as RoomMeta;

      if (!metaSnap.exists()) {
        roomStatusEl.textContent = "Sala não encontrada";
        if (btnStart)btnStart.disabled = true;
        return;
      }

      if (typeof meta.expiresAt === "number" && Date.now() > meta.expiresAt) {
        roomStatusEl.textContent = "Sala expirada";
        if (btnStart) btnStart.disabled = true;
        return;
      }

      roomStatusEl.textContent = "Sala ativa";
    } catch (e) {
      console.error(e);
      roomStatusEl.textContent = "Erro ao carregar sala";
    }
  })();

  // Join automático da criança
  async function joinAsChildIfNeeded(): Promise<void> {
    if (!isChild) return;

    const childUidSnap = await get(ref(db, "rooms/" + token + "/childUid"));
    const existing = childUidSnap.val() as string | null;

    if (existing && existing !== uid) {
      roomStatusEl.textContent = "Sala já tem uma criança pareada";
      if (btnStart) btnStart.disabled = true;
      return;
    }

    await set(ref(db, "rooms/" + token + "/childUid"), uid);
    await set(ref(db, "rooms/" + token + "/members/" + uid), { role: "child" });

    roomStatusEl.textContent = "Criança pareada com sucesso";
  }

  void joinAsChildIfNeeded().catch((e) => {
    console.error(e);
    roomStatusEl.textContent = "Erro ao parear";
    if (btnStart) btnStart.disabled = true;
  });

  // Presença
  async function setPresenceOnline(): Promise<void> {
    if (!isParent && !isChild) return;

    const presPath = isParent ? "rooms/" + token + "/presence/parent" : "rooms/" + token + "/presence/child";
    const presRef = ref(db, presPath);

    await set(presRef, { online: true, lastSeenTs: Date.now() });
    onDisconnect(presRef).set({ online: false, lastSeenTs: serverTimestamp() });
  }

  void setPresenceOnline().catch(console.error);

  // Status da criança em tempo real (apenas para parent)
  if (isParent) {
    const childPresenceRef = ref(db, "rooms/" + token + "/presence/child");
    
    const unsubPresence = onValue(childPresenceRef, (snap) => {
      const presence = snap.val() as { online?: boolean; lastSeenTs?: number } | null;
      const dot = container.querySelector("#status-dot") as HTMLElement;
      const text = container.querySelector("#status-text") as HTMLElement;
      const lastSeen = container.querySelector("#last-seen") as HTMLElement;
      
      if (!dot || !text || !lastSeen) return;
      
      if (presence?.online) {
        dot.className = "status-dot online";
        text.className = "status-text online";
        text.textContent = "Criança online";
        lastSeen.textContent = "agora";
      } else {
        dot.className = "status-dot offline";
        text.className = "status-text offline";
        text.textContent = "Criança offline";
        const ts = presence?.lastSeenTs || Date.now();
        lastSeen.textContent = formatLastSeen(ts);
      }
    });
    
    unsubscribers.push(unsubPresence);
  }

  // Controle do stop
  if (isParent && btnParentStop) {
  btnParentStop.addEventListener("click", async () => {
    statusEl.textContent = "Enviando comando...";
    await set(ref(db, "rooms/" + token + "/control/stopShareRequested"), true);
    statusEl.textContent = "Comando enviado";
  });
}

  if (isChild) {
    const stopRef = ref(db, "rooms/" + token + "/control/stopShareRequested");
    const unsub = onValue(stopRef, async (snap) => {
      const requested = snap.val() as boolean | null;
      if (requested !== true) return;

      if (stopWatching) {
        stopWatching();
        stopWatching = null;
      }

      await update(ref(db, "rooms/" + token + "/presence/child"), {
        online: false,
        lastSeenTs: Date.now()
      });

      await set(ref(db, "rooms/" + token + "/control/stopShareRequested"), false);

      statusEl.textContent = "Compartilhamento interrompido pelo Responsável";
      if (btnStart) btnStart.disabled = false;
    });
    unsubscribers.push(unsub);
  }

  // Compartilhamento de localização

  if (isChild && btnStart) {
  
    let lastWriteTs = 0;
    

    btnStart.addEventListener("click", async () => {
      if (!isChild) {
        statusEl.textContent = "Somente a criança pode iniciar";
        return;
      }

      statusEl.textContent = "Solicitando permissão de GPS...";
      btnStart.disabled = true;

      await set(ref(db, "rooms/" + token + "/control/stopShareRequested"), false);

      await update(ref(db, "rooms/" + token + "/presence/child"), {
        online: true,
        lastSeenTs: Date.now()
      });

      try {
        stopWatching = watchPosition(
          async (p) => {
            const now = Date.now();
            if (now - lastWriteTs < 4000) return;
            lastWriteTs = now;

            await set(ref(db, "rooms/" + token + "/location/current"), p);
            await update(ref(db, "rooms/" + token + "/presence/child"), {
              online: true,
              lastSeenTs: Date.now()
            });

            // SEM TEMPLATE STRING - USANDO CONCATENAÇÃO
            const latStr = p.lat.toFixed(5);
            const lngStr = p.lng.toFixed(5);
            const accStr = Math.round(p.accuracy).toString();
            statusEl.textContent = "Enviando... (" + latStr + ", " + lngStr + ") ±" + accStr + "m";
          },
          (err) => {
            console.error(err);
            statusEl.textContent = "Erro de GPS: " + err.message;
            btnStart.disabled = false;
          }
        );
      } catch (e) {
        console.error(e);
        statusEl.textContent = "Falha ao iniciar: " + (e as Error).message;
        btnStart.disabled = false;
      }
    });
  }

  // Chat
  const TTL_MS = 60000;
  const MAX_UI = 5;

  const chatList = qs<HTMLUListElement>(container, "#chat-list");
  const chatForm = qs<HTMLFormElement>(container, "#chat-form");
  const chatInput = qs<HTMLInputElement>(container, "#chat-input");

  const messagesRef = ref(db, "rooms/" + token + "/chat/messages");

  function addMsgToUi(listEl: HTMLUListElement, id: string, msg: ChatMessage): void {
    const when = new Date(msg.ts).toLocaleTimeString();
    const li = document.createElement("li");
    
    // Define classe CSS baseada no remetente
    if (msg.from === "parent") {
      li.className = "chat-message parent";
    } else {
      li.className = "chat-message child";
    }
    
    li.dataset.id = id;
    
    // Cria estrutura segura
    const metaDiv = document.createElement("div");
    metaDiv.className = "chat-meta";
    
    let fromText: string;
    if (msg.from === "parent") {
      fromText = "Responsável";
    } else {
      fromText = "Criança";
    }
    metaDiv.textContent = fromText + " • " + when;
    
    const textDiv = document.createElement("div");
    textDiv.textContent = msg.text;
    
    li.appendChild(metaDiv);
    li.appendChild(textDiv);
    listEl.appendChild(li);

    // Mantém apenas últimas 5 mensagens visíveis
    while (listEl.children.length > MAX_UI) {
      if (listEl.firstElementChild) {
        listEl.removeChild(listEl.firstElementChild);
      }
    }

    // Auto-scroll para última mensagem
    listEl.scrollTop = listEl.scrollHeight;

    // Remove após expirar
    const delay = msg.expiresAt - Date.now();
    if (delay > 0) {
      window.setTimeout(() => {
        const selector = 'li[data-id="' + id + '"]';
        const el = listEl.querySelector<HTMLLIElement>(selector);
        if (el) el.remove();
      }, delay);
    }
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
      const el = chatList.querySelector<HTMLLIElement>('li[data-id="' + id + '"]');
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
      text: text,
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

  // Mapa
  if (isParent) {
    setupLeafletDefaultIcon();

    const mapEl = qs<HTMLDivElement>(container, "#map");
    const mapStatus = qs<HTMLDivElement>(container, "#map-status");

    let map: LeafletMap | null = null;
    let marker: LeafletMarker | null = null;
    let hasCentered = false;

    map = L.map(mapEl).setView([-14.235, -51.9253], 4);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "OpenStreetMap",
      maxZoom: 19
    }).addTo(map);

    const locRef = ref(db, "rooms/" + token + "/location/current");
    unsubscribers.push(
      onValue(locRef, (snap) => {
        const val = snap.val() as LocationCurrent | null;

        if (!val) {
          mapStatus.textContent = "Aguardando criança iniciar...";
          return;
        }

        // SEM TEMPLATE STRING
        const timeStr = new Date(val.ts).toLocaleTimeString();
        const accStr = Math.round(val.accuracy).toString();
        mapStatus.textContent = timeStr + " • ±" + accStr + "m";

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