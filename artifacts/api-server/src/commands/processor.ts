export interface ParsedCommand {
  name: string;
  argumentsText: string;
}

export interface MessageEligibility {
  remoteJid: string | null | undefined;
  fromMe: boolean | null | undefined;
  groupAuthorized: boolean;
}

export interface CommandVariables {
  name: string;
  group: string;
  now: Date;
  timezone: string;
}

export function parseCommand(text: string): ParsedCommand | null {
  const match = /^!([a-z0-9][a-z0-9_-]{0,31})(?:\s+([\s\S]*))?$/i.exec(
    text.trim(),
  );
  if (!match) return null;

  return {
    name: (match[1] ?? "").toLowerCase(),
    argumentsText: (match[2] ?? "").trim(),
  };
}

export function isMessageEligibleForReply(
  input: MessageEligibility,
): boolean {
  return Boolean(
    input.remoteJid?.endsWith("@g.us") &&
      !input.fromMe &&
      input.groupAuthorized,
  );
}

export function renderCommandResponse(
  content: string,
  variables: CommandVariables,
): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    timeZone: variables.timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(variables.now);
  const time = new Intl.DateTimeFormat("pt-BR", {
    timeZone: variables.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(variables.now);
  const replacements: Record<string, string> = {
    nome: variables.name,
    grupo: variables.group,
    data: date,
    hora: time,
  };

  return content.replace(/\{(nome|grupo|data|hora)\}/gi, (token, key: string) => {
    return replacements[key.toLowerCase()] ?? token;
  });
}
