import assert from 'node:assert/strict'
import test from 'node:test'
import { createFileSnapshotCache } from '../electron/file-snapshot-cache.mjs'

test('文件指纹未变化时复用解析结果', async () => {
  const cache = createFileSnapshotCache()
  let reads = 0
  const load = async () => ({ value: ++reads })

  assert.deepEqual(await cache.read('/vault', '/vault/a.md', '1', load), { value: 1 })
  assert.deepEqual(await cache.read('/vault', '/vault/a.md', '1', load), { value: 1 })
  assert.deepEqual(await cache.read('/vault', '/vault/a.md', '2', load), { value: 2 })
  assert.equal(reads, 2)
})

test('清理与重建会移除失效文件缓存', async () => {
  const cache = createFileSnapshotCache()
  let reads = 0
  const load = async () => ++reads

  await cache.read('/vault', '/vault/a.md', '1', load)
  await cache.read('/vault', '/vault/b.md', '1', load)
  cache.prune('/vault', new Set(['/vault/a.md']))
  await cache.read('/vault', '/vault/b.md', '1', load)
  cache.clear('/vault')
  await cache.read('/vault', '/vault/a.md', '1', load)
  assert.equal(reads, 4)
})
