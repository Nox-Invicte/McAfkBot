const bedrock = require("bedrock-protocol")
const { Authflow } = require("prismarine-auth")
const fs = require("fs")
const path = require("path")

const config = require("../utils/config")
const logger = require("../utils/logger")

const { sendLog } = require("../handlers/logHandler")
const { sendChat } = require("../handlers/chatHandler")

let mcClient = null
let activeDiscordClient = null
const lastErrorLogTime = new Map()
const suppressedNonFatalErrors = new Set()

const NON_FATAL_ERROR_PATTERNS = [
    /Read error for undefined\s*:\s*Invalid tag:\s*\d+\s*>\s*20/i
]

const SMALL_CAPS_MAP = {
    "ᴀ": "a", "ʙ": "b", "ᴄ": "c", "ᴅ": "d", "ᴇ": "e", "ꜰ": "f",
    "ɢ": "g", "ʜ": "h", "ɪ": "i", "ᴊ": "j", "ᴋ": "k", "ʟ": "l",
    "ᴍ": "m", "ɴ": "n", "ᴏ": "o", "ᴘ": "p", "ǫ": "q", "ʀ": "r",
    "ꜱ": "s", "ᴛ": "t", "ᴜ": "u", "ᴠ": "v", "ᴡ": "w", "ʏ": "y",
    "ᴢ": "z"
}

const PLAYER_CHAT_REGEX = /^(.+?)\s*(?:»|:|>)\s*(.+)$/
const FILTERED_SERVER_MESSAGE_FRAGMENTS = [
    "upgrade your island with /is upgrade",
    "break your oneblock to progress",
    "learn how to make money with /economy",
    "earn free rewards in the afk zone [/afk]",
    "view oneblock phases with /oneblock phases",
    "you can visit spawn by typing /spawn"
]

function normalizeForComparison(text) {
    const normalized = text
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()

    return Array.from(normalized)
        .map(char => SMALL_CAPS_MAP[char] || char)
        .join("")
        .replace(/&/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function shouldIgnoreIncomingMessage(message) {
    const trimmed = message.trim()
    const isServerMessage = !PLAYER_CHAT_REGEX.test(trimmed)

    if (!isServerMessage) return false

    if (trimmed.startsWith("❙")) {
        return true
    }

    const normalized = normalizeForComparison(trimmed)
    return FILTERED_SERVER_MESSAGE_FRAGMENTS.some(fragment => normalized.includes(fragment))
}

function isNonFatalMcError(message) {
    return NON_FATAL_ERROR_PATTERNS.some(pattern => pattern.test(message))
}

function shouldSkipDuplicateError(message, windowMs = 30000) {
    const now = Date.now()
    const lastLogAt = lastErrorLogTime.get(message)

    if (lastLogAt && now - lastLogAt < windowMs) {
        return true
    }

    lastErrorLogTime.set(message, now)

    // Keep map size bounded for long-running processes.
    if (lastErrorLogTime.size > 200) {
        const entries = Array.from(lastErrorLogTime.entries())
            .sort((a, b) => a[1] - b[1])
            .slice(0, 50)

        for (const [key] of entries) {
            lastErrorLogTime.delete(key)
        }
    }

    return false
}

// Restore auth files from environment variables
function restoreAuthFromEnv() {
    const authDir = path.join(__dirname, "../../auth")
    
    // Create auth directory if it doesn't exist
    if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true })
    }
    
    // Check if auth files already exist
    const authFiles = ['df0382_bed-cache.json', 'df0382_live-cache.json', 'df0382_msal-cache.json', 'df0382_xbl-cache.json']
    const allFilesExist = authFiles.every(file => fs.existsSync(path.join(authDir, file)))
    
    if (allFilesExist) {
        logger.info("Auth files already exist, skipping restore")
        return
    }
    
    // Restore from environment variables if they exist
    const authEnvVars = {
        'AUTH_BED': 'df0382_bed-cache.json',
        'AUTH_LIVE': 'df0382_live-cache.json',
        'AUTH_MSAL': 'df0382_msal-cache.json',
        'AUTH_XBL': 'df0382_xbl-cache.json'
    }
    
    let restored = false
    for (const [envVar, filename] of Object.entries(authEnvVars)) {
        if (process.env[envVar]) {
            try {
                const content = Buffer.from(process.env[envVar], 'base64').toString('utf8')
                fs.writeFileSync(path.join(authDir, filename), content)
                restored = true
            } catch (err) {
                logger.error(`Failed to restore ${filename}: ${err.message}`)
            }
        }
    }
    
    if (restored) {
        logger.info("Auth files restored from environment variables")
    }
}

