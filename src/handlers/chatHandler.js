const config = require("../utils/config")
const https = require("https")
const http = require("http")
const { URL } = require("url")

function sendChat(client, message){

    if(!message || message.trim() === "") return

    // Try to parse player message format: "PlayerName: message" or "<PlayerName> message"
    const playerMatch = message.match(/^(?:<(.+?)>|(.+?):)\s*(.+)$/)
    
    if(config.chatWebhook && playerMatch) {
        // Player message - send via webhook with player name and avatar
        const username = playerMatch[1] || playerMatch[2]
        const content = playerMatch[3]
        const avatarURL = `https://mc-heads.net/avatar/${username}/100` || `https://mc-heads.net/avatar/${username}/100` || "https://mc-heads.net/avatar/MHF_Steve/100"
        
        sendWebhook(config.chatWebhook, {
            content: content,
            username: username,
            avatar_url: avatarURL
        })
    } else if(config.chatWebhook) {
        // Server message - send as "SERVER"
        sendWebhook(config.chatWebhook, {
            content: message,
            username: "SERVER",
            avatar_url: "https://mc-heads.net/avatar/Server/100"
        })
    } else {
        // Fallback to regular channel message
        const channel = client.channels.cache.get(config.chatChannel)
        if(channel){
            channel.send(message)
        }
    }

}

function sendWebhook(webhookURL, data) {
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
            if(res.statusCode !== 204) {
                console.error(`Webhook error: ${res.statusCode}`)
            }
        })
        
        req.on('error', (err) => {
            console.error('Webhook error:', err.message)
        })
        
        req.write(payload)
        req.end()
    } catch(err) {
        console.error('Error sending webhook:', err.message)
    }
}

module.exports = { sendChat }