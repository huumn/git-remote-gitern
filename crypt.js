const { spawn } = require('child_process')

const en = async(input, output) => {
  input.write("hi\n", () => {
    output.pipe(input)
  })
}

const de = async(input, output) => {
  const rmHI = spawn("tail -c +4", [], spawnOpts)
  input.pipe(rmHI.stdin)
  rmHI.stdout.pipe(output)
}

module.exports = {
  en: en,
  de: de,
}
