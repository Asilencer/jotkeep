import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import path from 'node:path'

const repository = 'Asilencer/jotkeep'
const latestReleaseURL = `https://github.com/${repository}/releases/latest`
const releaseTagPrefix = `/${repository}/releases/tag/`
const releaseAssetPrefix = `/${repository}/releases/download/`
const versionPattern = /^v?(\d+)\.(\d+)\.(\d+)$/
const checksumPattern = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i

const parseVersion = (value) => {
  const match = String(value).trim().match(versionPattern)
  return match ? match.slice(1).map(Number) : null
}

export const compareVersions = (left, right) => {
  const leftParts = parseVersion(left)
  const rightParts = parseVersion(right)
  if (!leftParts || !rightParts) throw new Error('Invalid application version')
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1
    }
  }
  return 0
}

const trustedReleaseURL = (value) => {
  try {
    const target = new URL(value)
    return (
      target.protocol === 'https:'
      && target.hostname === 'github.com'
      && target.pathname.startsWith(releaseAssetPrefix)
    )
  } catch {
    return false
  }
}

const releaseVersionFromURL = (value) => {
  try {
    const target = new URL(value, latestReleaseURL)
    if (
      target.protocol !== 'https:'
      || target.hostname !== 'github.com'
      || !target.pathname.startsWith(releaseTagPrefix)
    ) return null
    const tag = decodeURIComponent(target.pathname.slice(releaseTagPrefix.length))
    return parseVersion(tag)
  } catch {
    return null
  }
}

export const fetchLatestGithubUpdate = async ({
  fetcher,
  currentVersion,
  architecture,
}) => {
  const response = await fetcher(latestReleaseURL, {
    headers: {
      'User-Agent': `Jotkeep/${currentVersion}`,
    },
    redirect: 'follow',
  })
  const releasePage = response.ok ? await response.text() : ''
  const releaseURL = releasePage.match(
    /<meta property="og:url" content="([^"]+)"/,
  )?.[1]
  const latestVersionParts = releaseVersionFromURL(releaseURL)
  if (!latestVersionParts) {
    throw new Error(`GitHub release tag is not a stable version (${response.status})`)
  }
  const latestVersion = latestVersionParts.join('.')
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    return {
      available: false,
      currentVersion,
      latestVersion,
    }
  }

  const expectedName = `Jotkeep-${latestVersion}-${architecture}.dmg`
  const releaseTag = `v${latestVersion}`
  const assetURL = `https://github.com/${repository}/releases/download/${releaseTag}/${expectedName}`
  const checksumURL = `https://github.com/${repository}/releases/download/${releaseTag}/SHA256SUMS.txt`
  const checksumResponse = await fetcher(checksumURL, {
    headers: {
      'User-Agent': `Jotkeep/${currentVersion}`,
    },
    redirect: 'follow',
  })
  if (!checksumResponse.ok) {
    throw new Error(`GitHub release does not contain SHA256SUMS.txt (${checksumResponse.status})`)
  }

  const checksum = (await checksumResponse.text())
    .split(/\r?\n/)
    .map((line) => line.match(checksumPattern))
    .find((match) => match?.[2] === expectedName)?.[1]
  const assetResponse = await fetcher(assetURL, {
    method: 'HEAD',
    headers: {
      'User-Agent': `Jotkeep/${currentVersion}`,
    },
    redirect: 'follow',
  })
  const bytes = Number(assetResponse.headers.get('content-length'))
  if (!checksum || !assetResponse.ok || !Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error('GitHub release asset is missing integrity metadata')
  }

  return {
    available: true,
    currentVersion,
    latestVersion,
    releaseName: `Jotkeep ${releaseTag}`,
    releaseURL: `https://github.com/${repository}/releases/tag/${releaseTag}`,
    asset: {
      name: expectedName,
      url: assetURL,
      bytes,
      sha256: checksum.toLowerCase(),
    },
  }
}

export const downloadGithubUpdate = async ({
  fetcher,
  update,
  targetDirectory,
  onProgress,
}) => {
  if (!update?.asset || !trustedReleaseURL(update.asset.url)) {
    throw new Error('Invalid GitHub update asset')
  }

  await mkdir(targetDirectory, { recursive: true })
  const targetPath = path.join(targetDirectory, update.asset.name)
  const partialPath = `${targetPath}.partial`
  await rm(partialPath, { force: true })

  const response = await fetcher(update.asset.url, {
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': `Jotkeep/${update.currentVersion}`,
    },
    redirect: 'follow',
  })
  if (!response.ok || !response.body) {
    throw new Error(`GitHub update download failed (${response.status})`)
  }

  const hash = createHash('sha256')
  const reader = response.body.getReader()
  let file
  let transferred = 0
  let lastProgress = -1

  try {
    file = await open(partialPath, 'w')
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      transferred += value.byteLength
      if (transferred > update.asset.bytes) throw new Error('GitHub update is larger than expected')
      hash.update(value)
      await file.write(value)
      const progress = Math.min(
        99.9,
        Math.round((transferred / update.asset.bytes) * 1000) / 10,
      )
      if (progress !== lastProgress) {
        lastProgress = progress
        onProgress?.({ progress, transferred, total: update.asset.bytes })
      }
    }
    await file.close()
    file = null

    if (transferred !== update.asset.bytes) {
      throw new Error('GitHub update size does not match release metadata')
    }
    if (hash.digest('hex') !== update.asset.sha256) {
      throw new Error('GitHub update checksum does not match release metadata')
    }

    await rm(targetPath, { force: true })
    await rename(partialPath, targetPath)
    onProgress?.({ progress: 100, transferred, total: update.asset.bytes })
    return targetPath
  } catch (error) {
    await file?.close().catch(() => {})
    await rm(partialPath, { force: true })
    throw error
  } finally {
    reader.releaseLock()
  }
}
