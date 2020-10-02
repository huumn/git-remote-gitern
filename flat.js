const fs = require('fs')
const readline = require('readline')
// api

// looks in flat file for key, returning value
// TODO: should perform binary search eventually
const get = async(path, key) => {
  const rl = readline.createInterface({
    input: fs.createReadStream(path),
    terminal: false
  })

  for await (const line of rl) {
    let [lkey, value] = line.split(" ")
    if (lkey == key) {
      rl.close()
      return value
    }
  }
}

// XXX readline might be slow given it's meant for console work
// TODO: we should verify the resulting file is in good shape with a checksum?
// we should probably also read/write this directly to/from the .git database
// so that we don't have to checkout different things ... so rather than path
// perhaps we take a readable stream? ... the biggest problem with this is that get
// will need a file to be efficient 
// expected format of a line is `${key} ${value}\n`
const writeLines = async(path, ...lines) => { 
  let outpath = path + ".temp"

  const rl = readline.createInterface({
    input: fs.createReadStream(path),
    output: fs.createWriteStream(outpath),
    terminal: false
  })

  lines.sort()

  rl.on('line', (line) => {
    if (lines.length && line > lines[0]) {
      rl.output.write(`${lines.shift()}\n`)
    }

    rl.output.write(`${line}\n`)
  })

  rl.on('close', () => {
    // write remaining lines
    for (const l of lines) {
      rl.output.write(`${l}\n`)
    }

    fs.rename(outpath, path, (err) => {
        if (err) throw err
    })
  })
}

module.exports = {
  writeLines: writeLines,
  get: get,
}


