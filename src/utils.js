const util = require('util');
const random = require('random')
const ALPHA = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function alpha (str) {
  return str.split('').filter(c => ALPHA.includes(c)).join('')
}

/**
 * Generates an ID based on base64 encoding.
 * @param {string} str A string value
 * @returns {string}
 */
function encryptName (str) {
  return alpha(Buffer.from(alpha(str)).toString('base64'))
}

function distinctArray (arr) {
  return Array.from(new Set(arr))
}

async function distinctArrayAsync (arr) {
  return new Promise(resolve => {
    resolve(distinctArray(arr))
  })
}

async function wait (ms) {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

function getSleepTime (min, max) {
  return Math.round(random.float(min, max) * random.int(min * 600, max * 400), 0)
}

function range (end, start = 0) {
  const numbers = []
  let i = start
  // if (min > 0) max += min
  for (i; i <= end; i++) {
    numbers.push(i)
  }
  return numbers
}

module.exports = {
  distinctArray,
  distinctArrayAsync,
  encryptName,
  getSleepTime,
  range,
  wait
}
