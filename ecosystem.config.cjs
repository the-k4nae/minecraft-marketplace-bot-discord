/**
 * ecosystem.config.cjs — PM2 config
 *
 * FIX #15: Configuração de produção com PM2.
 *
 * Deploy:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup  (para iniciar no boot)
 *
 * Comandos úteis:
 *   pm2 logs bot-minecraft     # ver logs em tempo real
 *   pm2 restart bot-minecraft  # reiniciar
 *   pm2 stop bot-minecraft     # parar
 *   pm2 monit                  # painel de monitoramento
 */

module.exports = {
  apps: [
    {
      name: "bot-minecraft",
      script: "index.js",

      // Reiniciar automaticamente se crashar
      autorestart: true,
      watch: false,

      // Esperar 3s entre restarts (evita restart loop)
      restart_delay: 3000,

      // Máximo de restarts em 10min antes de parar
      max_restarts: 10,
      min_uptime: "10s",

      // Usar 1 instância (bot stateful — não usar cluster)
      instances: 1,
      exec_mode: "fork",

      // Env de produção
      env_production: {
        NODE_ENV: "production",
        HEALTHCHECK_PORT: "3000",
      },
      env_development: {
        NODE_ENV: "development",
        HEALTHCHECK_PORT: "3001",
      },

      // Rotação de logs
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
      max_size: "50M",
      retain: 7,

      // Graceful shutdown — esperar até 30s para o bot fechar limpo
      kill_timeout: 30000,
      listen_timeout: 10000,

      // Interpretar como ESModule
      node_args: "--experimental-vm-modules",
    },
  ],
}
