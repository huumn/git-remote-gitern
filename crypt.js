const { spawn } = require('child_process')
const log = require('./logger.js')


const en = async(input, output) => {
  output.write("hi\n", () => {
    input.pipe(output)
    log.debug("encrypted object")
  })
}

const de = async(input, output) => {
  const rmHI = spawn("tail", ['-c', '+4'])
  input.pipe(rmHI.stdin)
  rmHI.stdout.pipe(output)
}

module.exports = {
  en: en,
  de: de,
}
