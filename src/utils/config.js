require("dotenv").config()

function parseBoolean(value, defaultValue = false) {
    if (value === undefined) return defaultValue

    const normalized = String(value).trim().toLowerCase()
    return ["1", "true", "yes", "on"].includes(normalized)
}

const LATEST_BEDROCK_VERSION = "1.26.0"

function parsePort(value, defaultPort = 19132) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultPort
}

const config = {
    discordToken: process.env.DISCORD_TOKEN,
    server: process.env.MC_SERVER,
    port: parsePort(process.env.MC_PORT),
    username: process.env.MC_USERNAME,
    mcVersion: process.env.MC_VERSION?.trim() || LATEST_BEDROCK_VERSION,
    mcSkipPing: parseBoolean(process.env.MC_SKIP_PING, false),

    logChannel: process.env.LOG_CHANNEL_ID,
    chatChannel: process.env.CHAT_CHANNEL_ID,
    chatWebhook: process.env.CHAT_WEBHOOK_URL,

    joinCommand: process.env.JOIN_COMMAND
}

function validateRequiredConfig() {
    const required = [
        ["DISCORD_TOKEN", config.discordToken],
        ["MC_SERVER", config.server],
        ["MC_USERNAME", config.username]
    ]

    const missing = required
        .filter(([, value]) => !value || String(value).trim() === "")
        .map(([key]) => key)

    return {
        isValid: missing.length === 0,
        missing
    }
}

module.exports = {
    ...config,
    validateRequiredConfig
}