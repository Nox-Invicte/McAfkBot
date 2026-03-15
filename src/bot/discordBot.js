const { Client, Intents } = require("discord.js")
const https = require("https")
const crypto = require("crypto")

const config = require("../utils/config")
const logger = require("../utils/logger")

const { startMinecraftBot, stopMinecraftBot, getStatus, sendMessage } = require("./minecraftBot")

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
const DISCORD_PREFLIGHT_COOLDOWN_MS = Number(process.env.DISCORD_PREFLIGHT_COOLDOWN_MS || 300000)
const DISCORD_PREFLIGHT_MAX_WAIT_MS = Number(process.env.DISCORD_PREFLIGHT_MAX_WAIT_MS || 120000)
const DISCORD_LOGIN_MAX_ATTEMPTS = 3
const DISCORD_LOGIN_RETRY_BASE_MS = Number(process.env.DISCORD_LOGIN_RETRY_BASE_MS || 3000)
const DISCORD_LOGIN_RETRY_MAX_MS = Number(process.env.DISCORD_LOGIN_RETRY_MAX_MS || 60000)
const DISCORD_STARTUP_JITTER_MAX_MS = Number(process.env.DISCORD_STARTUP_JITTER_MAX_MS || 10000)
const MINECRAFT_START_DELAY_MS = 30000

const hasDiscordToken = Boolean(config.discordToken && String(config.discordToken).trim() !== "")
const missingMinecraftConfig = []

if (!config.server || String(config.server).trim() === "") {
    missingMinecraftConfig.push("MC_SERVER")
}

if (!config.username || String(config.username).trim() === "") {
    missingMinecraftConfig.push("MC_USERNAME")
}

const canStartMinecraft = missingMinecraftConfig.length === 0

if (!hasDiscordToken) {
    logger.warn("DISCORD_TOKEN is missing. Discord login will be skipped.")
}

if (!canStartMinecraft) {
    logger.error(`Minecraft startup disabled. Missing required environment variables: ${missingMinecraftConfig.join(", ")}`)
}

let preflightCooldownUntil = 0

