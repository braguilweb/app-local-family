// src/lib/token.ts
export function generateRoomToken(bytes = 24): string {
  // 24 bytes ~ 192 bits (bem difícil de adivinhar)
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);

  // hex simples e URL-safe
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}