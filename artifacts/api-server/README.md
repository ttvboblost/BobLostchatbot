# BobLost WhatsApp Bot — Backend

Backend em Node.js, TypeScript, Express, Baileys e PostgreSQL gerenciado do Replit. Ele
responde apenas a comandos ativos enviados em grupos autorizados. Conversas
privadas, grupos não autorizados e mensagens do próprio bot nunca recebem
respostas.

## Configuração

Configure estes valores em **Replit Secrets**:

| Nome | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL gerenciada e fornecida pelo Replit. |
| `ADMIN_TOKEN` | Token aleatório forte, com pelo menos 32 caracteres. Autoriza todas as rotas administrativas e o WebSocket. |
| `SESSION_SECRET` | Chave estável com pelo menos 32 caracteres. Deriva a chave AES-256-GCM usada para criptografar a sessão e as chaves do Baileys no banco. |

Não troque `SESSION_SECRET` enquanto quiser reutilizar a sessão existente do
WhatsApp. Se ela for trocada, os dados criptografados deixam de poder ser lidos;
desconecte e vincule a conta novamente.

Opcionalmente, configure `ADMIN_CORS_ORIGINS` como uma lista separada por
vírgulas de origens confiáveis do painel futuro, por exemplo
`https://painel.exemplo.com`. Sem essa configuração, chamadas sem navegador
continuam funcionando, mas origens de navegador não recebem permissão CORS.

O backend usa somente `DATABASE_URL`. As tabelas têm RLS habilitado
sem políticas públicas; somente o servidor, conectado com a credencial do banco,
tem acesso. Nunca envie `DATABASE_URL`, `ADMIN_TOKEN` ou `SESSION_SECRET` ao
cliente web.

## Banco de dados

Com `DATABASE_URL` disponível no Replit, aplique o schema:

```sh
pnpm --filter @workspace/db run push
```

O schema cria `bot_settings`, `whatsapp_sessions`, `whatsapp_auth_keys`,
`commands`, `authorized_groups`, `command_logs`, `admin_audit_logs`,
`afk_statuses` e `processed_message_events`, com índices, chaves e RLS
habilitado. As credenciais e chaves de autenticação do WhatsApp são
criptografadas com AES-256-GCM antes de serem gravadas.

## Iniciar

O workflow **API Server** inicia a API na porta configurada pelo ambiente. Para
verificar o código manualmente:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run test
```

O teste de integração do banco é executado quando `DATABASE_URL` está
disponível; ele cria e remove registros temporários ao verificar a persistência,
os comandos inativos e o isolamento do grupo de resposta.

## Parear o WhatsApp

1. Inicie o workflow **API Server**. A conexão Baileys começa automaticamente.
2. Inicie uma sessão em `POST /api/admin/session/login` com o token
   administrativo. O servidor retorna um cookie HttpOnly assinado.
3. Quando `data.qrSvg` estiver disponível, abra **Aparelhos conectados** no
   WhatsApp e leia o QR.
4. Consulte `GET /api/status` para o estado público básico ou
   `GET /api/admin/whatsapp` para os detalhes administrativos.
5. `POST /api/admin/whatsapp/disconnect` preserva a sessão para reconexão.
   Use `/restart` para reiniciar a conexão sem apagar credenciais. Somente
   `POST /api/admin/whatsapp/unlink` apaga explicitamente a sessão persistida.

O QR é temporário, nunca é registrado nos logs e só é retornado em endpoint
protegido.

## Comandos e grupos

Os grupos são descobertos quando o bot recebe mensagens e começam bloqueados.
Autorize um grupo com:

```http
POST /api/admin/groups/{groupId}/authorize
Authorization: Bearer <ADMIN_TOKEN>
```

Crie comandos sem alterar o código:

```http
POST /api/admin/commands
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json

{
  "name": "!live",
  "description": "Link da transmissão",
  "responseContent": "Acompanhe a live: https://exemplo.com"
}
```

O campo `name` pode ser enviado com ou sem `!`. As respostas aceitam `{nome}`,
`{grupo}`, `{data}` e `{hora}`. `!comandos` e `!menu` listam os comandos ativos
quando não houver um comando personalizado com o mesmo nome. Não há envio em
massa nem envio espontâneo.

`!afk [motivo]` é reservado pelo sistema. O estado é salvo por grupo e JID real
do participante. Menções são lidas de `contextInfo.mentionedJid`; quando o
próprio participante envia texto, figurinha ou outra mensagem normal no mesmo
grupo, o estado é removido e o tempo de ausência é informado. Mensagens privadas,
eventos de sistema e mensagens do próprio bot não alteram o estado.

## API administrativa

As rotas administrativas aceitam o cookie de sessão HttpOnly do painel ou
`Authorization: Bearer <ADMIN_TOKEN>` para clientes de serviço. As respostas
usam `{ "success": true, "data": ... }`; erros usam `{ "success": false,
"error": { "code": ..., "message": ... } }`.

| Método | Rota | Ação |
| --- | --- | --- |
| `POST` | `/api/admin/session/login` | Inicia sessão segura do painel |
| `GET` | `/api/admin/session` | Confirma sessão atual |
| `POST` | `/api/admin/session/logout` | Encerra sessão |
| `GET` | `/api/admin/overview` | Resumo do bot, comandos e grupos |
| `GET` | `/api/status` | Estado público sem QR |
| `GET` | `/api/qr` | QR protegido e SVG |
| `GET` | `/api/admin/whatsapp` | Estado detalhado |
| `GET` | `/api/admin/whatsapp/qr` | QR protegido e SVG |
| `POST` | `/api/admin/whatsapp/connect` | Inicia/reinicia a conexão |
| `POST` | `/api/admin/whatsapp/disconnect` | Desconecta e preserva a sessão |
| `POST` | `/api/admin/whatsapp/restart` | Reinicia sem apagar a sessão |
| `POST` | `/api/admin/whatsapp/unlink` | Apaga a sessão por ação explícita |
| `GET`, `POST` | `/api/admin/commands` | Lista/cria comandos |
| `PATCH`, `DELETE` | `/api/admin/commands/{id}` | Edita/exclui comando |
| `POST` | `/api/admin/commands/{id}/activate` | Ativa comando |
| `POST` | `/api/admin/commands/{id}/deactivate` | Desativa comando |
| `GET` | `/api/admin/groups` | Lista grupos descobertos |
| `POST` | `/api/admin/groups/{groupId}/authorize` | Autoriza grupo |
| `POST` | `/api/admin/groups/{groupId}/block` | Bloqueia grupo |
| `GET` | `/api/admin/command-logs` | Histórico, com filtros e limite |
| `GET` WebSocket | `/api/ws` | Eventos em tempo real autenticados |

O WebSocket pede autenticação após conectar. Envie primeiro
`{"type":"auth","token":"<ADMIN_TOKEN>"}`. Eventos: `qr.updated`,
`whatsapp.connected`, `whatsapp.disconnected`, `whatsapp.reconnecting`,
`command.received`, `command.executed` e `connection.error`.

O contrato completo também está em `lib/api-spec/openapi.yaml`.
