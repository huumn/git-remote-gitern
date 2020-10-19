# git-remote-gitern

git-remote-gitern is a git remote helper that end to end encrypts git repos without a custom remote receiver and without additional user key management. It's built for [gitern](https://gitern.com) and unironically hosted here. For demonstation purposes you can browse this repo encrypted using itself: [github.com/huumn/git-remote-gitern-encrypted](https://github.com/huumn/git-remote-gitern-encrypted)

## Installation

```bash
npm install -g git-remote-gitern
```

## Usage

You'll need a free [gitern](https://gitern.com) account. Push and pull encrypted gitern repos using a remote address like `gitern://some/path/to/repo`.

## Examples

Push
```bash
gitern create ldv/an/encrypted/repo
git remote add gitern gitern://ldv/an/encrypted/repo
git push gitern master
```

"Clone" 
```bash
git init
git remote add gitern gitern://ldv/an/encrypted/repo
git pull gitern master
```

## Quirks
These will be the targeted in future releases.

1. Cloning is not supported
2. Password protected SSH keys are not supported
3. Slow
4. Space inefficient

## How it works
git-remote-gitern creates an encrypted object graph that has identical structure to your git repo's unencrypted object graph. This encrypted object graph behaves like any other git repo but all of its objects are encrypted. It keeps track of the mapping between unencrypted and encrypted objects using a flat file stored in the encrypted repo. This mapping allows git-remote-gitern to determine the revision of an unencrypted repo relative to an encrypted one.

- *Blobs* are encrypted as is
- *Trees* are rewritten to point to encrypted objects
    - Object names are encrypted and hex encoded
- *Commit* objects are encrypted whole, base64 encoded, and stored as the message of the analogous commit in the encrypted repo

Currently, the encrypted version of an unencrypted repo is stored inside the .git directory of the unencrypted repo. (Hence the space inefficiency.) On a push, encrypted copies of objects are stored in the encrypted repo then the encrypted repo is pushed to the remote. A fetch is this process in reverse.

The algorithm used to encrypt objects is `AES-256-CBC` and each object gets a randomly generated IV. Delta compression is ineffective.

## How key management works
A symmetric key is generated for each repo and is used to encrypt the repo. For each ssh public key on the [gitern](https://gitern.com) account, the symmetric key is encrypted with this ssh public key and stored in the encrypted repo. Thus any computer with an ssh private key corresponding to an ssh public key used to encrypt the symmetric key can decrypt a git-remote-gitern repo.

## Contributing
Pull requests are welcome.

## License
[GPLv3](https://choosealicense.com/licenses/gpl-3.0/)
