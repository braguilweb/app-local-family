import QRCode from "qrcode";
import { ref, set } from "firebase/database";
import { db } from "../lib/firebase";
import { generateRoomToken } from "../lib/token";

export function renderHome(container: HTMLElement): void {
  container.innerHTML = `
    <main class="container">
      <h1>App Família</h1>

      <section class="card">
        <h2>Pareamento</h2>
        <button id="btn-create-room" type="button">Criar sala (Responsável)</button>

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
        <h2>Firebase</h2>
        <p id="fb-status">Pronto para testar.</p>
        <button id="btn-test" type="button">Testar escrita no RTDB</button>
      </section>
    </main>
  `;

  const btnCreate = container.querySelector<HTMLButtonElement>("#btn-create-room");
  const qrArea = container.querySelector<HTMLDivElement>("#qr-area");
  const qrImg = container.querySelector<HTMLImageElement>("#qr-img");
  const pairLink = container.querySelector<HTMLAnchorElement>("#pair-link");
  const btnOpenRoom = container.querySelector<HTMLButtonElement>("#btn-open-room");

  const statusEl = container.querySelector<HTMLParagraphElement>("#fb-status");
  const btnTest = container.querySelector<HTMLButtonElement>("#btn-test");

  if (
    !btnCreate ||
    !qrArea ||
    !qrImg ||
    !pairLink ||
    !btnOpenRoom ||
    !statusEl ||
    !btnTest
  ) {
    throw new Error("Elementos da Home não encontrados");
  }

  // TS novo: pode ser string ou null até criar a sala
  let lastToken: string | null = null;

  btnCreate.addEventListener("click", async () => {
    const token = generateRoomToken();
    lastToken = token;

    const url = `${window.location.origin}/#room=${token}`;

    await set(ref(db, `rooms/${token}`), { createdAt: Date.now() });

    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 480 });

    qrImg.src = dataUrl;
    pairLink.href = url;
    pairLink.textContent = url;
    qrArea.style.display = "block";
  });

  btnOpenRoom.addEventListener("click", () => {
    if (!lastToken) return; // ainda não criou sala
    window.location.hash = `room=${encodeURIComponent(lastToken)}`;
  });

  btnTest.addEventListener("click", async () => {
    statusEl.textContent = "Escrevendo em /_smokeTest ...";
    try {
      await set(ref(db, "/_smokeTest"), { ok: true, ts: Date.now() });
      statusEl.textContent = "RTDB OK ✅ (verifique /_smokeTest no Console)";
    } catch (err) {
      statusEl.textContent = "Falhou (ver console).";
      console.error(err);
    }
  });
}