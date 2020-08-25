const puppeteer = require('puppeteer')
const useragent = require('fake-useragent')

class Zedlr {
  constructor (options) {
    this.options = options
    this.stealth = options.stealth || true
    this.browser = null
    this.context = null
    this.page = null
  }

  async init () {
    this.browser = await puppeteer.launch(this.options)
    return this
  }

  async goto (url) {
    this.context = await this._browserContext()
    this.page = await this.context.newPage()
    if (this.stealth) {
      const ua = useragent()
      await this.page.setUserAgent(ua) }
    await this.page.goto(url)
  }

  async close () {
    await this.context.close()
    await this.browser.close()
    delete this
  }

  async _browserContext() {
    if (this.context) {
      await this.context.close()
    }
    return this.browser.createIncognitoBrowserContext()
  }
}

module.exports = Zedlr
