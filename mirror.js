const { spawn, spawnSync } = require('child_process')
const { exit } = require('process')
const { resolve } = require('path')
const readline = require('readline')
const log = require('./logger.js')
const crypt = require('./crypt.js')

async function* lines(input) {
  let rl= readline.createInterface({
    input: input,
    terminal: false
  })
  for await (const line of rl) {
    yield line
  }
}

class Mirror {
  constructor(src, dest, push) {
    this.srcSpawnOpts = { shell: true, cwd: resolve(src), stdio: ['pipe', 'pipe', 'inherit'] }
    this.destSpawnOpts = { shell: true, cwd: resolve(dest), stdio: ['pipe', 'pipe', 'inherit'] }
    this.push = push
    this.transform = push ? crypt.en : crypt.de
    log.debug("", this.srcSpawnOpts, this.destSpawnOpts)
  }

  mirror = async (ref, remote) => {
    let revList = spawn("git rev-list", ["--reverse", ref, "--not", `--remotes=${remote}`], this.srcSpawnOpts)
  
    let parent = null
    for await (const commit of lines(revList.stdout)) {
      parent = await this.mirrorCommit(commit, parent)
    }

    // update-ref <ref> <parent>
    // TODO: will be worth verifying old ref, see manpage
    if (this.push && parent) {
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
  
    // TODO: rewrite the commit with the old commit object as an encrypted message
    // TODO: use commit-tree to rewrite the object
    // NOTE: commit-tree gets author info from the command line and ..
    //       we should override this info with something fun, e.g. leonardo da vinci
    //       leonardo@mona.me
    //     let commitTreeArgs = [tree]
    // if (parent) {
    //  commitTreeArgs.push("-p", parent)
    // }
    // commitTree = spawn("git commit-tree", commitTreeArgs, destSpawnOpts)
    let commitTree = spawn("git hash-object", ["-w", "--stdin", "-t", "commit"], this.destSpawnOpts)
    let catFile = spawn("git cat-file", ["commit", commit], this.srcSpawnOpts)
    catFile.stdout.pipe(commitTree.stdin)
    
    let object = lines(commitTree.stdout)
    log.debug("committed tree!", object)
    return object
  }

  mirrorObject = async(oid, type) => {
    let hashObject = spawn("git hash-object", ["-w", "--stdin", "-t", type], this.destSpawnOpts)
    let catFile = spawn("git cat-file", [type, oid], this.srcSpawnOpts)
    this.transform(catFile.stdout, hashObject.stdin)
    return lines(hashObject.stdout)
  }

  mirrorTree = async (tree) => {
    // get list of objects in tree and write them into new tree
    // if object is a tree recurse effectively doing a depth first
    // rewrite of the object graph
    log.debug("mirroring tree %s", tree)
  
    let lsTree = spawn("git ls-tree", [tree], this.srcSpawnOpts)
    // for await (const line of spawnLine(lsTree.stdout))
    let readLsTree = readline.createInterface({
      input: lsTree.stdout,
      terminal: false
    })
  
    // for await (const line of spawnLine(ls.Tree.stdout))
    let objs = ""
    for await (const line of readLsTree) {
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