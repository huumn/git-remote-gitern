// TODO: we need to exit whenever git returns an error 
// TODO: this doesn't need to expose an object ...
//       we have a bit of state but we don't need to expose it

const { spawn, spawnSync } = require('child_process')
const { exit } = require('process')
const { resolve } = require('path')
const { lines, line } = require('./misc.js')
const log = require('./logger.js')
const readline = require('readline')
const crypt = require('./crypt.js')
const { get, getKey, update } = require('./map.js')
const { generateKeyPair } = require('crypto')

class Mirror {
  constructor(src, dest, push, address, refmaptag) {
    this.srcOpts = { cwd: resolve(src), stdio: ['pipe', 'pipe', 'inherit'] }
    this.dstOpts = { cwd: resolve(dest), stdio: ['pipe', 'pipe', 'inherit'] }
    this.mirOpts = push ? this.dstOpts : this.srcOpts
    this.push = push
    this.transform = push ? crypt.en : crypt.de
    this.refmap = {}
    this.refmaptag = refmaptag
    log.debug("", this.srcOpts, this.dstOpts)
  }

  lookup = async (oid) => {
    // if we're pushing, refmap is cryptoid => decryptoid 
    // else, it's decryptoid => cryptoid
    let obj = Object.entries(this.refmap).find(i => i[1] == oid)
    if (obj) return obj[0]

    // if we're pushing, dst is mirror, else src is mirror
    let getOID = this.push ? getKey : get
    obj = await getOID(this.mirOpts, this.refmaptag, oid)
    if (!obj) {
      log.error("could not find oid %s in %s", oid, this.refmaptag)
      exit(1)
    }
    return obj
  }

  mirror = async (ref, remote) => {
    // prints out: oid type size
    let not
    if (this.push) {
      not = `--remotes=${remote}`
    } else {
      // for fetch read the ref from src, perform lookup to get crytoid
      let showRef = spawn("git", ["show-ref", ref, "--hash"], this.dstOpts)
      let cid = await line(showRef.stdout)
      if (cid) {
        not = await getKey(this.mirOpts, this.refmaptag, cid)
      }
    }

    let revListArgs = ["rev-list", ref, "--objects", "--no-object-names", "--in-commit-order", 
      "--reverse", "--not"]
    if (not) revListArgs.push(not)

    let catFile = spawn("git", ["cat-file", "--batch-check"], this.srcOpts)
    let revList = spawn("git", revListArgs, this.srcOpts)
    revList.stdout.pipe(catFile.stdin)

    // convert the list to depth first ordering, which is a reversal of
    // each commit and its children
    let commitObjs = []
    let revListObjs = []
    for await (const line of lines(catFile.stdout)) {
      let [oid, type, size] = line.split(/[ \t]/)
      if (type == "commit") {
        revListObjs.push(...commitObjs.reverse())
        commitObjs = []
      }
      commitObjs.push({oid, type})
    }
    revListObjs.push(...commitObjs.reverse())
    let lastCommit = await this.mirrorRevList(revListObjs)

    // TODO: should verify old ref if not ephemeral - see manpage
    // update-ref <ref> <parent>
    if (this.push) {
      if (lastCommit) {
        log.warn("git update-ref %s %s", ref, lastCommit)
        let updateRef = spawnSync("git", ["update-ref", ref, lastCommit], this.dstOpts)
        if (updateRef.status != 0) {
          log.error("failed to update-ref %s %s", ref, lastCommit)
          exit(updateRef.status)
        }
      }
      return await update(this.dstOpts, this.refmaptag, this.refmap)
    }
  }

  mirrorRevList = async (objs) => {
    let last
    for(const obj of objs) {
      switch (obj.type) {
        case "blob":
          last = await this.mirrorBlob(obj.oid)
          break
        case "tree":
          last = await this.mirrorTree(obj.oid)
          break
        case "commit":
          last = await this.mirrorCommit(obj.oid)
          break
        default:
          log.error("unexpected object", obj)
          exit(1)
      }
    }
    return last
  }

  mirrorBlob = async (oid) => {
    log.debug("mirroring blob %s", oid)
    let hashObject = spawn("git", ["hash-object", "-w", "--stdin", "-t", "blob"], this.dstOpts)
    let catFile = spawn("git", ["cat-file", "blob", oid], this.srcOpts)
    this.transform(catFile.stdout, hashObject.stdin)
    let res = await line(hashObject.stdout)
    log.verbose("mirrored blob %s=>%s", oid, res)
    this.refmap[res] = oid
    return res
  }

  mirrorTree = async (oid) => {
    // get list of objects in tree and write them into new tree
    // with mutated refs
    log.debug("mirroring tree %s", oid)

    let lsTree = spawn("git", ['ls-tree', oid], this.srcOpts)
    let objs = ""

    for await (const line of lines(lsTree.stdout)) {
      let [mode, type, oid, name] = line.split(/[ \t]/)
      // TODO: de/encrypt names (will need to base64 enc them)
      let mapoid = await this.lookup(oid)
      objs += `${mode} ${type} ${mapoid}\t${name}\n`
    }

    log.debug("making tree with objects:\n%s", objs)
    let mktree = spawn("git", ["mktree"], this.dstOpts)
    mktree.stdin.write(objs)
    mktree.stdin.end()
    let res = await line(mktree.stdout)
    log.verbose("mirrored tree %s=>%s", oid, res)
    this.refmap[res] = oid
    return res
  }

  COMMIT_ENV = {
    ...process.env, ...{
      GIT_AUTHOR_DATE: "1977-06-10T12:00:00",
      GIT_COMMITTER_DATE: "1994-10-13T12:00:00",
      GIT_AUTHOR_EMAIL: "leo@gitern.com",
      GIT_AUTHOR_NAME: "Leonardo da Vinci",
      GIT_COMMITTER_EMAIL: "leo@gitern.com",
      GIT_COMMITTER_NAME: "Leonardo da Vinci",
    }
  }

  // TODO: test merges
  mirrorCommit = async (commit, parent) => {
    // get the tree to the commit
    let logTree = spawn("git", ["log", "--pretty=%T\ %P", "-n", "1", commit], this.srcOpts)
    let srcTree = await line(logTree.stdout)
    log.verbose("srcTree %s %s", commit, srcTree)
    let [tree, ...parents] = srcTree.split(/[ \t]/)
    log.verbose("tree %s parents %o", tree, parents)

    // TODO: we need to base64 encode/decode the message in addition to en/de
    let res
    if (this.push) {
      // we encrypt the message and send to the encrypted message to commit-tree
      let args = ["commit-tree", await this.lookup(tree)]
      for (const p of parents) {
        // if there aren't parents we get one parent that == ""
        if (p.length) {
          let key = await this.lookup(p)
          args.push("-p", key)
        }
      }
      log.error(args)
      let commitTree = spawn("git", args, { ...this.dstOpts, env: this.COMMIT_ENV })
      let catFile = spawn("git", ["cat-file", "commit", commit], this.srcOpts)
      this.transform(catFile.stdout, commitTree.stdin)
      res = await line(commitTree.stdout)
    } else {
      // decrypt the message of the commit and hash the message
      // as a commit object
      let logMsg = spawn("git", ["log", "--pretty=format:%B", "-n", "1", commit], this.srcOpts)
      let hashObject = spawn("git", ["hash-object", "-w", "--stdin", "-t", "commit"], this.dstOpts)
      this.transform(logMsg.stdout, hashObject.stdin)
      res = await line(hashObject.stdout)
    }

    log.verbose("mirrored commit %s=>%s", commit, res)
    this.refmap[res] = commit
    return res
  }
}

module.exports = Mirror