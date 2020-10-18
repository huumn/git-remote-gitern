const log = require("./logger")
const path = require('path')
const { spawn, spawnSync } = require('child_process')

const gitOpts = (opts) => {
  return {
    // if verbose or we are debug logging, print stderr to process stderr
    stdio: opts.verbose || log.levels[log.transports[0].level] >= 4 ? ['pipe', 'pipe', 2] : 'pipe',
    cwd: opts.cwd ? path.resolve(opts.cwd) : undefined,
    env: opts.env ? {...process.env, ...opts.env} : undefined
  }
}

const pp = (args, opts) => {
  return `'git ${args.join(' ')}' with in ${opts.cwd || path.resolve('.')}`
}

const close = (code) => {
  if (code !== 0) {
    log.error("git command failed with code %s", code)
    process.exit(code)
  }
}

const _git = (args, opts, sync = false) => {
  let spwn = sync ? spawnSync : spawn
  let spwnOpts = gitOpts(opts)

  log.debug("Running %s", pp(args, spwnOpts))
  let proc = spwn('git', args, spwnOpts)

  if (!opts.ignoreErr) {
    if (sync) {
      close(proc.status)
    } else {
      proc.on('close', close)
    }
  }

  return proc
}

const git = (args, opts = {}) => {
  return _git(args, opts, false)
}

const gitSync = (args, opts = {}) => {
  return _git(args, opts, true)
}

module.exports = {
  git,
  gitSync
}