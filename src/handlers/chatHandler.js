const config = require("../utils/config")
const logger = require("../utils/logger")
const https = require("https")
const http = require("http")
const { URL } = require("url")

const WEBHOOK_MAX_QUEUE_SIZE = 500
const WEBHOOK_BASE_DELAY_MS = 450
const WEBHOOK_MAX_RETRIES = 5

const webhookQueue = []
let webhookProcessing = false

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function sendChat(client, message){

    if(!message || message.trim() === "") return

    // Try to parse player message - capture everything before separator as username
    const playerMatch = message.match(/^(.+?)\s*(?:»|:|>)\s*(.+)$/)
    
    if(config.chatWebhook && playerMatch) {
        // Player message - send via webhook with full rank/level and player name
        const fullUsername = playerMatch[1].trim()
        const content = playerMatch[2].trim()
        
        // Extract just the player name (last word with optional *) for avatar
        const playerNameMatch = fullUsername.match(/(\*?\w+)\s*$/)
        const playerName = playerNameMatch ? playerNameMatch[1] : fullUsername
        const avatarURL = `https://mc-heads.net/avatar/${playerName}/100`
        
        sendWebhook(config.chatWebhook, {
            content: content,
            username: fullUsername,
            avatar_url: avatarURL
        })
    } else if(config.chatWebhook) {
        // Server message - send as "SERVER"
        sendWebhook(config.chatWebhook, {
            content: message,
            username: "SERVER",
            avatar_url: "https://mc-heads.net/avatar/MHF_Steve/100"
        })
    } else {
        // Fallback to regular channel message
        const channel = client.channels.cache.get(config.chatChannel)
        if(channel){
            channel.send(message).catch((err) => {
                logger.error(`Failed to send chat message to channel: ${err.message}`)
            })
        }
    }

}

function sendWebhook(webhookURL, data) {
    if (!webhookURL) return

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

            logger.error("Webhook dropped after max retries due to repeated 429 responses")
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