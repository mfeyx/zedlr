/* eslint-disable no-unneeded-ternary */

const puppeteer = require('puppeteer')
const useragent = require('fake-useragent')
const qs = require('query-string')
const cheerio = require('cheerio')
const utils = require('./utils')
const fs = require('fs')
const path = require('path')
const chrono = require('chrono-node')
const json2csv = require('json2csv')
const { BigQuery } = require('@google-cloud/bigquery')

// configuration stuff
const sourceloaddatetime = Math.round((new Date()).getTime() / 1000)
const BASEURL = 'https://www.amazon'
const PATH = 'product-reviews'
const delimiter = '\t'
const fields = [
  'asin',
  'shop_name',
  'product_name',
  'review_id',
  'profile_name',
  'profile_id',
  'verified_purchase',
  'is_vine_tester',
  'review_date',
  'review_title',
  'review_text',
  'review_rating',
  'review_is_helpful',
  'review_is_helpful_text',
  'review_is_helpful_count',
  'review_has_comments',
  'review_comments_count',
  'sourceloaddatetime'
]

// bigquery table.load()
const metadata = {
  sourceFormat: 'CSV',
  fieldDelimiter: delimiter,
  writeDisposition: 'WRITE_APPEND',
  autodetect: false,
  encoding: 'UTF-8',
  skipLeadingRows: 1
}

// m = meta, r = review
const selectors = {
  m: {
    averageStarRating: 'span[data-hook="rating-out-of-text"]',
    starRatingCount: 'div[data-hook="total-review-count"]',
    productName: 'a[data-hook="product-link"]',
    shopName: 'div[data-hook="cr-product-byline"]'
  },
  r: {
    filterInfoReviewCount: 'span[data-hook="cr-filter-info-review-count"]',
    reviewList: 'div#cm_cr-review_list',
    reviewBody: 'span[data-hook="review-body"]',
    reviewDate: 'span[data-hook="review-date"]',
    profileName: 'span[class="a-profile-name"]',
    profileId: 'div[data-hook="genome-widget"]',
    reviewStarRating: 'i[data-hook="review-star-rating"]',
    reviewTitle: 'a[data-hook="review-title"]',
    verified: 'span[data-hook="avp-badge"]',
    helpfulVote: 'span[data-hook="helpful-vote-statement"]',
    isVineTest: 'a[data-hook="linkless-format-strip-whats-this"]',
    reviewCommentsCount: 'a[data-action="a-expander-toggle"]'
  }
}

function isPage (obj) {
  if (!obj || typeof obj !== 'object') { return false }
  return obj.constructor.name === 'Page'
}

async function getHtmlFromPage (url, options) {
  let { config, page, browser } = options

  if (!isPage(page)) {
    browser = await puppeteer.launch()
    const openPages = await browser.pages()
    page = openPages[0]
  }

  const ua = useragent()
  await page.setUserAgent(ua)
  await page.goto(url, config)

  const html = await page.evaluate(() => document.body.innerHTML)

  if (browser) {
    await browser.close()
  }

  return html
}

function extrctProfileId ($, soup, profileIdSelector) {
  const profileWidget = soup.find(profileIdSelector).find('a')
  const profileIds = []
  profileWidget.each((_, el) => {
    const id = $(el).attr('href')
    profileIds.push(id)
  })
  const id = profileIds ? profileIds[0].match(/(?<=account.)\w+/) : null
  return id
}

function extractDate (date, locale) {
  try {
    return chrono[locale].parseDate(date).toISOString().slice(0, 10)
  } catch (err) {
    return date
  }
}

