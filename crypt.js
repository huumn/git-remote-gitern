const stream = require('stream')
const crypto = require('crypto')

const CIPHER = 'aes-256-cbc'
const KEY = Buffer.from("5468576D5A7134743777217A25432A46")
const IVSIZE = 16

class IVReader extends stream.Transform {
  constructor(options) {
    super(options)
    this.iv = Buffer.alloc(0)
  }
  _transform(chunk, encoding, callback) {
    if (this.iv.length == IVSIZE) {
      this.push(chunk)
    } else {
      let nbytes = IVSIZE - this.iv.length
      let ivpart = chunk.slice(0, nbytes)
      this.iv = Buffer.concat([this.iv, ivpart])
      if (this.iv.length == IVSIZE) {
        this.emit('iv', this.iv);
      }
      this.push(chunk.slice(nbytes))
    }
    callback()
  }
}

const decryptStream = (input, output, encoding = null) => {
  let options = {}
  if (encoding) {
    // input outputs strings so we can decode them as
    // defaultEncoding
    input.setEncoding('utf8')
    options = {defaultEncoding: encoding, decodeStrings: true}
  }
  let ivr = new IVReader(options)
  input.pipe(ivr)
  ivr.on('iv', (iv) => {
    let deci = crypto.createDecipheriv(CIPHER, KEY, iv)
    ivr.pipe(deci).pipe(output)
  })
}

const encryptStream = (input, output, encoding = null) => {
  let iv = crypto.randomBytes(IVSIZE)
  // use passthrough to recode stream joining iv + ciph
  let p = new stream.PassThrough(encoding ? {encoding: encoding} : {})
  // write the iv before we do anything
  p.write(iv, () => {
    let ciph = crypto.createCipheriv(CIPHER, KEY, iv)
    input.pipe(ciph).pipe(p).pipe(output)
  })
}

const cryptString = (pher, input, encoding = null) => {
  let output = new stream.PassThrough()
  pher(stream.Readable.from(input), output, encoding)
  let result = ""
  output.on('data', (d) => result += d)
  return new Promise((resolve) => output.on('end', () => {
    resolve(result)}))
}

const decryptString = (input, encoding = null) => {
  return cryptString(decryptStream, input, encoding)
}

const encryptString = (input, encoding = null) => {
  return cryptString(encryptStream, input, encoding)

}

module.exports = {
  encryptStream,
  decryptStream,
  decryptString,
  encryptString,
}