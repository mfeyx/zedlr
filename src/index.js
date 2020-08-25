const puppeteer = require('puppeteer')
const useragent = require('fake-useragent')

class Zedlr {
  constructor (options) {
    this.options = options
    this.incognito = options.incognito || true
    this.browser = null
    this.context = null
    this.page = null
  }

  async init () {
    this.browser = await puppeteer.launch(this.options)
    return this
  }

  async goto (url) {
    if (this.incognito) {
      this.context = await this._browserContext()
      this.page = await this.context.newPage()
      const ua = useragent()
      await this.page.setUserAgent(ua)
    } else {
      const pages = await this.browser.getPages()
      this.page = pages[0]
    }
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
