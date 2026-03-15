import { ActivityType } from "discord.js"
import { getStats } from "../utils/database.js"

export default function ready(client) {
  console.log(`Bot logado como ${client.user.tag}`)

  const statusList = [
    { name: "Sistema de Tickets", type: ActivityType.Watching },
    { name: "Anuncios de Contas", type: ActivityType.Watching },
    { name: "Protegendo o servidor", type: ActivityType.Playing },
    { name: "Atendendo tickets", type: ActivityType.Playing },
    () => {
      const stats = getStats()
      return { name: `${stats.activeAnnouncements} anuncios ativos`, type: ActivityType.Watching }
    },
    () => {
      const stats = getStats()
      return { name: `${stats.soldAnnouncements} vendas realizadas`, type: ActivityType.Watching }
    },
  ]

  let currentIndex = 0

  function updateStatus() {
    try {
      const entry = statusList[currentIndex]
      const status = typeof entry === "function" ? entry() : entry
      client.user.setActivity(status.name, { type: status.type })
      currentIndex = (currentIndex + 1) % statusList.length
    } catch (error) {
      console.error("Erro ao atualizar status:", error)
    }
  }

  updateStatus()
  const statusInterval = setInterval(updateStatus, 30000)

  // FIX B-1: Expor referência para limpeza se necessário
  client._statusInterval = statusInterval
}
