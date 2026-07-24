const channelsWithoutPayload = new Set([
  'capture:consume',
  'navigation:consume-document',
  'settings:choose-directory',
  'settings:open-config-directory',
  'updates:check',
  'updates:download',
])

const channelsWithStringPayload = new Set([
  'clipboard:write-text',
  'link:metadata',
  'link:open',
])

export const assertIPCArguments = (channel, arguments_) => {
  if (channelsWithoutPayload.has(channel)) {
    if (arguments_.length !== 0) throw new Error(`Invalid ${channel} payload`)
    return
  }
  if (arguments_.length !== 1) throw new Error(`Invalid ${channel} payload`)
  const [payload] = arguments_
  if (channelsWithStringPayload.has(channel)) {
    if (typeof payload !== 'string') throw new Error(`Invalid ${channel} payload`)
    return
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`Invalid ${channel} payload`)
  }
}