async function extractReviews ($, selectorReviewList, locale) {
  const reviews = []
  const reviewList = $(selectorReviewList).children()
  reviewList.each((_, el) => {
    const soup = $(el)
    const date = soup.find(selectors.r.reviewDate).text()
    if (date) {
      const attrs = soup.attr()
      const body = soup.find(selectors.r.reviewBody).text()
      const profileName = soup.find(selectors.r.profileName).text()
      const reviewRating = soup.find(selectors.r.reviewStarRating).text()
      const title = soup.find(selectors.r.reviewTitle).text()
      const verified = soup.find(selectors.r.verified).text()
      const helpfulVote = soup.find(selectors.r.helpfulVote).text()
      const isVineTester = soup.find(selectors.r.isVineTest).text()
      const commentsCount = soup.find(selectors.r.reviewCommentsCount).text().match(/\d/)
      const profileId = extrctProfileId($, soup, selectors.r.profileId)
      const reviewDate = extractDate(date, locale)

      reviews.push({
        review_id: attrs.id || null,
        profile_name: profileName ? utils.encryptName(profileName.trim()) : null,
        profile_id: profileId ? profileId[0] : null,
        verified_purchase: verified ? true : false,
        is_vine_tester: isVineTester ? true : false,
        review_date: reviewDate,
        review_title: title ? title.trim() : null,
        review_text: body ? body.replace(/\n|\t|\r\n/gm, ' ').replace(/\s{2,}/gm, ' ').trim() : null,
        review_rating: reviewRating && reviewRating.match(/\d/)
          ? +reviewRating.match(/\d/)[0] : null,
        review_is_helpful: helpfulVote ? true : false,
        review_is_helpful_text: helpfulVote ? helpfulVote.trim() : null,
        review_is_helpful_count: helpfulVote
          ? helpfulVote.match(/\d/) ? +helpfulVote.match(/\d/)[0] : 1
          : null,
        review_has_comments: +commentsCount ? true : false,
        review_comments_count: commentsCount ? +commentsCount.join('') : null,
        sourceloaddatetime
      })
    }
  })
  return reviews
}

async function extractReviewsAndRatings (ASIN, LTD, page = null) {
  try {
    const result = {
      asin: ASIN,
      'average_star_rating': null,
      'star_rating_count': null,
      'product_name': null,
      'shop_name': null,
      'review_count': null,
      reviews: []
    }

    const urlconfig = {
      url: `${BASEURL}.${LTD}/${PATH}/${ASIN}/`,
      query: {
        ie: 'UTF8',
        reviewerType: 'all_reviews',
        sortBy: 'recent',
        pageNumber: '1'
      }
    }

    const url = qs.stringifyUrl(urlconfig)
    const config = { waitUntil: 'domcontentloaded' }
    const html = await getHtmlFromPage(url, { config, page })
    const $ = cheerio.load(html)

    // 1. Ratings Summary
    let averageStarRating = $(selectors.m.averageStarRating).text()
      .match(/\d+/gm)

    if (averageStarRating) {
      averageStarRating = averageStarRating
        .slice(0, 2)
        .join('.')
    }
    averageStarRating = averageStarRating < 1 ? 0 : +averageStarRating
    // console.log('Average Rating:', averageStarRating)
    result['average_star_rating'] = averageStarRating

    let starRatingCount = $(selectors.m.starRatingCount).text().match(/\d+/gm)
    starRatingCount = starRatingCount ? starRatingCount.join('') : 0
    // console.log('Ratings:', starRatingCount)
    result['star_rating_count'] = starRatingCount

    // 2. Product Information
    const productName = $(selectors.m.productName).text()
    result['product_name'] = productName

    const shopName = $(selectors.m.shopName)
      .text()
      .replace(/\n/gm, '')
      .replace(/\s/gm, '')
      .toLowerCase()
    // console.log('Shop:', shopName)
    result['shop_name'] = shopName

    // 3. Reviews || The fun starts here
    let infoReviewCount = $(selectors.r.filterInfoReviewCount).text()
      .match(/\d+/gm)

    let reviewCount = 0
    if (infoReviewCount && infoReviewCount.length) {
      const n = infoReviewCount.length - 1
      infoReviewCount = [...infoReviewCount.slice(0, n), infoReviewCount.slice(n).join('')]
      reviewCount = infoReviewCount[n]
    }
    // console.log(infoReviewCount)
    // console.log('Reviews:', reviewCount)
    result['review_count'] = reviewCount

    if (!reviewCount) {
      console.log('No Reviews for Product', ASIN)
      return false
      // console.log(result)
      // process.exit(0)
    }

    // iterate through all other rating pages
    const reviewsPerPage = 10
    const reviewPages = reviewCount > reviewsPerPage ? Math.ceil(reviewCount / reviewsPerPage) : 1
    // console.log('Review Pages:', reviewPages)

    const pages = utils.range(reviewPages, 1)
    // console.log(pages)

    const locale = ['de', 'fr'].includes(LTD) ? LTD : 'en'
    // get the ratings from the first page
    let reviews = await extractReviews($, selectors.r.reviewList, locale)
    // get the rest
    for (const pageNumber of pages.slice(1)) {
      urlconfig.query.pageNumber = pageNumber

      const ms = utils.getSleepTime(0, 1)
      await utils.wait(ms)

      const url = qs.stringifyUrl(urlconfig)
      const html = await getHtmlFromPage(url, { config, page })
      const $ = cheerio.load(html)
      const nextReviews = await extractReviews($, selectors.r.reviewList, locale)
      reviews.push(...nextReviews)
    }
    // console.log('Extracted Reviews', reviews.length, productName.slice(0, 40))
    result.reviews.push(...reviews)
    return result
  } catch (err) {
    console.log(err)
    throw err
  }
}

