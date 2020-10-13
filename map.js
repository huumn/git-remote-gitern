const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const { resolve } = require('path')
const readline = require('readline')
const m = require('./misc.js')
const log = require('./logger.js')
// TODO v2: version the tag file ... ie give each a parent

const tagReadStream = (dstOpts, tag) => {
  // verify ref exists
  let verfiyRef = spawnSync("git", ["show-ref", "--verify", "-q", tag], dstOpts)
  if (verfiyRef.status != 0) {
    return null
  }

  return spawn("git", ["cat-file", "blob", tag], dstOpts).stdout
}

// TODO: should perform binary search rather than scanning
const get = async(dstOpts, tag, key) => {
  log.profile(`get value ${key}`, { level: 'silly' });
  
  let tagRdSt = tagReadStream(dstOpts, tag)
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
  log.error("tag %s not found in %s", tag, dstOpts.cwd)
}

// TODO: this is necessarily O(N) unless we create a reverse map
const getKey = async(dstOpts, tag, val) => {
  log.profile(`get key ${val}`, { level: 'silly' });
  
  let tagRdSt = tagReadStream(dstOpts, tag)
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
  log.error("tag %s not found in %s", tag, dstOpts.cwd)
}

const tagWriter = (dstOpts) => {
  return spawn("git", ["hash-object","-w", "--stdin"], dstOpts)
}

// expected format of a line is `${key} ${value}\n`
const insert = async(dstOpts, tag, lines) => { 
  log.profile(`insert`, { level: 'silly' })

  lines.sort()
  tagWr = tagWriter(dstOpts)
  tagRdSt = tagReadStream(dstOpts, tag)
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

const update = async(dstOpts, tag, kvs) => {
  // write kvs to the file
  let entries = Object.entries(kvs).map(kv => {
    return `${kv[0]} ${kv[1]}`
  })
  console.error(entries)
  oid = await insert(dstOpts, tag, entries)
  
  // update the tag to point to the new object
  let updateRef = spawnSync("git", ["update-ref", tag, oid], dstOpts)
  if (updateRef.status != 0) {
    log.error("failed to update tag ref %s %s", ref, parent)
    throw updateRef.status
  }

  return oid
}

module.exports = {
  get: get,
  getKey: getKey,
  update: update
}
