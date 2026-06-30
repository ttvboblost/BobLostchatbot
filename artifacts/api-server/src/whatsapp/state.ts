export type ConnectionStatus = "aguardando_qr" | "conectado" | "desconectado";

// Minimal interface so state.ts does not import Baileys types directly.
// Only the capabilities needed by external callers (the admin route) are declared here.
export interface ActiveSocket {
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
}

interface WhatsAppState {
  qr: string | null;
  status: ConnectionStatus;
  processedIds: Set<string>;
  sock: ActiveSocket | null;
}

export const whatsappState: WhatsAppState = {
  qr: null,
  status: "desconectado",
  processedIds: new Set(),
  sock: null,
};
