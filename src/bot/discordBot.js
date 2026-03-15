const { Client, Intents } = require("discord.js")

const config = require("../utils/config")
const logger = require("../utils/logger")

const { startMinecraftBot, stopMinecraftBot, getStatus, sendMessage } = require("./minecraftBot")

const configValidation = config.validateRequiredConfig()

if (!configValidation.isValid) {
    logger.error(`Missing required environment variables: ${configValidation.missing.join(", ")}`)
    logger.error("Set these variables in Render (Environment tab) and redeploy.")
}

const client = new Client({
    intents:[
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.MESSAGE_CONTENT
    ]
})

const DISCORD_LOGIN_TIMEOUT_MS = Number(process.env.DISCORD_LOGIN_TIMEOUT_MS || 30000)

function safeReply(message, content) {
    message.reply(content).catch((err) => {
        logger.error(`Failed to send Discord reply: ${err.message}`)
    })
}

function startMinecraftBotSafe(discordClient) {
    startMinecraftBot(discordClient).catch((err) => {
        logger.error(`Minecraft bot failed to start: ${err.message}`)
    })
}

client.once("ready",()=>{

    logger.info(`Discord bot ready as ${client.user?.tag || "unknown-user"}`)

    startMinecraftBotSafe(client)

})

client.on("error", (err) => {
    logger.error(`Discord client error: ${err.message}`)
})

client.on("warn", (warning) => {
    logger.warn(`Discord client warning: ${warning}`)
})

client.on("shardError", (err) => {
    logger.error(`Discord shard error: ${err.message}`)
})

client.on("invalidated", () => {
    logger.error("Discord session invalidated. Token may have been rotated.")
})

client.on("messageCreate",(msg)=>{

    if(msg.author.bot) return

    if(msg.content === "!start"){

        startMinecraftBotSafe(client)
        safeReply(msg, "Minecraft bot started")

    }

    if(msg.content === "!stop"){

        stopMinecraftBot()
        safeReply(msg, "Minecraft bot stopped")

    }

    if(msg.content === "!status"){

        const status = getStatus()

        if(status.connected){
            safeReply(msg, `🟢 Connected to ${status.server} as ${status.username}`)
        } else {
            safeReply(msg, "🔴 Not connected to Minecraft server")
        }

    }

    if(msg.content.startsWith("!send ")){

        const message = msg.content.substring(6)

        if(!message || message.trim() === ""){
            safeReply(msg, "⚠️ Please provide a message to send")
            return
        }

        try {
            sendMessage(message)
            safeReply(msg, `✅ Sent: ${message}`)
        } catch(err) {
            safeReply(msg, `❌ Error: ${err.message}`)
        }

    }

})

async function loginDiscordWithTimeout() {
    logger.info(`Attempting Discord login (timeout: ${DISCORD_LOGIN_TIMEOUT_MS}ms)...`)

    const loginPromise = client.login(config.discordToken)
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Discord login timed out after ${DISCORD_LOGIN_TIMEOUT_MS}ms`))
        }, DISCORD_LOGIN_TIMEOUT_MS)
    })

    await Promise.race([loginPromise, timeoutPromise])
    logger.info("Discord login request accepted")
}

if (configValidation.isValid) {
    loginDiscordWithTimeout().catch((err) => {
        logger.error(`Discord login failed: ${err.message}`)
        logger.error("Troubleshooting: verify DISCORD_TOKEN is current, has no quotes/prefix, and host can reach discord.com")
    })
}

module.exports = client