# 🤖 Bot Discord — Marketplace de Contas Minecraft

Bot para gerenciar anúncios, negociações, tickets e reputação de contas Minecraft.

---

## 📋 Pré-requisitos

- **Node.js** >= 22.13.0
- **npm** (incluso com o Node.js)
- **PM2** (para produção): `npm install -g pm2`
- Um **Bot de Discord** criado no [Discord Developer Portal](https://discord.com/developers/applications)

---

## ⚙️ Configuração

### 1. Instalar dependências

```bash
npm install
```

### 2. Criar os canais no seu servidor Discord

Crie os seguintes canais antes de configurar:

| Canal | Finalidade |
|---|---|
| `#anuncios` | Anúncios públicos de contas |
| `#logs` | Logs internos do bot |
| `#antiscam` | Alertas de atividade suspeita |
| `#vendas` | Confirmações públicas de venda |
| `#arquivo-midia` | Armazena screenshots dos anúncios (pode ser privado) |

> O canal `#arquivo-midia` deve ser **visível apenas para o bot e staff**. As fotos dos anúncios são salvas lá para não expirarem.

### 3. Preencher o arquivo `.env`

```env
# ── CREDENCIAIS DO BOT ─────────────────────────────────────────────
DISCORD_TOKEN=seu_token_aqui
DISCORD_CLIENT_ID=seu_client_id
DISCORD_GUILD_ID=id_do_servidor

# ── IDs DE CANAIS (botão direito no canal → Copiar ID) ─────────────
CHANNEL_ANUNCIOS=
CHANNEL_LOGS=
CHANNEL_ANTISCAM=
CHANNEL_VENDAS=
CHANNEL_MEDIA_ARCHIVE=

# ── IDs DE CARGOS ──────────────────────────────────────────────────
ROLE_STAFF=

# ── IDs DE CATEGORIAS ──────────────────────────────────────────────
CATEGORY_TICKETS=
CATEGORY_NEGOCIACOES=

# ── OPCIONAIS ──────────────────────────────────────────────────────
HEALTHCHECK_PORT=3000
DEBUG=false
```

> **Nenhum ID vai mais no `config.json`** — tudo fica no `.env` para maior segurança.

### 4. Iniciar o bot

```bash
npm start
```

### 5. Configurar o painel de tickets

No Discord, use o comando:
```
/setuppainel #seu-canal
```

---

## 🚀 Produção com PM2

```bash
npm run start:prod   # iniciar
npm run logs         # ver logs
npm run restart      # reiniciar
npm run stop         # parar
pm2 startup          # iniciar no boot
pm2 save
```

---

## 📦 Funcionalidades

- **Tickets** — Suporte, Dúvidas, Denúncia, Anunciar Conta
- **Anúncios** — Com screenshot obrigatória, validação de tamanho, foto persistente
- **Negociações** — Canal privado, escrow, comprovante PIX verificado
- **Canal de Vendas** — Toda venda confirmada é postada publicamente
- **Reputação** — Avaliação pós-venda, ranking, perfil
- **Alertas & Favoritos** — Notificações automáticas; vendedor é avisado quando alguém favorita
- **Anti-Scam** — Blacklist, UUID duplicado, PIX verificado, flood de tickets bloqueado
- **Staff** — Painel unificado, blacklist, config, estatísticas

---

## 🔑 Permissões necessárias no Discord

- Ler e enviar mensagens
- Gerenciar canais e cargos
- Usar comandos de barra (Slash Commands)
- Anexar arquivos / Embeds

---

## 🩺 Healthcheck

```
GET http://localhost:3000/health
```

---

## ❓ Primeiro uso — passo a passo

1. Crie os 5 canais listados acima no servidor
2. Preencha o `.env` com todos os IDs
3. `npm install && npm start`
4. `/setuppainel #seu-canal`
5. Pronto!
