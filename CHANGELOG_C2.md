# CHANGELOG — Components v2 Migration (discord.js bot)

## Arquivos novos

| Arquivo | Descrição |
|---------|-----------|
| `utils/cv2.js` | Helper central para Components v2: `box()`, `build()`, `text()`, `sep()`, `section()`, `thumb()`, `c2()`, `ephemeral()` |

## Mudanças por arquivo

### `utils/embedBuilder.js`
Adicionadas funções `build*C2()` paralelas a cada `create*Embed()`:
- `buildTicketPanelC2(guild)` → Container com layout do painel
- `buildTicketC2(type, user)` → Container do ticket aberto
- `buildAnnouncementReviewC2(data, user)` → Container de revisão (staff)
- `buildPublicAnnouncementC2(ann, user, rating)` → Container do anúncio público com Thumbnail da skin
- `buildNegotiationC2(ann, buyer, seller)` → Container de negociação com Thumbnail
- `buildSaleCompletedC2(ann, buyer, seller)` → Container de venda concluída
- `buildStaffPanelC2(guild, stats, ...)` → Container do painel staff com Thumbnail do ícone
- `buildBlacklistPanelC2(blacklist)` → Container da blacklist
- `buildMeusAnunciosC2(user, all)` → Container de lista de anúncios com avatar
- `buildAnuncioDetailC2(a, reservation, autoBump)` → Container de detalhe com skin
- `buildAlertasPanelC2(user, alerts)` → Container de alertas
- `buildFavoritosPanelC2(user, favorites)` → Container de favoritos

### `utils/pagination.js`
- `createPaginatedEmbed()` → retorna `container` (ContainerBuilder) em vez de `embed`
- `handlePageButton()` → edita com `components: [container, ...rows]` + `C2_FLAG`

### `handlers/negotiationHandler.js` ⭐ maior mudança
- **8 botões em 3 rows → Select Menu** `neg_actions` com 7 opções
- Ações: Enviar Comprovante, Ver Comprovantes, Fazer Oferta, Confirmar Entrega, Confirmar Recebimento, Chamar Staff, Solicitar Intermediário
- **Mantidos como botões:** ✅ Venda Concluída | ❌ Cancelar (ações irreversíveis)
- Embeds de escrow, intermediário e venda concluída → `box()` C2

### `handlers/meusAnunciosHandler.js` ⭐
- **5-6 botões em 2 rows → Select Menu** `man_actions_<id>` com ações contextuais
- Opções dinâmicas: Editar, Bump (se disponível), Reservar/Cancelar Reserva, Auto-Bump on/off, Deletar
- `buildMeusAnunciosC2` e `buildAnuncioDetailC2` com Thumbnail da skin Minecraft

### `handlers/ticketHandler.js`
- Painel de ticket → `buildTicketPanelC2()` Container
- Mensagem inicial do ticket → `buildTicketC2()` Container
- Notas de "assumiu ticket", "add user", "call criada" → `box()` C2

### `handlers/staffHandler.js`
- Painel principal → `buildStaffPanelC2()` Container com Thumbnail do ícone do servidor
- Blacklist → `buildBlacklistPanelC2()` Container
- Stats, Weekly Report, Suspicious, Pending, Config → `box()` C2

### `handlers/anuncioHandler.js`
- Review embed (staff) → `buildAnnouncementReviewC2()` Container com Thumbnail
- Anúncio público → `buildPublicAnnouncementC2()` Container com skin Minecraft

### `handlers/alertasHandler.js`
- Painel de alertas → `buildAlertasPanelC2()` Container

### `handlers/favoritosHandler.js`
- Lista de favoritos → `buildFavoritosPanelC2()` Container

### `handlers/salesHandler.js`
- Embed de oferta → `box()` Container markdown

## Regras de uso

```js
import { box, build, text, sep, section, thumb, C2_FLAG, C2_EPHEMERAL } from '../utils/cv2.js'

// Resposta simples (não-ephemeral)
await interaction.reply({ components: [box("## Título\n\nConteúdo", 0x5865F2)], flags: C2_FLAG })

// Resposta ephemeral
await interaction.editReply({ components: [box("Conteúdo")], flags: C2_EPHEMERAL })

// Container com Section + Thumbnail + ActionRow
const container = build([
  section("Texto aqui", thumb("https://url")),
  sep(),
  new ActionRowBuilder().addComponents(btn1, btn2),
], 0x00D166)
await channel.send({ components: [container], flags: C2_FLAG })
```

> ⚠️ `MessageFlags.IsComponentsV2` é obrigatório em todas as mensagens C2.
> Não misture `embeds: []` com `components: [ContainerBuilder]`.
> DMs mantêm `EmbedBuilder` para compatibilidade.
