const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const { resolve } = require('path');
const readline = require('readline')
const m = require('./misc.js')
const log = require('./logger.js')
// TODO v2: version the tag file ... ie give each a parent

// TODO: should perform binary search rather than scanning
const get = async(dstOpts, tag, key) => {
  log.profile(`get ${key}`, { level: 'debug' });

  for await (const line of m.lines(tagReadStream(dstOpts, tag))) {
    let [lkey, value] = line.split(" ")
    if (lkey == key) {
      log.profile(`get ${key}`, { level: 'debug' });
      return value
    }
  }
}

const tagReadStream = (dstOpts, tag) => {
  // verify ref exists
  let verfiyRef = spawnSync("git", ["show-ref", "--verify", "-q", tag], dstOpts)
  if (verfiyRef.status != 0) {
    return null
  }

  return spawn("git", ["cat-file", "blob", tag], dstOpts).stdout
}

const tagWriter = (dstOpts) => {
  return spawn("git", ["hash-object","-w", "--stdin"], dstOpts)
}

// XXX readline might be slow given it's meant for console work
// TODO: instead of a path, take an object (commit or tag)
// expected format of a line is `${key} ${value}\n`
const insert = async(dstOpts, tag, lines) => { 
  log.profile(`insert`, { level: 'debug' })

  // TODO: we also need to make sure there aren't duplicates
  //       because if we don't do our job elsewhere there are
  lines.sort()
  tagWr = tagWriter(dstOpts)
  tagRdSt = tagReadStream(dstOpts, tag)
  if (tagRdSt) {
    for await (const line of m.lines(tagRdSt)) {
      if (lines.length) {
        if(line > lines[0]) {
          tagWr.stdin.write(`${lines.shift()}\n`)
        } else if (line == lines[0]) {
          lines.shift()
          log.warn("dup line %s", line)
        } else if (line.slice(0, 20) == lines[0].slice(0, 20)) {
          lines.shift()
          log.warn("dup key %s", line.slice(0, 20))
        }
      }
  
      tagWr.stdin.write(`${line}\n`)
    }
  }

  // write remaining lines
  for (const l of lines) {
    tagWr.stdin.write(`${l}\n`)
  }

  tagWr.stdin.end()
  log.profile(`insert`, { level: 'debug' });
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
  update: update
}
