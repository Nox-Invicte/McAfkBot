const { Client, Intents } = require("discord.js")
const https = require("https")
const crypto = require("crypto")

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
const DISCORD_PREFLIGHT_TIMEOUT_MS = Number(process.env.DISCORD_PREFLIGHT_TIMEOUT_MS || 10000)
const DISCORD_PREFLIGHT_MAX_RETRIES = Number(process.env.DISCORD_PREFLIGHT_MAX_RETRIES || 2)
const DISCORD_LOGIN_MAX_ATTEMPTS = Number(process.env.DISCORD_LOGIN_MAX_ATTEMPTS || 0)
const DISCORD_LOGIN_RETRY_BASE_MS = Number(process.env.DISCORD_LOGIN_RETRY_BASE_MS || 3000)
const DISCORD_LOGIN_RETRY_MAX_MS = Number(process.env.DISCORD_LOGIN_RETRY_MAX_MS || 60000)
const DISCORD_STARTUP_JITTER_MAX_MS = Number(process.env.DISCORD_STARTUP_JITTER_MAX_MS || 10000)

function getTokenFingerprint(token) {
    if (!token) return "none"
    return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12)
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseJsonSafe(value) {
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function getRetryDelayMs(response) {
    const body = parseJsonSafe(response.body)

    const retryAfterSeconds = Number(body?.retry_after)
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return Math.max(1000, Math.ceil(retryAfterSeconds * 1000))
    }

    return 3000
}

function getLoginRetryDelayMs(attemptNumber) {
    const exponential = DISCORD_LOGIN_RETRY_BASE_MS * Math.pow(2, Math.max(0, attemptNumber - 1))
    const capped = Math.min(exponential, DISCORD_LOGIN_RETRY_MAX_MS)
    const jitter = Math.floor(Math.random() * 1000)
    return capped + jitter
}

function shouldRetryLogin(errorMessage) {
    const normalized = String(errorMessage || "").toLowerCase()

    if (normalized.includes("401") || normalized.includes("invalid token") || normalized.includes("rejected by discord api")) {
        return false
    }

    return [
        "timed out",
        "429",
        "econnreset",
        "etimedout",
        "eai_again",
        "enotfound",
        "gateway"
    ].some((term) => normalized.includes(term))
}

function discordApiRequest(pathname) {
    return new Promise((resolve, reject) => {
        const request = https.request(
            {
                hostname: "discord.com",
                path: pathname,
                method: "GET",
                headers: {
                    Authorization: `Bot ${config.discordToken}`
                }
            },
            (res) => {
                let body = ""
                res.on("data", (chunk) => {
                    body += chunk
                })
                res.on("end", () => {
                    resolve({
                        status: res.statusCode || 0,
                        body
                    })
                })
            }
        )

        request.on("error", (err) => {
            reject(err)
        })

        request.setTimeout(DISCORD_PREFLIGHT_TIMEOUT_MS, () => {
            request.destroy(new Error(`Request timeout after ${DISCORD_PREFLIGHT_TIMEOUT_MS}ms`))
        })

        request.end()
    })
}

async function runDiscordPreflight() {
    logger.info(`Discord API preflight check (timeout: ${DISCORD_PREFLIGHT_TIMEOUT_MS}ms)...`)

    async function checkEndpoint({ name, path, onSuccessMessage }) {
        let response = null

        for (let attempt = 0; attempt <= DISCORD_PREFLIGHT_MAX_RETRIES; attempt++) {
            response = await discordApiRequest(path)

            if (response.status === 429) {
                const waitMs = getRetryDelayMs(response)

                if (attempt < DISCORD_PREFLIGHT_MAX_RETRIES) {
                    logger.warn(`${name} preflight rate-limited (429). Retrying in ${waitMs}ms...`)
                    await sleep(waitMs)
                    continue
                }

                logger.warn(`${name} preflight still rate-limited after retries. Continuing with login attempt.`)
                return
            }

            if (response.status === 401) {
                throw new Error("DISCORD_TOKEN rejected by Discord API (401 Unauthorized)")
            }

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Discord API preflight failed for ${path} with status ${response.status}`)
            }

            logger.info(onSuccessMessage)
            return
        }
    }

    await checkEndpoint({
        name: "/users/@me",
        path: "/api/v10/users/@me",
        onSuccessMessage: "Discord token accepted by API"
    })

    await checkEndpoint({
        name: "/gateway/bot",
        path: "/api/v10/gateway/bot",
        onSuccessMessage: "Discord gateway endpoint reachable via HTTPS"
    })
}

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
    await runDiscordPreflight()

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

async function startDiscordWithRetry() {
    logger.info(`Discord token fingerprint: ${getTokenFingerprint(config.discordToken)} (len=${config.discordToken?.length || 0})`)

    if (DISCORD_STARTUP_JITTER_MAX_MS > 0) {
        const jitterMs = Math.floor(Math.random() * DISCORD_STARTUP_JITTER_MAX_MS)
        if (jitterMs > 0) {
            logger.info(`Applying startup jitter of ${jitterMs}ms before Discord login`)
            await sleep(jitterMs)
        }
    }

    let attempt = 1

    while (true) {
        try {
            const attemptLabel = DISCORD_LOGIN_MAX_ATTEMPTS > 0
                ? `${attempt}/${DISCORD_LOGIN_MAX_ATTEMPTS}`
                : `${attempt}`

            logger.info(`Discord login attempt ${attemptLabel}`)
            await loginDiscordWithTimeout()
            return
        } catch (err) {
            const errorMessage = err?.message || String(err)
            const retryable = shouldRetryLogin(errorMessage)
            const reachedMax = DISCORD_LOGIN_MAX_ATTEMPTS > 0 && attempt >= DISCORD_LOGIN_MAX_ATTEMPTS

            logger.error(`Discord login failed on attempt ${attempt}: ${errorMessage}`)

            if (!retryable || reachedMax) {
                throw err
            }

            const waitMs = getLoginRetryDelayMs(attempt)
            logger.warn(`Retrying Discord login in ${waitMs}ms...`)

            try {
                client.destroy()
            } catch {
                // Ignore destroy failures between retry attempts.
            }

            await sleep(waitMs)
            attempt += 1
        }
    }
}

if (configValidation.isValid) {
    startDiscordWithRetry().catch((err) => {
        logger.error(`Discord login failed: ${err.message}`)
        logger.error("Troubleshooting: if preflight passed but login timed out, check outbound websocket access to gateway.discord.gg:443 and reduce simultaneous startups")
    })
}

module.exports = client