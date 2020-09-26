const { spawn } = require('child_process')
const { exit } = require('process')
const { resolve } = require('path')
const readline = require('readline')

class Mirror {
  constructor(src, dest) {
    this.srcSpawnOpts = { shell: true, cwd: resolve(src) }
    this.destSpawnOpts = { shell: true, cwd: resolve(dest) }
  }

  mirror = async (ref) => {
    let revList = spawn("git rev-list", ["--reverse", ref], this.srcSpawnOpts)
  
    let readRevList = readline.createInterface({
      input: revList.stdout,
      terminal: false
    })
  
    let parent = null
    for await (const commit of readRevList) {
      parent = await mirrorCommit(commit, parent)
    }
  }

  mirrorCommit = async (commit, parent) => {
    console.error("mirrorCommit", commit, parent)
  
    // rewrite the tree
    let tree = await mirrorTree(commit)
    console.error("mirrorCommit tree", tree)
  
    let commitTreeArgs = [tree]
    if (parent) {
      commitTreeArgs.push("-p", parent)
    }
  
    // rewrite the commit with the old commit object as the message
    // commit-tree gets author info from the command line
    // TODO: eventually we will instead use commit-tree
    // commitTree = spawn("git commit-tree", commitTreeArgs, destSpawnOpts)
    commitTree = spawn("git hash-object", ["-w", "--stdin", "-t", "commit"], this.destSpawnOpts)
    catFile = spawn("git cat-file", ["commit", commit], this.srcSpawnOpts)
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
      let [mode, type, sha1, name] = line.split(/[ \t]/)
      console.error("mirrorTree line", line)
      switch (type) {
        case "blob":
          hashObject = spawn("git hash-object", ["-w", "--stdin"], this.destSpawnOpts)
          catFile = spawn("git cat-file", ["blob", sha1], this.srcSpawnOpts)
          catFile.stdout.pipe(hashObject.stdin)
          let readHashObject = readline.createInterface({
            input: hashObject.stdout,
            terminal: false
          })
          for await (const object of readHashObject) {
            objs += `${mode} ${type} ${sha1}\t${name}\n`
          }
          break
        case "tree":
          treesha = await mirrorTree(sha1, name)
          objs += `${mode} ${type} ${treesha}\t${name}\n`
          break
        default:
          console.error("unexpected object type", type)
          exit(1)
      }
    }
    console.error("mirrorTree objects", objs)
    mktree = spawn("git mktree", [], this.destSpawnOpts)
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

exports.Mirror = Mirror