function clampWaitMs(valueMs, fallbackMs = 3000) {
    if (!Number.isFinite(valueMs) || valueMs < 0) return fallbackMs
    return Math.min(Math.max(1000, Math.ceil(valueMs)), DISCORD_PREFLIGHT_MAX_WAIT_MS)
}

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
    const retryAfterHeader = response.headers?.["retry-after"]
    if (retryAfterHeader !== undefined) {
        const retryAfterNumeric = Number(retryAfterHeader)
        if (Number.isFinite(retryAfterNumeric) && retryAfterNumeric >= 0) {
            // Some proxies send retry-after as milliseconds while RFC uses seconds.
            const interpretedMs = retryAfterNumeric > 1000
                ? retryAfterNumeric
                : retryAfterNumeric * 1000

            return clampWaitMs(interpretedMs)
        }

        const retryAfterDate = Date.parse(String(retryAfterHeader))
        if (Number.isFinite(retryAfterDate)) {
            return clampWaitMs(retryAfterDate - Date.now())
        }
    }

    const resetAfterHeader = Number(response.headers?.["x-ratelimit-reset-after"])
    if (Number.isFinite(resetAfterHeader) && resetAfterHeader >= 0) {
        return clampWaitMs(resetAfterHeader * 1000)
    }

    const body = parseJsonSafe(response.body)

    const retryAfterSeconds = Number(body?.retry_after)
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
        return clampWaitMs(retryAfterSeconds * 1000)
    }

    return clampWaitMs(3000)
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
                        body,
                        headers: res.headers || {}
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
    const now = Date.now()
    if (preflightCooldownUntil > now) {
        const remainingMs = preflightCooldownUntil - now
        const err = new Error(`Discord preflight cooldown active after repeated 429 responses (${Math.ceil(remainingMs / 1000)}s remaining)`)
        err.retryAfterMs = remainingMs
        throw err
    }

    logger.info(`Discord API preflight check (timeout: ${DISCORD_PREFLIGHT_TIMEOUT_MS}ms)...`)

    async function checkEndpoint({ name, path, onSuccessMessage }) {
        let response = null
        let last429WaitMs = 0

        for (let attempt = 0; attempt <= DISCORD_PREFLIGHT_MAX_RETRIES; attempt++) {
            response = await discordApiRequest(path)

            if (response.status === 429) {
                const waitMs = getRetryDelayMs(response)
                last429WaitMs = Math.max(last429WaitMs, waitMs)

                if (attempt < DISCORD_PREFLIGHT_MAX_RETRIES) {
                    logger.warn(`${name} preflight rate-limited (429). Retrying in ${waitMs}ms...`)
                    await sleep(waitMs)
                    continue
                }

                logger.warn(`${name} preflight still rate-limited after retries.`)
                return {
                    rateLimited: true,
                    waitMs: last429WaitMs
                }
            }

            if (response.status === 401) {
                throw new Error("DISCORD_TOKEN rejected by Discord API (401 Unauthorized)")
            }

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Discord API preflight failed for ${path} with status ${response.status}`)
            }

            logger.info(onSuccessMessage)
            return {
                rateLimited: false,
                waitMs: 0
            }
        }

        return {
            rateLimited: false,
            waitMs: 0
        }
    }

    const meResult = await checkEndpoint({
        name: "/users/@me",
        path: "/api/v10/users/@me",
        onSuccessMessage: "Discord token accepted by API"
    })

    const gatewayResult = await checkEndpoint({
        name: "/gateway/bot",
        path: "/api/v10/gateway/bot",
        onSuccessMessage: "Discord gateway endpoint reachable via HTTPS"
    })

    if (meResult.rateLimited || gatewayResult.rateLimited) {
        const cooldownMs = Math.max(
            DISCORD_PREFLIGHT_COOLDOWN_MS,
            meResult.waitMs || 0,
            gatewayResult.waitMs || 0
        )

        preflightCooldownUntil = Date.now() + cooldownMs

        const err = new Error(`Discord API preflight repeatedly rate-limited (429). Cooling down for ${Math.ceil(cooldownMs / 1000)}s before next attempt`)
        err.retryAfterMs = cooldownMs
        throw err
    }
}

function safeReply(message, content) {
    message.reply(content).catch((err) => {
        logger.error(`Failed to send Discord reply: ${err.message}`)
    })
}

function startMinecraftBotSafe(discordClient) {
    if (!canStartMinecraft) return

    startMinecraftBot(discordClient).catch((err) => {
        logger.error(`Minecraft bot failed to start: ${err.message}`)
    })
}

function scheduleMinecraftStartup() {
    logger.info(`Minecraft startup scheduled in ${MINECRAFT_START_DELAY_MS}ms (independent of Discord login)`)

    setTimeout(() => {
        startMinecraftBotSafe(null)
    }, MINECRAFT_START_DELAY_MS)
}

scheduleMinecraftStartup()

client.once("ready",()=>{

    logger.info(`Discord bot ready as ${client.user?.tag || "unknown-user"}`)

    // If Minecraft is already running, this call updates it to use the live Discord client.
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

    let lastError = null

    for (let attempt = 1; attempt <= DISCORD_LOGIN_MAX_ATTEMPTS; attempt++) {
        try {
            logger.info(`Discord login attempt ${attempt}/${DISCORD_LOGIN_MAX_ATTEMPTS}`)
            await loginDiscordWithTimeout()
            return
        } catch (err) {
            lastError = err
            const errorMessage = err?.message || String(err)
            const retryable = shouldRetryLogin(errorMessage)

            logger.error(`Discord login failed on attempt ${attempt}: ${errorMessage}`)

            const isLastAttempt = attempt >= DISCORD_LOGIN_MAX_ATTEMPTS

            if (!retryable || isLastAttempt) {
                if (isLastAttempt) {
                    logger.error(`Discord login stopped after ${DISCORD_LOGIN_MAX_ATTEMPTS} failed attempts`)
                }
                throw err
            }

            let waitMs = getLoginRetryDelayMs(attempt)
            const retryAfterMs = Number(err?.retryAfterMs)
            if (Number.isFinite(retryAfterMs) && retryAfterMs > waitMs) {
                waitMs = retryAfterMs
            }

            logger.warn(`Retrying Discord login in ${waitMs}ms...`)

            try {
                client.destroy()
            } catch {
                // Ignore destroy failures between retry attempts.
            }

            await sleep(waitMs)
        }
    }

    throw lastError || new Error("Discord login failed")
}

if (hasDiscordToken) {
    startDiscordWithRetry().catch((err) => {
        logger.error(`Discord login failed: ${err.message}`)
        logger.error("Troubleshooting: if preflight passed but login timed out, check outbound websocket access to gateway.discord.gg:443 and reduce simultaneous startups")
    })
}

module.exports = client