const config = require("../utils/config")
const logger = require("../utils/logger")
const https = require("https")
const http = require("http")
const { URL } = require("url")

const WEBHOOK_MAX_QUEUE_SIZE = 500
const WEBHOOK_BASE_DELAY_MS = 450
const WEBHOOK_MAX_RETRIES = 5
const WEBHOOK_COOLDOWN_MS = 60 * 60 * 1000

const KNOWN_RANKS = new Set([
    "SEEDLING",
    "SAPLING",
    "OAK",
    "JUNGLE",
    "HELPER",
    "ADMIN",
    "MOD",
    "OWNER",
    "MEMBER"
])

const CHAT_SEPARATOR_REGEX = /^(.+?)\s*(?:▶|»|:|>)\s*(.+)$/
const PLAYER_EVENT_REGEXES = [
    /^(?:☠\s*)?([._A-Za-z0-9]{2,20})\s+(?:was|died|fell|tried|blew|burned|hit|walked|went|starved|suffocated|froze|withered|got|slain|killed)\b/i,
    /^([._A-Za-z0-9]{2,20})\s+(?:joined|left|quit|disconnected)\b/i
]

const webhookQueue = []
let webhookProcessing = false
let webhookCooldownUntil = 0

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function sendChat(client, message){

    if(!message || message.trim() === "") return

    const parsedMessage = parsePlayerMessage(message.trim())
    if (!parsedMessage) return
    
    if(config.chatWebhook) {
        // Player message - send via webhook with full rank/level and player name
        const fullUsername = parsedMessage.username
        const content = parsedMessage.content
        const playerName = parsedMessage.playerName
        const avatarURL = `https://mc-heads.net/avatar/${playerName}/100`
        
        sendWebhook(config.chatWebhook, {
            content: content,
            username: fullUsername,
            avatar_url: avatarURL
        })
    } else {
        // Fallback to regular channel message
        if(!client || !client.channels || !config.chatChannel) return

        const channel = client.channels.cache.get(config.chatChannel)
        if(channel){
            const fallbackText = parsedMessage.type === "chat"
                ? `${parsedMessage.username} ▶ ${parsedMessage.content}`
                : parsedMessage.content

            channel.send(fallbackText).catch((err) => {
                logger.error(`Failed to send chat message to channel: ${err.message}`)
            })
        }
    }

}

function parsePlayerMessage(message) {
    const chatMatch = message.match(CHAT_SEPARATOR_REGEX)

    if (chatMatch) {
        const leftSide = chatMatch[1].trim()
        const content = chatMatch[2].trim()
        const rankToken = leftSide.split(/\s+/)[0]?.toUpperCase()

        if (KNOWN_RANKS.has(rankToken) && content) {
            const playerName = extractPlayerName(leftSide)

            return {
                type: "chat",
                username: leftSide,
                content,
                playerName
            }
        }

        return null
    }

    for (const regex of PLAYER_EVENT_REGEXES) {
        const match = message.match(regex)
        if (match) {
            return {
                type: "event",
                username: match[1],
                content: message,
                playerName: match[1]
            }
        }
    }

    return null
}

function extractPlayerName(prefix) {
    // Pick the first Minecraft-style username token instead of rank/tag decorations.
    const tokens = prefix.split(/\s+/)
    for (const token of tokens) {
        const cleaned = token.replace(/[^._A-Za-z0-9]/g, "")
        if (/^[._A-Za-z0-9]{2,20}$/.test(cleaned) && !KNOWN_RANKS.has(cleaned.toUpperCase())) {
            return cleaned
        }
    }

    const fallback = prefix.match(/([._A-Za-z0-9]{2,20})/)
    return fallback ? fallback[1] : "MHF_Steve"
}

function sendWebhook(webhookURL, data) {
    if (!webhookURL) return

    if (webhookCooldownUntil > Date.now()) {
        return
    }

    if (webhookQueue.length >= WEBHOOK_MAX_QUEUE_SIZE) {
        webhookQueue.shift()
        logger.warn("Webhook queue full, dropping oldest message")
    }

    webhookQueue.push({ webhookURL, data, attempt: 0 })
    processWebhookQueue()
}

async function processWebhookQueue() {
    if (webhookProcessing) return
    webhookProcessing = true

    while (webhookQueue.length > 0) {
        if (webhookCooldownUntil > Date.now()) {
            webhookQueue.length = 0
            break
        }

        const next = webhookQueue.shift()
        const result = await sendWebhookRequest(next.webhookURL, next.data)

        if (result.retryAfterMs !== null) {
            if (next.attempt < WEBHOOK_MAX_RETRIES) {
                next.attempt += 1
                webhookQueue.unshift(next)
                logger.warn(`Webhook rate limited (429), retrying in ${result.retryAfterMs}ms (attempt ${next.attempt}/${WEBHOOK_MAX_RETRIES})`)
                await delay(result.retryAfterMs)
                continue
            }

            webhookCooldownUntil = Date.now() + WEBHOOK_COOLDOWN_MS
            webhookQueue.length = 0
            logger.error(`Webhook dropped after max retries due to repeated 429 responses. Cooling down for ${Math.ceil(WEBHOOK_COOLDOWN_MS / 60000)} minutes`)
            await delay(WEBHOOK_BASE_DELAY_MS)
            continue
        }

        if (!result.ok) {
            logger.error(`Webhook request failed with status ${result.statusCode}`)
        }

        await delay(WEBHOOK_BASE_DELAY_MS)
    }

    webhookProcessing = false
}

function sendWebhookRequest(webhookURL, data) {
    return new Promise((resolve) => {
    try {
        const url = new URL(webhookURL)
        const protocol = url.protocol === 'https:' ? https : http
        const payload = JSON.stringify(data)
        
        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname + url.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }
        
        const req = protocol.request(options, (res) => {
            let rawBody = ""

            res.on("data", (chunk) => {
                rawBody += chunk.toString("utf8")
            })

            res.on("end", () => {
                if (res.statusCode === 429) {
                    const retryAfterMs = getRetryAfterMs(res.headers, rawBody)
                    resolve({ ok: false, statusCode: res.statusCode, retryAfterMs })
                    return
                }

                resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, statusCode: res.statusCode, retryAfterMs: null })
            })
        })
        
        req.on('error', (err) => {
            logger.error(`Webhook transport error: ${err.message}`)
            resolve({ ok: false, statusCode: 0, retryAfterMs: null })
        })
        
        req.write(payload)
        req.end()
    } catch(err) {
        logger.error(`Error preparing webhook request: ${err.message}`)
        resolve({ ok: false, statusCode: 0, retryAfterMs: null })
    }
    })
}

function getRetryAfterMs(headers, responseBody) {
    const headerRetryAfter = Number(headers["retry-after"])
    if (Number.isFinite(headerRetryAfter) && headerRetryAfter > 0) {
        return headerRetryAfter > 100 ? Math.ceil(headerRetryAfter) : Math.ceil(headerRetryAfter * 1000)
    }

    try {
        const parsed = JSON.parse(responseBody || "{}")
        const bodyRetryAfter = Number(parsed.retry_after)
        if (Number.isFinite(bodyRetryAfter) && bodyRetryAfter > 0) {
            return bodyRetryAfter > 100 ? Math.ceil(bodyRetryAfter) : Math.ceil(bodyRetryAfter * 1000)
        }
    } catch {
        // Ignore body parsing errors and use default retry delay.
    }

    return 2000
}

module.exports = { sendChat }