const { spawn, spawnSync } = require('child_process')
const { exit } = require('process')
const { resolve } = require('path')
const readline = require('readline')

class Mirror {
  constructor(src, dest) {
    this.srcSpawnOpts = { shell: true, cwd: resolve(src), stdio: ['pipe', 'pipe', 'inherit'] }
    this.destSpawnOpts = { shell: true, cwd: resolve(dest), stdio: ['pipe', 'pipe', 'inherit'] }
    console.error(this.srcSpawnOpts, this.destSpawnOpts)
  }

  mirror = async (ref, remote, push) => {
    let revList = spawn("git rev-list", ["--reverse", ref], this.srcSpawnOpts)
  
    let readRevList = readline.createInterface({
      input: revList.stdout,
      terminal: false
    })
  
    let parent = null
    for await (const commit of readRevList) {
      parent = await this.mirrorCommit(commit, parent)
    }

    // update-ref <ref> <parent>
    // TODO: might be worth verifying old ref, see manpage
    if (push) {
      let updateRef = spawnSync("git update-ref", [ref, parent], this.destSpawnOpts)
      if (updateRef.status != 0) {
        console.error("failed to update-ref")
        exit(updateRef.status)
      }
    }
  }

  mirrorCommit = async (commit, parent) => {
    console.error("mirrorCommit", commit, parent)
  
    // rewrite the tree
    let tree = await this.mirrorTree(commit)
    console.error("mirrorCommit tree", tree)
  
    let commitTreeArgs = [tree]
    if (parent) {
      commitTreeArgs.push("-p", parent)
    }
  
    // TODO: rewrite the commit with the old commit object as the message
    // commit-tree gets author info from the command line
    // eventually we will instead use commit-tree
    // commitTree = spawn("git commit-tree", commitTreeArgs, destSpawnOpts)
    let commitTree = spawn("git hash-object", ["-w", "--stdin", "-t", "commit"], this.destSpawnOpts)
    let catFile = spawn("git cat-file", ["commit", commit], this.srcSpawnOpts)
    catFile.stdout.pipe(commitTree.stdin)
    let readCommitTree = readline.createInterface({
      input: commitTree.stdout,
      terminal: false
    })
    for await (const object of readCommitTree) {
      console.error("committed tree!", object)
      return object
    }
  }

  mirrorTree = async (tree) => {
    // get list of objects in tree and write them into new tree
    // if object is a tree recurse effectively doing a depth first
    // rewrite of the object graph
  
    console.error("mirrorTree", tree)
  
    let lsTree = spawn("git ls-tree", [tree], this.srcSpawnOpts)
    let readLsTree = readline.createInterface({
      input: lsTree.stdout,
      terminal: false
    })
  
    let objs = ""
    for await (const line of readLsTree) {
      console.error("mirrorTree line", line)
      let [mode, type, sha1, name] = line.split(/[ \t]/)
      switch (type) {
        case "blob":
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
          console.error("unexpected object type", type)
          exit(1)
      }
    }
    console.error("mirrorTree objects", objs)
    let mktree = spawn("git mktree", [], this.destSpawnOpts)
    let readMkTree = readline.createInterface({
      input: mktree.stdout,
      terminal: false
    })
    mktree.stdin.write(objs)
    mktree.stdin.end()
    console.error("mirrorTree await mktree")
    for await (const object of readMkTree) {
      console.error("mirrorTree mktree", object)
      return object
    }
  
    console.error("mirrorTree no return")
  }
}

module.exports =  Mirror