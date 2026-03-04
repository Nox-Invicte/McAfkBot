const express = require("express")

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