const config = require("../utils/config")
const logger = require("../utils/logger")

function sendLog(client, message){

    if(!client || !client.channels || !config.logChannel) return

    const channel = client.channels.cache.get(config.logChannel)

    if(channel){
        channel.send(message).catch((err) => {
            logger.error(`Failed to send log message to channel: ${err.message}`)
        })
    }

}

module.exports = { sendLog }