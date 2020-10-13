
// at CRYPT_KEYS it's a tree like 
// 100644 blob <sha1>	SHA256:<sha256 of user's pubkey>
// ...
// The contents of the blob is the AES key encrypted with the user's pubkey
const updateKeys = async(dstOpts, tag) => {
  // key = getEcryptKey(destOpts, tag)
  // gitern pubkeys:list --full (?)
  // for each pubkey
  //  check if there's and entry
  //  if not
  //    encrypt key with pubkey => crypto.publicEncrypt(pubkey (in pem), key)
  //    add to CRYPT_KEYS
  // if there are changes to CRYPT_KEYS
  //  commit them
}

const getEncryptionKey = async(dstOpts, tag) => {
  // get current user's ssh pubkey for gitern.com
  // check if there's a matching key in CRYPT_KEYS
  // if so
  //  unencrypt key
  //  return this key
  // else 
  //  return err
}

// get current user's ssh pubkey
const getPubkey = async() => {

}

// pubkey is the sha256 for the key
const getPrivKey = async(pubkey) => {
  // find corresponding private key on the user's computer
  // lots of trickery here 
  // search in ~/.ssh for the right file using ssh-keygen -l -E sha256 -f
}