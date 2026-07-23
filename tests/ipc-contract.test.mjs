import assert from 'node:assert/strict'
import test from 'node:test'
import { assertIPCArguments } from '../electron/ipc-contract.mjs'

test('IPC 合约区分无参数、文本与对象载荷', () => {
  assert.doesNotThrow(() => assertIPCArguments('settings:choose-directory', []))
  assert.doesNotThrow(() => assertIPCArguments('link:open', ['https://example.com']))
  assert.doesNotThrow(() => assertIPCArguments('document:list', [{ libraryPath: '/vault' }]))

  assert.throws(() => assertIPCArguments('settings:choose-directory', [{}]))
  assert.throws(() => assertIPCArguments('link:open', [{}]))
  assert.throws(() => assertIPCArguments('document:list', [[]]))
})
