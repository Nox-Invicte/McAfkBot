const fs = require('fs')
const path = require('path')

console.log('\n=== Auth Files to Environment Variables ===\n')
console.log('Copy these to your .env file (locally) or Render environment variables:\n')

const authFiles = {
    'AUTH_BED': 'auth/df0382_bed-cache.json',
    'AUTH_LIVE': 'auth/df0382_live-cache.json',
    'AUTH_MSAL': 'auth/df0382_msal-cache.json',
    'AUTH_XBL': 'auth/df0382_xbl-cache.json'
}

let success = true

for (const [envVar, filePath] of Object.entries(authFiles)) {
    try {
        const content = fs.readFileSync(filePath, 'utf8')
        const base64 = Buffer.from(content).toString('base64')
        console.log(`${envVar}="${base64}"`)
    } catch (err) {
        console.error(`Error reading ${filePath}: ${err.message}`)
        success = false
    }
}

if (success) {
    console.log('\n✅ Successfully generated all auth environment variables!')
    console.log('\nInstructions:')
    console.log('1. Add these variables to your .env file for local testing')
    console.log('2. Add them to Render environment variables for deployment')
    console.log('3. Delete the local auth/ folder to test restoration')
} else {
    console.log('\n❌ Failed to generate some variables. Make sure auth files exist.')
}