async function startMinecraftBot(discordClient){

    if (discordClient) {
        activeDiscordClient = discordClient
    }

    if(mcClient) return

    logger.info("Starting Minecraft bot")
    
    // Restore auth from environment variables
    restoreAuthFromEnv()

    const auth = new Authflow(
        config.username,
        "./auth",
        { 
            flow: "live",
            authTitle: "00000000441cc96b"
        }
    )

    if (config.mcVersion) {
        logger.info(`Using pinned Bedrock version: ${config.mcVersion}`)
    } else if (!config.mcSkipPing) {
        logger.info("Bedrock version auto-detection is enabled")
    } else {
        logger.warn("Using default Bedrock protocol version because MC_SKIP_PING is enabled and MC_VERSION is not set")
    }

    mcClient = bedrock.createClient({
        host: config.server,
        port: config.port,
        username: config.username,
        version: config.mcVersion,
        profilesFolder: "./auth",
        flow: "live",
        authTitle: "00000000441cc96b",
        skipPing: config.mcSkipPing
    })

    mcClient.on("spawn", () => {

        logger.info("Player spawned")
        sendLog(activeDiscordClient,"✅ Spawned in Minecraft server")

        setTimeout(()=>{

            if(config.joinCommand){

                logger.info(`Executing join command: ${config.joinCommand}`)

                try {
                    mcClient.queue("text",{
                        type: "chat",
                        needs_translation: false,
                        source_name: config.joinCommand,
                        xuid: "",
                        platform_chat_id: "",
                        message: config.joinCommand
                    })

                    sendLog(activeDiscordClient,`⚡ Sent command: ${config.joinCommand}`)
                } catch(err) {
                    logger.error(`Error sending command: ${err.message}`)
                    sendLog(activeDiscordClient,`❌ Failed to send command: ${err.message}`)
                }

            } else {
                logger.warn("No join command configured")
            }

        },10000)

    })

    mcClient.on("text",(packet)=>{

        if(!packet.message || packet.message.trim() === "") return

        // Strip Minecraft color codes (§ followed by any character)
        const cleanMessage = packet.message.replace(/§./g, "").trim()
        
        if(cleanMessage === "") return

        if(shouldIgnoreIncomingMessage(cleanMessage)) return

        logger.info(`[MC Chat] ${cleanMessage}`)
        sendChat(activeDiscordClient, cleanMessage)

    })

    mcClient.on("disconnect",(reason)=>{

        logger.warn("Disconnected")

        sendLog(activeDiscordClient,`❌ Disconnected: ${reason}`)

        mcClient = null

        setTimeout(()=>{

            sendLog(activeDiscordClient,"🔄 Reconnecting...")

            startMinecraftBot(activeDiscordClient).catch((err) => {
                logger.error(`Reconnect attempt failed: ${err.message}`)
            })

        },10000)

    })

    mcClient.on("error",(err)=>{

        const message = err?.message || String(err)

        if (isNonFatalMcError(message)) {
            if (!suppressedNonFatalErrors.has(message)) {
                suppressedNonFatalErrors.add(message)
                logger.warn(`Suppressing non-fatal packet parse error: ${message}`)
            }
            return
        }

        if (shouldSkipDuplicateError(message)) {
            return
        }

        logger.error(message)

        sendLog(activeDiscordClient,`⚠️ Error: ${message}`)

    })

}

function stopMinecraftBot(){

    if(mcClient){

        mcClient.disconnect()
        mcClient = null

    }

}

function getStatus(){

    if(mcClient){
        return {
            connected: true,
            server: `${config.server}:${config.port}`,
            username: config.username
        }
    }

    return {
        connected: false
    }

}

function sendMessage(message){

    if(!mcClient){
        throw new Error("Not connected to Minecraft server")
    }

    try {
        mcClient.queue("text",{
            type: "chat",
            needs_translation: false,
            source_name: message,
            xuid: "",
            platform_chat_id: "",
            message: message
        })
        logger.info(`[Sent to MC] ${message}`)
        return true
    } catch(err) {
        logger.error(`Error sending message: ${err.message}`)
        throw err
    }

}

module.exports = { startMinecraftBot, stopMinecraftBot, getStatus, sendMessage }