function info(msg){
    console.log(`[INFO] ${msg}`)
}

function error(msg){
    console.log(`[ERROR] ${msg}`)
}

function warn(msg){
    console.log(`[WARN] ${msg}`)
}

module.exports = { info, error, warn }