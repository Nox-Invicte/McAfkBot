const dns = require("dns")
const express = require("express")

try {
    if (typeof dns.setDefaultResultOrder === "function") {
        dns.setDefaultResultOrder("ipv4first")
        console.log("[INFO] DNS result order set to ipv4first")
    }
} catch (err) {
    console.log(`[WARN] Unable to set DNS result order: ${err.message}`)
}

// Start Discord bot
require("./src/bot/discordBot")

// Create HTTP server to keep Render alive
const app = express()
const PORT = process.env.PORT || 3000

app.get("/", (req, res) => {
    res.status(200).send("Bot is running!")
})

app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    })
})

app.listen(PORT, () => {
    console.log(`HTTP server listening on port ${PORT}`)
    console.log(`Health check available at http://localhost:${PORT}/health`)
})