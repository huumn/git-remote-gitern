const { git, gitSync } = require('./git.js')
const m = require('./misc.js')
const log = require('./logger.js')
// TODO v2: version the tag file ... ie give each a parent

const tagReadStream = (dst, tag) => {
  // verify ref exists
  let verfiyRef = gitSync(["show-ref", "--verify", "-q", tag], 
    { cwd : dst, ignoreErr: true})
  if (verfiyRef.status != 0) {
    return null
  }

  return git(["cat-file", "blob", tag], { cwd : dst }).stdout
}

// TODO: should perform binary search rather than scanning
const get = async(dst, tag, key) => {
  log.profile(`get value ${key}`, { level: 'silly' });
  
  let tagRdSt = tagReadStream(dst, tag)
  if (tagRdSt) {
    for await (const line of m.lines(tagRdSt)) {
      let [lkey, value] = line.split(" ")
      if (lkey == key) {
        log.profile(`get value ${key}`, { level: 'silly' });
        return value
      }
    }
    log.error("key %s not found", key)
    return
  }
  log.error("tag %s not found in %s", tag, dst)
}

// TODO: this is necessarily O(N) unless we create a reverse map
const getKey = async(dst, tag, val) => {
  log.profile(`get key ${val}`, { level: 'silly' });
  
  let tagRdSt = tagReadStream(dst, tag)
  if (tagRdSt) {
    for await (const line of m.lines(tagRdSt)) {
      let [key, lval] = line.split(" ")
      if (lval == val) {
        log.profile(`get key ${val}`, { level: 'silly' });
        return key
      }
    }
    log.error("val %s not found", val)
    return
  }
  log.error("tag %s not found in %s", tag, dst)
}

const tagWriter = (dst) => {
  return git(["hash-object","-w", "--stdin"], { cwd : dst })
}

// expected format of a line is `${key} ${value}`
const insert = async(dst, tag, lines) => { 
  log.profile(`insert`, { level: 'silly' })

  lines.sort()
  tagWr = tagWriter(dst)
  tagRdSt = tagReadStream(dst, tag)
  if (tagRdSt) {
    for await (const line of m.lines(tagRdSt)) {
      // if any new lines go before line, write them out
      while (lines.length && line > lines[0]) {
        tagWr.stdin.write(`${lines.shift()}\n`)
      }
      // occasionally we are rewrite a line
      if (line == lines[0]) {
        lines.shift()
        log.warn("dup line %s", line)
      }

      tagWr.stdin.write(`${line}\n`)
    }
  }

  // write remaining lines
  for (const l of lines) {
    tagWr.stdin.write(`${l}\n`)
  }

  tagWr.stdin.end()
  log.profile(`insert`, { level: 'silly' });
  return await m.line(tagWr.stdout)
}

const update = async(dst, tag, kvs) => {
  // write kvs to the file
  let entries = Object.entries(kvs).map(kv => {
    return `${kv[0]} ${kv[1]}`
  })
  oid = await insert(dst, tag, entries)
  
  // update the tag to point to the new object
  gitSync(["update-ref", tag, oid], { cwd : dst })
  return oid
}

module.exports = {
  get: get,
  getKey: getKey,
  update: update
}
