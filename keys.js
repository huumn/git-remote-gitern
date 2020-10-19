const { git, gitSync } = require('./git.js')
const { spawn } = require('child_process')
const { lines, line } = require('./misc.js')
const sshpk = require('sshpk')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const log = require('./logger.js')
const findit = require('findit')
const { exit } = require('process')

const FP_PREFIX = "SHA256:"
const PUBEXT = ".pub"

// tag points to a tree in repo like 
// 100644 blob <sha1>	<sha256 of user's pubkey>
// ...
// The contents of the blob is the AES key encrypted with the user's pubkey
class Keys {
  constructor(tag, repo) {
    this.repo = repo
    this.tag = tag
    this.lockedKeys = new Map()
    log.debug("new keys with tag %s repo %s", tag, repo)
  }

  load = async() => {
    await this.loadLockedKeys()

    if (this.lockedKeys.size) {
      this.key = await this.unlock()
      log.debug("found existing encryption key")
    } else {
      this.key = this.generateKey()
      log.debug("encryption key not found, generating")
    }
  }

  generateKey = () => crypto.randomBytes(32)

  hexEncodeFp = (fp) => {
    return Buffer.from(fp.replace(FP_PREFIX, ''), 'base64').toString('hex')
  }

  hexDecodeFp = (hex) => {
    return FP_PREFIX + Buffer.from(hex, 'hex').toString('base64').replace('=','')
  }

  loadLockedKeys = async() => {
    // TODO: rather than ignore error we should probably check if exists
    let lsTree = git(['ls-tree', this.tag], { cwd : this.repo, ignoreErr: true })
    for await (const line of lines(lsTree.stdout)) {
      let [mode, type, oid, name] = line.split(/[ \t]/)
      let fp  = this.hexDecodeFp(name)
      log.debug("found locked key with fp %s", fp)
      this.lockedKeys.set(fp, {mode, type, oid})
    }
  }

  saveLockedKeys = async() => {
    let mktree = git(["mktree"], { cwd : this.repo })
    log.debug("saving lockedKeys entries %d", this.lockedKeys.size)
    let objs = ""
    for (const [name, {mode, type, oid}] of this.lockedKeys.entries()) {
      objs += `${mode} ${type} ${oid}\t${this.hexEncodeFp(name)}\n`
    }
    log.debug("saving locked keys:\n%s", objs)
    mktree.stdin.write(objs)
    mktree.stdin.end()
    let oid = await line(mktree.stdout)
    
    gitSync(["update-ref", this.tag, oid], { cwd : this.repo })
  }

  addLockedKey = async(fp, lockedKey) => {
    let hashObject = git(["hash-object", "-w", "--stdin"], { cwd : this.repo })
    hashObject.stdin.write(lockedKey)
    hashObject.stdin.end()
    let oid = await line(hashObject.stdout)
    this.lockedKeys.set(fp, {mode: "100644", type: "blob", oid})
    log.debug("added locked key fp %s oid %s", fp, oid)
  }

  save = async(account) => {
    let giternList = spawn("ssh", ["git@gitern.com", "gitern-pubkey-list", 
      "--full", account])
    let updated = false
    
    for await (const line of lines(giternList.stdout)) {
      let key = sshpk.parseKey(line)
      let fp = key.fingerprint().toString()
      log.debug("account %s has pubkey %s", account, fp)
      if (this.lockedKeys.has(fp)) continue

      updated = true
      let lockedKey = crypto.publicEncrypt(key.toBuffer('pkcs8'), this.key)
      await this.addLockedKey(fp, lockedKey)
    }
    
    if (updated) this.saveLockedKeys()
  }

  // TODO: not sure how to get this to work given stdin is being
  // used by git
  getPrivateKeyPass = (privKeyFname) => {
    return new Promise((ok, err) => {
      log.debug("Prompting for password")
      require('read')({ 
          prompt: `Password for key ${privKeyFname}: `, 
          silent: true,
          output: process.stderr,
        }, (error, password) => {
          if (error) {
            log.error("problem reading password", error)
            err(error)
          } else {
            log.info("got password")
            ok(password)
          }        
        })
    })
  }

  getPrivateKey = async(privKeyFname, privKeyRaw, opts = {}) => {
    log.debug("parsing private key")
    try {
      return sshpk.parsePrivateKey(privKeyRaw, 'auto', opts)
    } catch(e) {
      if (e instanceof sshpk.KeyEncryptedError) {
        log.warn("gitern encrypted repos do not support encrypted ssh keys currently")
        throw e
        // log.debug("key requires a password")
        // let password = await this.getPrivateKeyPass(privKeyFname)
        // return await this.getPrivateKey(privKeyFname, privKeyRaw, {password})
      } else {
        throw e
      }
    }
  }

  findKeyFiles = () => {
    return new Promise((resolve, reject) => {
      let sshdir = path.join(require('os').homedir(), '.ssh')
      let finder = findit(sshdir)
      let files = []
      log.debug("looking for gitern ssh keys in %s", sshdir)
  
      finder.on('file', (file, stat) => {
        if (path.extname(file) != PUBEXT) {
          return
        }
        
        // parse the file to see if it's the right public key
        try {
          log.debug("trying file %s", file)
          let pubkey = sshpk.parseKey(fs.readFileSync(file))
          let fp = pubkey.fingerprint().toString()
          log.debug("file is an ssh key with fingerprint %s", fp)
          if (this.lockedKeys.has(fp)) {
            log.debug("file %s matches fp %s", file, fp)
            files.push({fp, file})
          }
        } catch (e) {
          // we expect this to happen for non-key files
          if (e instanceof sshpk.KeyParseError) return
          reject(e)
        }
      })

      finder.on('error', function (err) {
        reject(err)
      })

      finder.on('end', () => {
        resolve(files)
      })
    })
  }

  unlock = async() => {
    let keyFiles = await this.findKeyFiles()

    for (const {fp, file} of keyFiles) {
      // attempt to read private key file
      let privKeyFname = file.slice(0, -1*PUBEXT.length)
      let privKeyRaw = fs.readFileSync(privKeyFname)
      let privKey
      try {
        privKey = await this.getPrivateKey(privKeyFname, privKeyRaw.toString())
      } catch(e) {
        log.warn("could not decrypt ssh private key %s", privKeyFname)
        continue
      }
      const {oid} = this.lockedKeys.get(fp)
      const catFile = gitSync(['cat-file', '-p', oid], { cwd : this.repo })
      return crypto.privateDecrypt({
        key: privKey.toBuffer('pkcs8'),
        format: 'pem',
        type: 'pkcs8',
      }, Buffer.from(catFile.stdout))
    }
    log.error("could not unlock encryption key with available ssh keys")
    process.exit(1)
  }
}

module.exports = Keys
