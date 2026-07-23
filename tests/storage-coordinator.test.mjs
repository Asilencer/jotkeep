import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  flushStorageOperations,
  serializePersistentWrite,
  withStorageMaintenance,
  writeTextAtomically,
} from '../electron/storage-coordinator.mjs'

test('写入按文件串行并可统一 flush', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jotkeep-storage-'))
  const target = path.join(directory, 'state.json')
  try {
    const first = serializePersistentWrite(target, () => writeTextAtomically(target, 'first'))
    const second = serializePersistentWrite(target, () => writeTextAtomically(target, 'second'))
    await Promise.all([first, second, flushStorageOperations()])
    assert.equal(await readFile(target, 'utf8'), 'second')
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('恢复完成后拒绝维护期间排队的旧写入', async () => {
  let releaseMaintenance
  const maintenanceStarted = new Promise((resolve) => {
    releaseMaintenance = resolve
  })
  const maintenance = withStorageMaintenance(
    async () => {
      await maintenanceStarted
    },
    { discardQueuedWrites: true },
  )
  await Promise.resolve()
  const queued = serializePersistentWrite('virtual-state', async () => {})
  releaseMaintenance()
  await maintenance
  await assert.rejects(queued, { code: 'storage-generation-changed' })
})
