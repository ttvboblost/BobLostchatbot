import type { Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { logger } from "../lib/logger.js";
import { isAdminTokenValid } from "../middlewares/admin-auth.js";

type RealtimeEvent = {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
};

const clients = new Set<WebSocket>();
let websocketServer: WebSocketServer | null = null;

export function attachWebSocketServer(server: Server): void {
  if (websocketServer) return;

  websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    ).pathname;

    if (pathname !== "/api/ws") {
      socket.destroy();
      return;
    }

    websocketServer?.handleUpgrade(request, socket, head, (client) => {
      websocketServer?.emit("connection", client, request);
    });
  });

  websocketServer.on("connection", (client) => {
    let authenticated = false;
    const authTimeout = setTimeout(() => {
      if (!authenticated) client.close(1008, "Authentication required");
    }, 5000);

    client.once("message", (raw) => {
      let payload: unknown;
      try {
        payload = JSON.parse(raw.toString());
      } catch {
        client.close(1008, "Invalid authentication message");
        return;
      }

      if (
        !payload ||
        typeof payload !== "object" ||
        !("type" in payload) ||
        payload.type !== "auth" ||
        !("token" in payload) ||
        typeof payload.token !== "string" ||
        !isAdminTokenValid(payload.token)
      ) {
        client.close(1008, "Unauthorized");
        return;
      }

      authenticated = true;
      clearTimeout(authTimeout);
      clients.add(client);
      client.send(JSON.stringify({ event: "authenticated", timestamp: new Date().toISOString() }));
      client.on("close", () => clients.delete(client));
      client.on("error", () => clients.delete(client));
    });

    client.on("close", () => clearTimeout(authTimeout));
  });
}

export function publishEvent(
  event: string,
  data: Record<string, unknown> = {},
): void {
  const message: RealtimeEvent = {
    event,
    data,
    timestamp: new Date().toISOString(),
  };
  const serialized = JSON.stringify(message);

  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) {
      clients.delete(client);
      continue;
    }
    try {
      client.send(serialized);
    } catch (error) {
      logger.warn({ err: error, event }, "Falha ao publicar evento WebSocket");
      clients.delete(client);
    }
  }
}
