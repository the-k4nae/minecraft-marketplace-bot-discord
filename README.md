# minecraft-marketplace-bot

Bot Discord completo para compra e venda de contas Minecraft. Sistema de anúncios com skin do player, tickets de suporte, fluxo de negociação com escrow, verificação de pagamento via Pix e painel de moderação para staff.

## Funcionalidades

- **Anúncios** — criação, edição, bump manual e auto-bump de contas Minecraft com exibição da skin
- **Negociação** — fluxo completo com escrow, envio de comprovante, ofertas, confirmação de entrega e recebimento
- **Tickets** — sistema de suporte com transcrição automática
- **Verificação Pix** — confirmação de pagamento com comprovante
- **Painel Staff** — moderação de anúncios, blacklist, intermediação de negociações
- **Favoritos & Alertas** — usuários salvam anúncios e recebem notificações de preço
- **Meus Anúncios** — painel pessoal com ações contextuais via select menu
- **Paginação** — listagens com navegação por botões
- **Backup automático** — cópia periódica do banco SQLite
- **Healthcheck HTTP** — endpoint para monitoramento de uptime
- **Discord Components v2** — UI moderna com containers, thumbnails e select menus

## Stack

- **discord.js v14**
- **better-sqlite3** — banco de dados local
- **node-cron** — agendador de tarefas (auto-bump, limpeza, backup)
- **PM2** — gerenciamento de processo em produção
- **Node.js ≥ 22.13**

## Instalação

```bash
npm install
```

Crie um arquivo `.env` na raiz:

```env
DISCORD_TOKEN=seu_token_aqui
DISCORD_CLIENT_ID=id_do_bot
DISCORD_GUILD_ID=id_do_servidor
HEALTHCHECK_PORT=3000
DEBUG=false
```

## Uso

```bash
# Desenvolvimento (hot reload)
npm run dev

# Produção simples
npm start

# Produção com PM2
npm run start:prod

# Ver logs
npm run logs

# Monitorar
npm run monit
```

## Estrutura

```
├── index.js                  # Entry point
├── commands/
│   └── setuppainel.js        # Comando de setup do painel
├── handlers/
│   ├── anuncioHandler.js     # Criação e edição de anúncios
│   ├── negotiationHandler.js # Fluxo de negociação e escrow
│   ├── ticketHandler.js      # Sistema de tickets
│   ├── salesHandler.js       # Conclusão de vendas
│   ├── pixVerificationHandler.js  # Verificação de Pix
│   ├── staffHandler.js       # Moderação e painel staff
│   ├── meusAnunciosHandler.js     # Painel pessoal
│   ├── favoritosHandler.js   # Favoritos
│   ├── alertasHandler.js     # Alertas de preço
│   └── commandHandler.js     # Roteador de comandos
├── utils/
│   ├── database.js           # SQLite com migrations e prepared statements
│   ├── embedBuilder.js       # Builders de embed e Components v2
│   ├── cv2.js                # Helpers para Components v2
│   ├── scheduler.js          # Tarefas agendadas
│   ├── backup.js             # Backup automático do banco
│   ├── healthcheck.js        # Servidor HTTP de healthcheck
│   ├── minecraftAPI.js       # Integração com API do Minecraft
│   ├── pagination.js         # Paginação de listagens
│   ├── transcript.js         # Transcrição de tickets
│   ├── cooldown.js           # Sistema de cooldown
│   └── logger.js             # Logger estruturado
└── events/
    ├── ready.js              # Evento de inicialização
    └── interactionCreate.js  # Roteador de interações
## Autor

**K4NAE** — [github.com/the-k4nae](https://github.com/the-k4nae)
