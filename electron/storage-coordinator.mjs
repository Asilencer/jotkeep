import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const writeQueues = new Map()
const storageOperations = new Map()

let maintenanceQueue = Promise.resolve()
let maintenanceGate = Promise.resolve()
let storageGeneration = 0
let storageSequence = 0

const storageInterruptedError = () => {
  const error = new Error('Storage changed while the operation was waiting')
  error.code = 'storage-generation-changed'
  return error
}

const settledFailure = (results) =>
  results.find((result) => result.status === 'rejected')?.reason

const waitFor = async (promises) => {
  if (promises.length === 0) return
  const results = await Promise.allSettled(promises)
  const failure = settledFailure(results)
  if (failure) throw failure
}

export const runStorageOperation = (operation) => {
  const gate = maintenanceGate
  const generation = storageGeneration
  const sequence = storageSequence + 1
  storageSequence = sequence
  const pending = gate.then(async () => {
    if (generation !== storageGeneration) throw storageInterruptedError()
    return operation()
  })
  storageOperations.set(sequence, pending)
  void pending.finally(() => storageOperations.delete(sequence)).catch(() => {})
  return pending
}

export const serializePersistentWrite = (targetPath, operation) => {
  const previous = writeQueues.get(targetPath) ?? Promise.resolve()
  const pending = runStorageOperation(async () => {
    await previous.catch(() => {})
    return operation()
  })
  writeQueues.set(targetPath, pending)
  void pending.finally(() => {
    if (writeQueues.get(targetPath) === pending) writeQueues.delete(targetPath)
  }).catch(() => {})
  return pending
}

export const flushStorageOperations = async () => {
  while (storageOperations.size > 0) {
    await waitFor([...new Set(storageOperations.values())])
  }
}

export const withStorageMaintenance = (operation, { discardQueuedWrites = false } = {}) => {
  const cutoff = storageSequence
  const previousGate = maintenanceGate
  let releaseGate
  const blockedGate = new Promise((resolve) => {
    releaseGate = resolve
  })
  maintenanceGate = previousGate.then(() => blockedGate)
  const pending = maintenanceQueue
    .catch(() => {})
    .then(async () => {
      try {
        await previousGate
        await waitFor(
          [...storageOperations.entries()]
            .filter(([sequence]) => sequence <= cutoff)
            .map(([, storageOperation]) => storageOperation),
        )
        return await operation()
      } finally {
        if (discardQueuedWrites) storageGeneration += 1
        releaseGate()
      }
    })
  maintenanceQueue = pending.then(() => undefined, () => undefined)
  return pending
}

export const writeTextAtomically = async (targetPath, content) => {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`
  let handle
  await mkdir(path.dirname(targetPath), { recursive: true })
  try {
    handle = await open(temporaryPath, 'w')
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryPath, targetPath)
    const directory = await open(path.dirname(targetPath), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
  } catch (error) {
    await handle?.close().catch(() => {})
    await rm(temporaryPath, { force: true })
    throw error
  }
}
