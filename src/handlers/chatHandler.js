const config = require("../utils/config")
const https = require("https")
const http = require("http")
const { URL } = require("url")

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