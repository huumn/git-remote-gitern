const { spawn, spawnSync } = require('child_process')
const { exit } = require('process')
const { resolve } = require('path')
const readline = require('readline')
const log = require('./logger.js')

class Mirror {
  constructor(src, dest) {
    this.srcSpawnOpts = { shell: true, cwd: resolve(src), stdio: ['pipe', 'pipe', 'inherit'] }
    this.destSpawnOpts = { shell: true, cwd: resolve(dest), stdio: ['pipe', 'pipe', 'inherit'] }
    log.debug("", this.srcSpawnOpts, this.destSpawnOpts)
  }

  mirrorObject = async(object) => {
    // to mirror an object we git cat-file blob <object> (from src) | (to dst) git hash-object -w -stdin
    // to mutate and simulate encryption:
    //  we do something like cat-file | aes ecrypt | hash-object
    //    this adds a line "hey ya'll\n" to the object
    // to unmutate and simulate decryption:
    //  we undo something like cat-file | sed "$d" | hash-object
    let hashObject = spawn("git hash-object", ["-w", "--stdin"], this.destSpawnOpts)
    let catFile = spawn("git cat-file", ["blob", object], this.srcSpawnOpts)
    catFile.stdout.pipe(hashObject.stdin)
    let readHashObject = readline.createInterface({
      input: hashObject.stdout,
      terminal: false
    })
  }

  mirror = async (ref, remote, push) => {
    let revList = spawn("git rev-list", ["--reverse", ref, "--not", `--remotes=${remote}`], this.srcSpawnOpts)
  
    let readRevList = readline.createInterface({
      input: revList.stdout,
      terminal: false
    })
  
    let parent = null
    for await (const commit of readRevList) {
      parent = await this.mirrorCommit(commit, parent)
    }

    // update-ref <ref> <parent>
    // TODO: will be worth verifying old ref, see manpage
    if (push && parent) {
      log.warn("git update-ref %s %s", ref, parent)
      let updateRef = spawnSync("git update-ref", [ref, parent], this.destSpawnOpts)
      if (updateRef.status != 0) {
        log.error("failed to update-ref %s %s", ref, parent)
        exit(updateRef.status)
      }
    }
  }

  mirrorCommit = async (commit, parent) => {
    log.debug("mirroring commit %s with parent %s", commit, parent)
  
    // rewrite the tree
    let tree = await this.mirrorTree(commit)
  
    let commitTreeArgs = [tree]
    if (parent) {
      commitTreeArgs.push("-p", parent)
    }
  
    // TODO: rewrite the commit with the old commit object as the message
    // commit-tree gets author info from the command line
    // eventually we will instead use commit-tree
    // commitTree = spawn("git commit-tree", commitTreeArgs, destSpawnOpts)
    // call (un)mutate
    let commitTree = spawn("git hash-object", ["-w", "--stdin", "-t", "commit"], this.destSpawnOpts)
    let catFile = spawn("git cat-file", ["commit", commit], this.srcSpawnOpts)
    catFile.stdout.pipe(commitTree.stdin)
    let readCommitTree = readline.createInterface({
      input: commitTree.stdout,
      terminal: false
    })
    for await (const object of readCommitTree) {
      log.debug("committed tree!", object)
      return object
    }
  }

  mirrorTree = async (tree) => {
    // get list of objects in tree and write them into new tree
    // if object is a tree recurse effectively doing a depth first
    // rewrite of the object graph
    log.debug("mirroring tree %s", tree)
  
    let lsTree = spawn("git ls-tree", [tree], this.srcSpawnOpts)
    let readLsTree = readline.createInterface({
      input: lsTree.stdout,
      terminal: false
    })
  
    let objs = ""
    for await (const line of readLsTree) {
      log.debug("mirroring line %s", line)
      let [mode, type, sha1, name] = line.split(/[ \t]/)
      switch (type) {
        case "blob":
          // call (un)mutate
          let hashObject = spawn("git hash-object", ["-w", "--stdin"], this.destSpawnOpts)
          let catFile = spawn("git cat-file", ["blob", sha1], this.srcSpawnOpts)
          catFile.stdout.pipe(hashObject.stdin)
          let readHashObject = readline.createInterface({
            input: hashObject.stdout,
            terminal: false
          })
          for await (const object of readHashObject) {
            objs += `${mode} ${type} ${object}\t${name}\n`
          }
          break
        case "tree":
          let treesha = await this.mirrorTree(sha1, name)
          objs += `${mode} ${type} ${treesha}\t${name}\n`
          break
        default:
          log.error("unexpected object line %s", line)
          exit(1)
      }
    }
    log.debug("making tree with objects:\n%s", objs)
    let mktree = spawn("git mktree", [], this.destSpawnOpts)
    let readMkTree = readline.createInterface({
      input: mktree.stdout,
      terminal: false
    })
    mktree.stdin.write(objs)
    mktree.stdin.end()
    for await (const object of readMkTree) {
      log.debug("made tree %s", object)
      return object
    }
  }
}

module.exports =  Mirror