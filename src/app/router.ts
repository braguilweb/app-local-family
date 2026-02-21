// src/app/router.ts
export type Role = "parent" | "child";

export type Route =
  | { name: "home" }
  | { name: "room"; token: string; role?: Role };

function parseRoomHash(hash: string): { token: string; role?: Role } | null {
  // aceita: room=TOKEN
  // ou:     room=TOKEN&role=child
  const params = new URLSearchParams(hash);
  const token = params.get("room");
  if (!token) return null;

  const roleRaw = params.get("role");
  const role = roleRaw === "parent" || roleRaw === "child" ? roleRaw : undefined;

  return { token, role };
}

function parseHash(rawHash: string): Route {
  const h = rawHash.replace(/^#/, "").trim();
  if (h === "" || h === "home") return { name: "home" };

  // novo formato: #room=TOKEN (&role=child|parent)
  if (h.startsWith("room=")) {
    const parsed = parseRoomHash(h);
    if (parsed) return { name: "room", token: parsed.token, role: parsed.role };
  }

  return { name: "home" };
}

export function getRouteFromHash(): Route {
  return parseHash(window.location.hash);
}

export function onHashChange(cb: (route: Route) => void): () => void {
  const handler = () => cb(getRouteFromHash());
  window.addEventListener("hashchange", handler);
  return () => window.removeEventListener("hashchange", handler);
}

export function navigateToHome(): void {
  window.location.hash = "home";
}

export function navigateToRoom(token: string, role?: Role): void {
  const qs = new URLSearchParams({ room: token });
  if (role) qs.set("role", role);
  window.location.hash = qs.toString();
}