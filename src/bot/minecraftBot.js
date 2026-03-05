const bedrock = require("bedrock-protocol")
const { Authflow } = require("prismarine-auth")
const fs = require("fs")
const path = require("path")

const config = require("../utils/config")
const logger = require("../utils/logger")

const { sendLog } = require("../handlers/logHandler")
const { sendChat } = require("../handlers/chatHandler")

let mcClient = null

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

    mcClient = bedrock.createClient({
        host: config.server,
        port: config.port,
        username: config.username,
        profilesFolder: "./auth",
        flow: "live",
        authTitle: "00000000441cc96b",
        skipPing: true
    })

    mcClient.on("spawn", () => {

        logger.info("Player spawned")
        sendLog(discordClient,"✅ Spawned in Minecraft server")

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

                    sendLog(discordClient,`⚡ Sent command: ${config.joinCommand}`)
                } catch(err) {
                    logger.error(`Error sending command: ${err.message}`)
                    sendLog(discordClient,`❌ Failed to send command: ${err.message}`)
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

        logger.info(`[MC Chat] ${cleanMessage}`)
        sendChat(discordClient, cleanMessage)

    })

    mcClient.on("disconnect",(reason)=>{

        logger.warn("Disconnected")

        sendLog(discordClient,`❌ Disconnected: ${reason}`)

        mcClient = null

        setTimeout(()=>{

            sendLog(discordClient,"🔄 Reconnecting...")

            startMinecraftBot(discordClient)

        },10000)

    })

    mcClient.on("error",(err)=>{

        logger.error(err.message)

        sendLog(discordClient,`⚠️ Error: ${err.message}`)

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