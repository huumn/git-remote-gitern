const { git, gitSync } = require('./git.js')
const { lines, line } = require('./misc.js')
const log = require('./logger.js')
const readline = require('readline')
const { get, getKey, update } = require('./map.js')
const crypt = require('./crypt.js')

class Mirror {
  constructor(src, dst, push, refmaptag, key) {
    this.src = src
    this.dst = dst
    this.mir = push ? dst : src
    this.push = push
    if (this.push) {
      this.cryptStream = crypt.encryptStream
      this.cryptString = crypt.encryptString
    } else {
      this.cryptStream = crypt.decryptStream
      this.cryptString = crypt.decryptString
    }
    this.refmap = {}
    this.refmaptag = refmaptag
    this.key = key
    log.verbose("mirroring src %s to dst %s", src, dst)
  }

  lookup = async (oid) => {
    // if we're pushing, refmap is cryptoid => decryptoid 
    // else, it's decryptoid => cryptoid
    let obj = Object.entries(this.refmap).find(i => i[1] == oid)
    if (obj) return obj[0]

    // if we're pushing, dst is mirror, else src is mirror
    let getOID = this.push ? getKey : get
    obj = await getOID(this.mir, this.refmaptag, oid)
    if (!obj) {
      log.debug("could not find oid %s in %s", oid, this.refmaptag)
    }
    return obj
  }

  mirror = async (ref, remote) => {
    log.debug("mirroring ref %s from remote %s", ref, remote)

    // prints out: oid type size
    let not
    if (this.push) {
      not = `--remotes=${remote}`
    } else {
      // for fetch read the ref from src, perform lookup to get crytoid
      // --verify so we do a strict match (otherwise git looks in mirror for refs)
      let showRef = git(["show-ref", "--hash", '--verify', ref], 
        {cwd: this.dst, ignoreErr: true})
      let cid = await line(showRef.stdout)
      if (cid && showRef.status == 0) {
        log.debug("ref %s has oid %s in %s", ref, cid, this.dst)
        not = await getKey(this.mir, this.refmaptag, cid)
      }
    }

    // we depth first traverse the tree, using rev-list to give us the
    // deepest commit nodes ... which is a minor optimization
    let revListArgs = ["rev-list", "--in-commit-order", "--reverse",  ref, "--not"]
    if (not) revListArgs.push(not)
    let revList = git(revListArgs, {cwd: this.src})
    let lastCommit
    for await (const commit of lines(revList.stdout)) {
      lastCommit = await this.mirrorCommit(commit)
    }

    // TODO: should verify old ref if not ephemeral - see manpage
    // update-ref <ref> <parent>
    if (this.push) {
      if (lastCommit) {
        log.verbose("updating ref in dst %s %s", ref, lastCommit)
        gitSync(["update-ref", ref, lastCommit], {cwd: this.dst})
      }
      return await update(this.dst, this.refmaptag, this.refmap)
    }
  }

  objInDst = async (oid) => {
    let mapoid = await this.lookup(oid)
    if (mapoid) {
      let catFile = gitSync(["cat-file", "-e", mapoid], { cwd: this.dst, ignoreErr: true})
      if (catFile.status == 0) {
        return mapoid
      }
    }
    return null
  }

  mirrorBlob = async (oid) => {
    // lookup oid if dne, proceed
    let mapoid = await this.objInDst(oid)
    if (mapoid) {
      log.debug("blob is already mirrored %s=>%s", oid, mapoid)
      return mapoid
    }

    log.debug("mirroring blob %s", oid)
    let hashObject = git(["hash-object", "-w", "--stdin", "-t", "blob"], { cwd: this.dst })
    let catFile = git(["cat-file", "blob", oid], { cwd: this.src })
    this.cryptStream(this.key, catFile.stdout, hashObject.stdin)
    let res = await line(hashObject.stdout)
    log.verbose("mirrored blob %s=>%s", oid, res)
    this.refmap[res] = oid
    return res
  }

  mirrorTree = async (oid) => {
    // lookup oid if dne, proceed
    let mapoid = await this.objInDst(oid)
    if (mapoid) {
      log.debug("tree is already mirrored %s=>%s", oid, mapoid)
      return mapoid
    }

    // get list of objects in tree and write them into new tree
    // with mutated refs
    log.debug("mirroring tree %s", oid)

    let lsTree = git(['ls-tree', oid], { cwd: this.src })
    let objs = ""
    for await (const line of lines(lsTree.stdout)) {
      let [mode, type, oid, name] = line.split(/[ \t]/)
      let mapoid
      switch(type) {
        case "blob":
          mapoid = await this.mirrorBlob(oid)
          break
        case "tree":
          mapoid = await this.mirrorTree(oid)
          break
        default:
          log.error("unknown object type, line: %s", line)
      }

      objs += `${mode} ${type} ${mapoid}\t${await this.cryptString(this.key, name, 'hex')}\n`
    }

    log.debug("making tree with objects:\n%s", objs)
    let mktree = git(["mktree"], { cwd: this.dst })
    mktree.stdin.write(objs)
    mktree.stdin.end()
    let res = await line(mktree.stdout)
    log.verbose("mirrored tree %s=>%s", oid, res)
    this.refmap[res] = oid
    return res
  }

  COMMIT_ENV = {
    GIT_AUTHOR_DATE: "1977-06-10T12:00:00",
    GIT_COMMITTER_DATE: "1994-10-13T12:00:00",
    GIT_AUTHOR_EMAIL: "ldv@gitern.com",
    GIT_AUTHOR_NAME: "Leonardo da Vinci",
    GIT_COMMITTER_EMAIL: "ldv@gitern.com",
    GIT_COMMITTER_NAME: "Leonardo da Vinci",
  }

  // TODO: test merges
  mirrorCommit = async (commit, parent) => {
    // assume parents have been seen because rev-list actually works for that
    let logTree = git(["log", "--pretty=%T\ %P", "-n", "1", commit], { cwd: this.src })
    let srcTree = await line(logTree.stdout)
    let [tree, ...parents] = srcTree.split(/[ \t]/)
    log.debug("mirroring commit %s with tree %s parents %o", commit, tree, parents)
    
    let mirroredTree = await this.mirrorTree(tree)

    let res
    if (this.push) {
      // we encrypt the message and send to the encrypted message to commit-tree
      let args = ["commit-tree", mirroredTree]
      for (const p of parents) {
        // if there aren't parents we get one parent that == ""
        if (p.length) {
          let key = await this.lookup(p)
          args.push("-p", key)
        }
      }
      let commitTree = git(args, { cwd: this.dst, env: this.COMMIT_ENV })
      let catFile = git(["cat-file", "commit", commit], { cwd: this.src })
      this.cryptStream(this.key, catFile.stdout, commitTree.stdin, 'base64')
      res = await line(commitTree.stdout)
    } else {
      // decrypt the message of the commit and hash the message
      // as a commit object
      let logMsg = git(["log", "--pretty=format:%B", "-n", "1", commit], { cwd: this.src })
      let hashObject = git(["hash-object", "-w", "--stdin", "-t", "commit"], { cwd: this.dst })
      this.cryptStream(this.key, logMsg.stdout, hashObject.stdin, 'base64')
      res = await line(hashObject.stdout)
    }

    log.verbose("mirrored commit %s=>%s", commit, res)
    this.refmap[res] = commit
    return res
  }
}

module.exports = Mirror