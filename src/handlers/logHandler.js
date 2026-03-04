const config = require("../utils/config")

function sendLog(client, message){

    const channel = client.channels.cache.get(config.logChannel)

    if(channel){
        channel.send(message)
    }

}

module.exports = { sendLog }