const fs = require('fs')
const path = require('path')

console.log('\n=== Auth Files to Environment Variables ===\n')
console.log('Copy these to your .env file (locally) or Render environment variables:\n')

const authDir = 'auth'

// Auto-detect auth cache files
const authTypeMap = {
    'bed-cache.json': 'AUTH_BED',
    'live-cache.json': 'AUTH_LIVE',
    'msal-cache.json': 'AUTH_MSAL',
    'xbl-cache.json': 'AUTH_XBL'
}

let success = false
const authFiles = {}

if (!fs.existsSync(authDir)) {
    console.error(`❌ Auth directory not found: ${authDir}`)
    process.exit(1)
}

const files = fs.readdirSync(authDir)
for (const file of files) {
    for (const [suffix, envVar] of Object.entries(authTypeMap)) {
        if (file.endsWith(suffix)) {
            authFiles[envVar] = path.join(authDir, file)
            break
        }
    }
}

if (Object.keys(authFiles).length === 0) {
    console.error('❌ No auth cache files found in auth/ directory')
    console.error('Expected files like: *_bed-cache.json, *_live-cache.json, *_msal-cache.json, *_xbl-cache.json')
    process.exit(1)
}

for (const [envVar, filePath] of Object.entries(authFiles)) {
    try {
        const content = fs.readFileSync(filePath, 'utf8')
        const base64 = Buffer.from(content).toString('base64')
        console.log(`${envVar}="${base64}"`)
        success = true
    } catch (err) {
        console.error(`\nError reading ${filePath}: ${err.message}`)
    }
}

if (success) {
    console.log('\n✅ Successfully generated auth environment variables!')
    console.log('\nInstructions:')
    console.log('1. Copy the above variables to your .env file for local testing')
    console.log('2. Add them to Render environment variables for deployment')
    console.log('3. Delete the local auth/ folder to test restoration')
} else {
    console.log('\n❌ Failed to generate variables. Make sure auth files exist.')
    process.exit(1)
}