async function transformResult (result) {
  const { reviews } = result
  const results = []
  for (let review of reviews) {
    results.push({
      asin: result.asin,
      shop_name: result.shop_name,
      product_name: result.product_name,
      ...review
    })
  }
  return results
}

async function writeFile (fp, data) {
  let status = false

  if (fs.existsSync(fp)) {
    console.log('File already exists:', fp)
    fs.unlinkSync(fp)
    console.log('File deleted.')
  }

  try {
    fs.writeFileSync(fp, data)
    status = true
  } catch (error) {
    console.log(error)
  }

  return status
}

async function loadToBigquery (fp, metadata) {
  const bigquery = new BigQuery({ projectId: 'beiersdorf-datahub' })
  const dataset = bigquery.dataset('stage')
  const table = dataset.table('tmp_source_amazon_ratings')
  const [job] = await table.load(fp, metadata)
  return job
}

;(async () => {
  const browser = await puppeteer.launch()
  const openPages = await browser.pages()
  const page = openPages[0]
  const config = require('./config.json')
  const opts = { fields, delimiter }

  for (const LTD of Object.keys(config)) {
    const outfolder = 'files'
    const resultFile = `ratings-${LTD}.csv`

    const fp = path.join(outfolder, resultFile)

    if (fs.existsSync(fp)) {
      console.log('File already exists:', fp)
      fs.unlinkSync(fp)
      console.log('File deleted.')
    }

    console.log('Start with export...', LTD)
    const ratingsReviews = []
    try {
      // const asinList = await utils.distinctArrayAsync(config[LTD])
      const asinList = config[LTD]
      const N = asinList.length
      console.log('# ASINS:', N)

      let i = 0
      for (let asin of asinList.slice()) {
        i++
        const result = await extractReviewsAndRatings(asin, LTD, page)

        // stop if no results
        if (!result) { continue }

        const transformedResult = await transformResult(result)
        const csvData = json2csv.parse(transformedResult, opts)
        const tmpFile = path.join(outfolder, `${new Date().getTime()}-${resultFile}`)
        const fileSuccessfullyWritten = await writeFile(tmpFile, csvData)
        if (fileSuccessfullyWritten) {
          const job = await loadToBigquery(tmpFile, metadata)
          if (job.status && job.status.state && job.status.state === 'DONE') {
            fs.unlinkSync(tmpFile)
          }
        }
        ratingsReviews.push(...transformedResult)
        if (i % 50 === 0) { console.log(i, 'of', N) }
        const ms = utils.getSleepTime(0, 3)
        await utils.wait(ms)
      }
    } catch (error) {
      console.log(error)
    } finally {
      await browser.close()
      const opts = { fields, delimiter }
      const csvData = json2csv.parse(ratingsReviews, opts)
      fs.writeFileSync(fp, csvData)
      console.log('Done.')
    }
  }
})()
