// src/screens/home.ts
import QRCode from "qrcode";
import { ref, set } from "firebase/database";
import { db, auth } from "../lib/firebase";
import { generateRoomToken } from "../lib/token";

/**
 * Tempo de vida "best-effort" (RTDB não apaga sozinho).
 * Vamos usar isso para expiração/limpeza depois.
 */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Helper para evitar vários if (!el) e manter tipagem segura. */
function requiredEl<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Elemento obrigatório não encontrado: ${selector}`);
  return el as T;
}

export function renderHome(container: HTMLElement): void {
  container.innerHTML = `
    <main class="container">
      <h1>App Família</h1>

      <section class="card">
        <h2>Pareamento</h2>

        <p style="margin: 0 0 8px; font-size: 12px;">
          Crie uma sala para gerar o QR e parear outro dispositivo.
        </p>

        <button id="btn-create-room" type="button">Criar sala (Responsável)</button>
        <p id="home-status" style="margin: 8px 0 0; font-size: 12px;"></p>

        <div id="qr-area" style="margin-top:12px; display:none;">
          <p style="margin: 0 0 8px;">Escaneie o QR no celular da criança:</p>

          <img
            id="qr-img"
            alt="QR Code de pareamento"
            style="width: 240px; height: 240px; border: 1px solid #e6e8ee; border-radius: 12px;"
          />

          <p style="margin: 8px 0 0; font-size: 12px; word-break: break-all;">
            <span>Link: </span><a id="pair-link" href="#" target="_blank" rel="noreferrer"></a>
          </p>

          <button id="btn-open-room" type="button" style="margin-top:8px;">
            Abrir sala neste aparelho
          </button>
        </div>
      </section>

      <section class="card" style="margin-top:12px;">
        <h2>Sobre</h2>
        <p style="margin:0; font-size:12px;">
          Auth: Anonymous. A sala nasce com members/&lt;uid&gt; = parent.
        </p>
      </section>
    </main>
  `;

  const btnCreate = requiredEl<HTMLButtonElement>(container, "#btn-create-room");
  const statusEl = requiredEl<HTMLParagraphElement>(container, "#home-status");
  const qrArea = requiredEl<HTMLDivElement>(container, "#qr-area");
  const qrImg = requiredEl<HTMLImageElement>(container, "#qr-img");
  const pairLink = requiredEl<HTMLAnchorElement>(container, "#pair-link");
  const btnOpenRoom = requiredEl<HTMLButtonElement>(container, "#btn-open-room");

  let lastToken: string | null = null;

  btnCreate.addEventListener("click", async () => {
    btnCreate.disabled = true;
    statusEl.textContent = "Criando sala e gerando QR...";

    try {
      // Precisa existir uid (garantido pelo ensureSignedIn() no main.ts).
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Sem usuário autenticado (Anonymous).");

      const token = generateRoomToken();
      lastToken = token;

      const url = `${window.location.origin}/#room=${encodeURIComponent(token)}&role=child`;

      const now = Date.now();

      // Sala nasce com parentUid e members[uid]=parent (base das rules profissionais)
      await set(ref(db, `rooms/${token}`), {
        createdAt: now,
        expiresAt: now + ROOM_TTL_MS,
        parentUid: uid,
        members: {
          [uid]: { role: "parent" }
        }
      });

      const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 480 });

      qrImg.src = dataUrl;
      pairLink.href = url;
      pairLink.textContent = url;
      qrArea.style.display = "block";

      statusEl.textContent = "Sala criada. Escaneie o QR no celular da criança.";
    } catch (err) {
      console.error(err);
      statusEl.textContent =
        "Falhou ao criar a sala (veja o console). Provável: Rules do RTDB ainda não permitem members/expiresAt.";
      lastToken = null;
      qrArea.style.display = "none";
    } finally {
      btnCreate.disabled = false;
    }
  });

  btnOpenRoom.addEventListener("click", () => {
    if (!lastToken) {
      statusEl.textContent = "Crie uma sala primeiro para poder abrir aqui.";
      return;
    }
    window.location.hash = `room=${encodeURIComponent(lastToken)}&role=parent`;
  });
}
