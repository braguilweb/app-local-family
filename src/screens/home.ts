// src/screens/home.ts
const { default: QRCode } = await import('qrcode');
import { ref, set } from "firebase/database";
import { db, auth } from "../lib/firebase";
import { generateRoomToken } from "../lib/token";

const ROOM_TTL_MS = 4 * 60 * 60 * 1000; // 4 horas (mais seguro que 24h)

function requiredEl<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Elemento obrigatório não encontrado: ${selector}`);
  return el as T;
}

export function renderHome(container: HTMLElement): void {
  container.innerHTML = `
    <div class="app-header" style="margin-top: 20px;">
      <div style="font-size: 3rem; margin-bottom: 8px;">👨‍👩‍👧‍👦</div>
      <h1>App Família</h1>
      <p style="color: var(--text-light); font-size: 0.95rem; margin-top: 8px;">
        Conecte-se com seus filhos em tempo real
      </p>
    </div>

    <div class="card" style="text-align: center; padding: 32px 24px;">
      <div style="font-size: 4rem; margin-bottom: 16px;">🏠</div>
      <h2 style="margin-bottom: 12px; color: var(--text);">Criar Nova Sala</h2>
      <p style="color: var(--text-light); margin-bottom: 24px; line-height: 1.5;">
        Gere um QR Code seguro para parear o dispositivo da criança. 
        <br>Nenhum dado pessoal é coletado.
      </p>
      
      <button id="btn-create-room" class="btn btn-primary" style="margin-bottom: 16px;">
        ➕ Criar Sala de Pareamento
      </button>
      
      <div style="display: flex; gap: 16px; justify-content: center; font-size: 0.8rem; color: var(--text-light);">
        <span>🔒 Privado</span>
        <span>⚡ Tempo real</span>
        <span>🆓 Gratuito</span>
      </div>
      
      <p id="home-status" style="margin-top: 16px; font-size: 0.9rem; min-height: 24px;"></p>
    </div>

    <div id="qr-card" class="card" style="display: none; text-align: center;">
      <div class="card-title">📱 Escaneie com o celular da criança</div>
      
      <div style="background: white; padding: 20px; border-radius: 12px; display: inline-block; margin: 16px 0; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <img
          id="qr-img"
          alt="QR Code de pareamento"
          style="width: 220px; height: 220px; display: block;"
        />
      </div>

      <div style="background: var(--bg); padding: 12px; border-radius: 8px; margin-bottom: 16px;">
        <p style="margin: 0 0 8px; font-size: 0.8rem; color: var(--text-light);">Ou copie o link:</p>
        <div style="display: flex; gap: 8px; align-items: center;">
          <code id="pair-link-text" style="flex: 1; font-size: 0.75rem; background: white; padding: 8px; border-radius: 6px; word-break: break-all; text-align: left;"></code>
          <button id="btn-copy" class="btn btn-secondary" style="width: auto; padding: 8px 16px; font-size: 0.85rem;">
            📋
          </button>
        </div>
      </div>

      <div style="display: flex; gap: 12px; flex-direction: column;">
        <button id="btn-open-room" class="btn btn-primary">
          🚪 Entrar como Responsável
        </button>
        <button id="btn-new-room" class="btn btn-secondary">
          🔄 Criar Nova Sala
        </button>
      </div>
    </div>

    <div class="card" style="margin-top: 16px;">
      <div class="card-title">ℹ️ Como funciona</div>
      <div style="display: flex; flex-direction: column; gap: 16px; font-size: 0.9rem; color: var(--text-light);">
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: var(--primary); color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">1</div>
          <div>
            <strong style="color: var(--text);">Crie a sala</strong><br>
            Clique no botão acima para gerar um QR Code único
          </div>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: var(--primary); color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">2</div>
          <div>
            <strong style="color: var(--text);">Criança escaneia</strong><br>
            Use o celular da criança para ler o QR Code ou abrir o link
          </div>
        </div>
        <div style="display: flex; align-items: flex-start; gap: 12px;">
          <div style="background: var(--primary); color: white; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; flex-shrink: 0;">3</div>
          <div>
            <strong style="color: var(--text);">Acompanhe</strong><br>
            Veja a localização em tempo real e converse pelo chat
          </div>
        </div>
      </div>
    </div>

    <div style="text-align: center; padding: 24px; color: var(--text-light); font-size: 0.8rem;">
      <p>🔒 Seguro • 🕐 Sala expira em 4 horas • 👤 Auth anônimo</p>
      <p style="margin-top: 8px;">By Guilherme Braga • 100% gratuito</p>
    </div>
  `;

  const btnCreate = requiredEl<HTMLButtonElement>(container, "#btn-create-room");
  const statusEl = requiredEl<HTMLParagraphElement>(container, "#home-status");
  const qrCard = requiredEl<HTMLDivElement>(container, "#qr-card");
  const qrImg = requiredEl<HTMLImageElement>(container, "#qr-img");
  const pairLinkText = requiredEl<HTMLElement>(container, "#pair-link-text");
  const btnCopy = requiredEl<HTMLButtonElement>(container, "#btn-copy");
  const btnOpenRoom = requiredEl<HTMLButtonElement>(container, "#btn-open-room");
  const btnNewRoom = requiredEl<HTMLButtonElement>(container, "#btn-new-room");

  let lastToken: string | null = null;
  let lastUrl: string | null = null;

  btnCreate.addEventListener("click", async () => {
    btnCreate.disabled = true;
    statusEl.textContent = "⏳ Criando sala segura...";
    statusEl.style.color = "var(--text-light)";

    try {
      const uid = auth.currentUser?.uid;
      if (!uid) throw new Error("Sem usuário autenticado");

      const token = generateRoomToken();
      lastToken = token;
      lastUrl = `${window.location.origin}/#room=${encodeURIComponent(token)}&role=child`;

      const now = Date.now();

      await set(ref(db, `rooms/${token}`), {
        createdAt: now,
        expiresAt: now + ROOM_TTL_MS,
        parentUid: uid,
        members: {
          [uid]: { role: "parent" }
        }
      });

      const dataUrl = await QRCode.toDataURL(lastUrl, { 
        margin: 2, 
        width: 440,
        color: {
          dark: '#4f46e5',
          light: '#ffffff'
        }
      });

      qrImg.src = dataUrl;
      pairLinkText.textContent = lastUrl;
      
      // Esconde o card inicial e mostra o QR
      btnCreate.parentElement!.style.display = 'none';
      qrCard.style.display = 'block';
      
      statusEl.textContent = "✅ Sala criada com sucesso!";
      statusEl.style.color = "var(--success)";

    } catch (err) {
      console.error(err);
      statusEl.textContent = "❌ Erro ao criar sala. Verifique o console.";
      statusEl.style.color = "var(--danger)";
      lastToken = null;
      lastUrl = null;
    } finally {
      btnCreate.disabled = false;
    }
  });

  // Copiar link
  btnCopy.addEventListener("click", async () => {
    if (!lastUrl) return;
    
    try {
      await navigator.clipboard.writeText(lastUrl);
      const original = btnCopy.textContent;
      btnCopy.textContent = "✅";
      setTimeout(() => btnCopy.textContent = original, 2000);
    } catch (err) {
      // Fallback: seleciona o texto
      const range = document.createRange();
      range.selectNode(pairLinkText);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
    }
  });

  // Entrar como parent
  btnOpenRoom.addEventListener("click", () => {
    if (!lastToken) {
      statusEl.textContent = "❌ Crie uma sala primeiro";
      return;
    }
    window.location.hash = `room=${encodeURIComponent(lastToken)}&role=parent`;
  });

  // Criar nova sala (reset)
  btnNewRoom.addEventListener("click", () => {
    lastToken = null;
    lastUrl = null;
    qrCard.style.display = 'none';
    btnCreate.parentElement!.style.display = 'block';
    statusEl.textContent = "";
    btnCreate.disabled = false;
  });
}