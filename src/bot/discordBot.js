const { Client, Intents } = require("discord.js")

const config = require("../utils/config")

const { startMinecraftBot, stopMinecraftBot, getStatus, sendMessage } = require("./minecraftBot")

const client = new Client({
    intents:[
        Intents.FLAGS.GUILD_MESSAGES,
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.MESSAGE_CONTENT
    ]
})

client.once("ready",()=>{

    console.log("Discord bot ready")

    startMinecraftBot(client)

})

client.on("messageCreate",(msg)=>{

    if(msg.author.bot) return

    if(msg.content === "!start"){

        startMinecraftBot(client)
        msg.reply("Minecraft bot started")

    }

    if(msg.content === "!stop"){

        stopMinecraftBot()
        msg.reply("Minecraft bot stopped")

    }

    if(msg.content === "!status"){

        const status = getStatus()

        if(status.connected){
            msg.reply(`🟢 Connected to ${status.server} as ${status.username}`)
        } else {
            msg.reply("🔴 Not connected to Minecraft server")
        }

    }

    if(msg.content.startsWith("!send ")){

        const message = msg.content.substring(6)

        if(!message || message.trim() === ""){
            msg.reply("⚠️ Please provide a message to send")
            return
        }

        try {
            sendMessage(message)
            msg.reply(`✅ Sent: ${message}`)
        } catch(err) {
            msg.reply(`❌ Error: ${err.message}`)
        }

    }

})

client.login(config.discordToken)

module.exports = client