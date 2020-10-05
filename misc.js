const readline = require('readline')
const log = require('./logger.js')

async function* lines(input) {
  let rl = readline.createInterface({
    input: input,
    terminal: false
  })
  for await (const line of rl) {
    yield line
  }
}

const line = async(input) => {
  for await (const line of lines(input)) {
    return line
  }
}

module.exports = {
  lines: lines,
  line: line
}
