const puppeteer = require('puppeteer')
const useragent = require('fake-useragent')

class Zedlr {
  constructor (options) {
    this.options = {
      headless: true,
      incognito: true,
      autoscroll: false,
      ...options
    }
    this.browser = null
    this.context = null
    this.page = null
    this.html = null
  }

  async init () {
    this.browser = await puppeteer.launch(this.options)
    return this
  }

  async goto (url) {
    const { autoscroll, incognito } = this.options
    console.log(autoscroll)
    console.log('browsing incognito', incognito)

    if (incognito) {
      this.context = await this._browserContext()
      this.page = await this.context.newPage()
      const ua = useragent()
      await this.page.setUserAgent(ua)
    } else {
      const pages = await this.browser.pages()
      this.page = pages[0]
    }

    await this.page.goto(url)
    if (autoscroll) { await this._autoScroll() }

    this.html = await this.page.evaluate(() => document.body.innerHTML)
  }

  async close () {
    await this.context.close()
    await this.browser.close()
    delete this
  }

  getHtml () {
    return this.html
  }

  async _browserContext() {
    if (this.context) {
      await this.context.close()
    }
    return this.browser.createIncognitoBrowserContext()
  }

  async _autoScroll () {
    await this.page.evaluate(async function () {
      await new Promise(function (resolve, reject) {
        var totalHeight = 0
        var distance = 200
        var timer = setInterval(function () {
          var scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance
          if (totalHeight >= scrollHeight) {
            clearInterval(timer)
            resolve()
          }
        }, 100)
      })
    })
  }

}

module.exports = Zedlr
