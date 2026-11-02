export type ConnectionStatus =
  | "connecting"
  | "waiting_qr"
  | "connected"
  | "disconnected";

export interface ActiveSocket {
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
  groupMetadata(jid: string): Promise<{ subject?: string }>;
  logout(): Promise<void>;
  end(error?: Error): void;
}

interface WhatsAppState {
  qr: string | null;
  qrTimestamp: number | null;
  status: ConnectionStatus;
  processedIds: Set<string>;
  sock: ActiveSocket | null;
}

export const whatsappState: WhatsAppState = {
  qr: null,
  qrTimestamp: null,
  status: "disconnected",
  processedIds: new Set(),
  sock: null,
};
