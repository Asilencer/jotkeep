import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sourcePath = path.join(rootDirectory, 'assets', 'app-icon.svg')
const iconsetPath = path.join(rootDirectory, 'assets', 'app-icon.iconset')
const outputPath = path.join(rootDirectory, 'assets', 'app-icon.icns')
const sizes = [16, 32, 128, 256, 512]

rmSync(iconsetPath, { force: true, recursive: true })
mkdirSync(iconsetPath, { recursive: true })

for (const size of sizes) {
  for (const scale of [1, 2]) {
    const pixels = size * scale
    const suffix = scale === 2 ? '@2x' : ''
    execFileSync('sips', [
      '-s',
      'format',
      'png',
      '-z',
      String(pixels),
      String(pixels),
      sourcePath,
      '--out',
      path.join(iconsetPath, `icon_${size}x${size}${suffix}.png`),
    ], { stdio: 'ignore' })
  }
}

execFileSync('iconutil', ['-c', 'icns', iconsetPath, '-o', outputPath], {
  stdio: 'inherit',
})
rmSync(iconsetPath, { force: true, recursive: true })
process.stdout.write(`App icon built at ${outputPath}\n`)
