
const { spawn } = require('child_process')
const { lines, line } = require('./misc.js')
const sshpk = require('sshpk')
const { publicEncrypt } = require('crypto')
const path = require('path')
const fs = require('fs')


// at CRYPT_KEYS it's a tree like 
// 100644 blob <sha1>	<sha256 of user's pubkey>
// ...
// The contents of the blob is the AES key encrypted with the user's pubkey
class LockedKeychain {
  constructor(tag, repoOpts) {
    this.repoOpts = repoOpts
    this.tag = tag
    this.lockedKeys = new Map()
    loadLockedKeys()

    if (this.lockedKeys.size) {
      this.key = unlock
    } else {
      this.key = generateKey()
    }
  }

  generateKey = () => crypto.randomBytes(32)

  loadLockedKeys = async() => {
    let lsTree = spawn("git", ['ls-tree', this.tag], this.repoOpts)
    for await (const line of lines(lsTree.stdout)) {
      let [mode, type, oid, name] = line.split(/[ \t]/)
      this.lockedKeys[name] = {mode, type, oid}
    }
  }

  saveLockedKeys = () => {
    let mktree = spawn("git", ["mktree"], this.repoOpts)
    let objs = ""
    for (const [name, {mode, type, oid}] of this.lockedKeys.entries()) {
      objs += `${mode} ${type} ${oid}\t${name}`
    }
    mktree.stdin.write(objs)
    mktree.stdin.end()
    let oid = await line(mktree.stdout)
    
    let updateRef = spawnSync("git", ["update-ref", tag, oid], this.repoOpts)
    if (updateRef.status != 0) {
      log.error("failed to update tag ref %s %s", ref, parent)
      throw updateRef.status
    }
  }

  addLockedKey = (fp, lockedKey) => {
    let hashObject = spawn("git", ["hash-object", "-w", "--stdin"], this.repoOpts)
    hashObject.stdin.write(lockedKey)
    hashObject.stdin.end()
    let oid = await line(hashObject.stdout)
    keychain[fp] = {mode, type, oid}
  }

  save = () => {
    let giternList = spawn("ssh", ["git@gitern.com", "gitern-pubkey-list", 
      "--full", account])
    let updated = false
    
    for await (const line of lines(giternList.stdout)) {
      let key = sshpk.parseKey(line)
      let fp = key.fingerprint().toString()
      if (this.lockedKeys.has(fp)) continue

      update = true
      let lockedKey = crypto.publicEncrypt(key.toBuffer('pkcs8'), this.key)
      addLockedKey(fp, lockedKey)
    }
    
    if (updated) saveLockedKeys()
  }

  getPrivateKeyPass = (privKeyFname) => {
    return new Promise((ok, err) => {
      require('read')(
        { 
          prompt: `Password for key ${privKeyFname}: `, 
          silent: true, 
        }, 
        (error, password) => {
          if (error) {
            err(error)
          } else {
            ok(password)
          }        
        }
      )
    }
  }

  getPrivateKey = async(privKeyFname, privKeyRaw, opts = {}) => {
    try {
      return sshpk.parsePrivateKey(privKeyRaw, {})
    } catch(e) {
      if (e instanceof sshpk.KeyEncryptedError) {
        let password = await getPrivateKeyPass(privKeyFname)
        return this.getPrivateKey(privKeyFname, privKeyRaw, {password})
      } else {
        throw e
      }
    }
  }

  PUBEXT = ".pub"
  unlock = () => {
    return new Promise((resolve, reject) => {
      let sshdir = path.join(require('os').homedir(), '.ssh')
      let finder = require('findit')(sshdir)
  
      finder.on('file', function (file, stat) {
        if (path.extname(file) != PUBEXT) return
        
        // parse the file to see if it's the right public key
        let privKeyRaw
        let privKeyFname
        let pubkey
        try {
          pubkey = sshpk.parseKey(fs.readFileSync(file))
          if (this.LockedKeys.has(pubkey.fingerprint())) {
            // attempt to read private key file
            privKeyFname = file.slice(0, -1*PUBEXT.length)
            privKeyRaw = fs.readFileSync(privKeyFname)
            let privKey = getPrivateKey(privKeyFname, privKeyRaw)
            
            finder.stop()

            const {oid} = this.lockedKeys.get(privKey.fingerprint().toString())
            const catFile = spawnSync("git", ['cat-file', '-p', oid])
            resolve(crypto.privateDecrypt(privKey, catFile.stdout))
          }
        } catch (e) {
          // we expect this to happen for non-key files
          if (e instanceof KeyParseError) return
          reject(e)
        }
      })
  
      reject(new Error(`Could not find matching ssh key in ${sshdir}`))
    })
  }
}
