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

    console.log("Discord bot ready")

    startMinecraftBotSafe(client)

})

client.on("error", (err) => {
    logger.error(`Discord client error: ${err.message}`)
})

client.on("shardError", (err) => {
    logger.error(`Discord shard error: ${err.message}`)
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

if (configValidation.isValid) {
    logger.info("Attempting Discord login...")
    client.login(config.discordToken)
        .then(() => {
            logger.info("Discord login request accepted")
        })
        .catch((err) => {
            logger.error(`Discord login failed: ${err.message}`)
        })
}

module.exports = client