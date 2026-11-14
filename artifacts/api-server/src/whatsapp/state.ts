export type ConnectionStatus =
  | "connecting"
  | "waiting_qr"
  | "connected"
  | "disconnected"
  | "error";

export interface ActiveSocket {
  sendMessage(
    jid: string,
    content: { text: string; mentions?: string[] },
    options?: { messageId?: string },
  ): Promise<unknown>;
  groupMetadata(jid: string): Promise<{ subject?: string }>;
  logout(): Promise<void>;
  end(error?: Error): void;
}

interface WhatsAppState {
  qr: string | null;
  qrTimestamp: number | null;
  qrExpiresAt: number | null;
  qrExpired: boolean;
  lastError: string | null;
  status: ConnectionStatus;
  processedIds: Set<string>;
  sock: ActiveSocket | null;
}

export const whatsappState: WhatsAppState = {
  qr: null,
  qrTimestamp: null,
  qrExpiresAt: null,
  qrExpired: false,
  lastError: null,
  status: "disconnected",
  processedIds: new Set(),
  sock: null,
};
