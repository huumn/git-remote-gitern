#!/usr/bin/env node
const { spawn } = require('child_process')
const readline = require('readline')

const object = process.argv[2]
const spawnOpts = { shell: true, stdio: ['pipe', 'pipe', 'inherit'] }

const en = async(input, output) => {
  input.write("hi\n", () => {
    output.pipe(input)
  })
}

const de = async(input, output) => {
  const rmHI = spawn("tail -c +4", [], spawnOpts)
  input.pipe(rmHI.stdin)
  rmHI.stdout.pipe(output)
}

// TODO: these should probably take an input and an output stream
// might also only need one function
const mutate = async (object) => {
  const hashObject = spawn("git hash-object", ["-w", "--stdin"], spawnOpts)
  const catFile = spawn("git cat-file", ["blob", object], spawnOpts)
  hashObject.stdin.write("hi\n", () => {
    catFile.stdout.pipe(hashObject.stdin)
  })

  const readHashObject = readline.createInterface({
    input: hashObject.stdout,
    terminal: false
  })

  for await (const resultObject of readHashObject) {
    return resultObject
  }
}

const unmutate = async (mutated) => {
  const hashObject = spawn("git hash-object", ["-w", "--stdin"], spawnOpts)
  const catFile = spawn("git cat-file", ["blob", mutated], spawnOpts)
  catFile.stdout.pipe(rmHI.stdin)
  rmHI.stdout.pipe(hashObject.stdin)

  const readHashObject = readline.createInterface({
    input: hashObject.stdout,
    terminal: false
  })

  for await (const resultObject of readHashObject) {
    return resultObject
  }
}
