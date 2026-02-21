# App Família (MVP)

Web app **mobile-first** para pareamento via **QR Code** e compartilhamento de localização em tempo quase real entre **Responsável** e **Criança (12–17)**, usando **Firebase Realtime Database**.

> Projeto de portfólio (100% gratuito no plano Spark). Sem login: cada sala usa um token aleatório longo.

## Demo (fluxo)
1. **Responsável** abre a Home e clica em **Criar sala** → aparece o QR/link da sala.
2. **Criança** abre o link com `role=child` e clica **Iniciar compartilhamento**.
3. **Responsável** abre o link com `role=parent` e vê o marker no mapa.
4. **Responsável** pode mandar **Parar compartilhamento** (realtime) e a Criança obedece automaticamente.

## Stack
- Vite + TypeScript
- Firebase Realtime Database (Spark)
- Leaflet + OpenStreetMap
- PWA mínimo (manifest + service worker)
- Deploy: Vercel (passo final)

## Funcionalidades (MVP)
- Pareamento via token no hash: `#room=TOKEN`
- Links por papel:
  - `#room=TOKEN&role=child`
  - `#room=TOKEN&role=parent`
- Localização (child → RTDB): `rooms/{token}/location/current`
- Presença (child): `rooms/{token}/presence/child`
- Mapa (parent): Leaflet + realtime updates
- Controle remoto de stop:
  - parent escreve `rooms/{token}/control/stopShareRequested=true`
  - child escuta e para o sharing
- Chat efêmero (TTL) com UI mostrando no máximo 5 mensagens (best effort)

## Modelo de dados (RTDB)
- `rooms/{roomToken}/location/current` → `{lat,lng,accuracy,ts}`
- `rooms/{roomToken}/presence/child` → `{online,lastSeenTs}`
- `rooms/{roomToken}/presence/parent` → `{online,lastSeenTs}` *(futuro)*
- `rooms/{roomToken}/control/stopShareRequested` → `true|false`

## Rodar local
```bash
npm install
npm run dev