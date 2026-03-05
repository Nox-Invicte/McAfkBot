require("dotenv").config()

module.exports = {
    discordToken: process.env.DISCORD_TOKEN,
    server: process.env.MC_SERVER,
    port: Number(process.env.MC_PORT),
    username: process.env.MC_USERNAME,

    logChannel: process.env.LOG_CHANNEL_ID,
    chatChannel: process.env.CHAT_CHANNEL_ID,
    chatWebhook: process.env.CHAT_WEBHOOK_URL,

    joinCommand: process.env.JOIN_COMMAND
}