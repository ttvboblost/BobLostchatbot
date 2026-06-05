export type ConnectionStatus = "aguardando_qr" | "conectado" | "desconectado";

interface WhatsAppState {
  qr: string | null;
  status: ConnectionStatus;
  processedIds: Set<string>;
}

export const whatsappState: WhatsAppState = {
  qr: null,
  status: "desconectado",
  processedIds: new Set(),
};
