const { spawn, spawnSync } = require('child_process')
const { exit } = require('process')
const { resolve } = require('path')
const { lines } = require('./misc.js')
const log = require('./logger.js')
const crypt = require('./crypt.js')

class Mirror {
  constructor(src, dest, push) {
    this.srcOpts = { cwd: resolve(src), stdio: ['pipe', 'pipe', 'inherit'] }
    this.dstOpts = { cwd: resolve(dest), stdio: ['pipe', 'pipe', 'inherit'] }
    this.push = push
    this.transform = push ? crypt.en : crypt.de
    log.debug("", this.srcOpts, this.dstOpts)
  }
  mirror = async (ref, remote) => {
    // TODO: limit this to just the relevant objects so we don't have to recurse
    // for non-new objects ... this will require some enref.map
    let revList = spawn("git",
                        ["rev-list", "--reverse", ref, "--not", `--remotes=${remote}`], 
                        this.srcOpts)

    let parent = null
    for await (const commit of lines(revList.stdout)) {
      parent = await this.mirrorCommit(commit, parent)
    }

    // TODO: should verify old ref - see manpage
    // update-ref <ref> <parent>
    if (this.push && parent) {
      log.warn("git update-ref %s %s", ref, parent)
      let updateRef = spawnSync("git", 
                                ["update-ref", ref, parent], 
                                this.dstOpts)
      if (updateRef.status != 0) {
        log.error("failed to update-ref %s %s", ref, parent)
        exit(updateRef.status)
      }
    }
  }

  COMMIT_ENV = {
    ...process.env, ...{
      GIT_AUTHOR_DATE: "1977-06-10T12:00:00",
      GIT_COMMITER_DATE="1994-10-13T12:00:00",
      GIT_AUTHOR_EMAIL="leo@mona.me",
      GIT_AUTHOR_NAME="Leonardo di ser Piero da Vinci",
      GIT_COMMITTER_EMAIL="leo@mona.me",
      GIT_COMMITTER_NAME="Leonardo di ser Piero da Vinci",
    }
  }

  mirrorCommit = async (commit, parent) => {
    log.debug("mirroring commit %s with parent %s", commit, parent)
    // rewrite the underlying tree
    let tree = await this.mirrorTree(commit)

    // TODO: we need to base64 encode/decode the message in addition to en/de
    let res
    if (this.push) {
      // we encrypt the message and send to the encrypted message to commit-tree
      let args = [tree]
      if (parent) args.push("-p", parent)
      let commitTree = spawn("git", args, {...this.dstOpts, env: this.COMMIT_ENV})
      let catFile = spawn("git", 
                          ["cat-file", "commit", commit], 
                          this.srcOpts)
      this.transform(catFile.stdout, commitTree.stdin)
      res = lines(commitTree.stdout)
    } else {
      // decrypt the message of the commit and hash the message
      //  as a commit object
      let logMsg = spawn("git", ["log", "--format=%B", "-n", "1", commit], this.srcOpts)
      let hashObject = spawn("git", ["hash-object","-w", "--stdin", "-t", "commit"], this.dstOpts)
      this.transform(logMsg.stdout, hashObject.stdin)
      res = lines(hashObject.stdout)
    }

    log.debug("mirrored commit!", res)
    return res
  }

  mirrorObject = async (oid, type) => {
    let hashObject = spawn("git", ["hash-object","-w", "--stdin", "-t", type], this.dstOpts)
    let catFile = spawn("git", ["cat-file", type, oid], this.srcOpts)
    this.transform(catFile.stdout, hashObject.stdin)
    return lines(hashObject.stdout)
  }

  mirrorTree = async (tree) => {
    // get list of objects in tree and write them into new tree
    // if object is a tree recurse effectively doing a depth first
    // rewrite of the object graph
    log.debug("mirroring tree %s", tree)

    let lsTree = spawn("git ls-tree", [tree], this.srcOpts)
    let objs = ""

    // TODO: encrypt file/dir names
    for await (const line of lines(lsTree.stdout)) {
      log.debug("mirroring line %s", line)
      let [mode, type, oid, name] = line.split(/[ \t]/)
      switch (type) {
        case "blob":
          let moid = await this.mirrorObject(oid, type)
          objs += `${mode} ${type} ${moid}\t${name}\n`
          break
        case "tree":
          let treesha = await this.mirrorTree(oid, name)
          objs += `${mode} ${type} ${treesha}\t${name}\n`
          break
        default:
          log.error("unexpected object line %s", line)
          exit(1)
      }
    }

    log.debug("making tree with objects:\n%s", objs)
    let mktree = spawn("git", ["mktree"], this.dstOpts)
    mktree.stdin.write(objs)
    mktree.stdin.end()
    let object = lines(mktree)
    log.debug("mirrored tree %s", object)
    return object
  }
}

module.exports = Mirror