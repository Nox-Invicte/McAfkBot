const config = require("../utils/config")

function sendChat(client, message){

    if(!message || message.trim() === "") return

    const channel = client.channels.cache.get(config.chatChannel)

    if(channel){
        channel.send(message)
    }

}

module.exports = { sendChat }