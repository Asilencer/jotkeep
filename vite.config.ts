import { execFile } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))
const weatherHelper = path.join(
  rootDirectory,
  'native',
  'build',
  'WeatherBridge.app',
  'Contents',
  'MacOS',
  'WeatherBridge',
)

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'note-down-live-weather',
      configureServer(server) {
        server.middlewares.use('/api/weather', (_request, response) => {
          execFile(
            weatherHelper,
            [],
            { maxBuffer: 1024 * 1024, timeout: 45_000 },
            (error, stdout) => {
              const output = stdout.trim().split('\n').at(-1)
              response.statusCode = error ? 503 : 200
              response.setHeader('Cache-Control', 'no-store')
              response.setHeader('Content-Type', 'application/json; charset=utf-8')
              response.end(output || JSON.stringify({
                ok: false,
                error: {
                  code: 'weather-helper-unavailable',
                  message: '天气定位服务暂不可用。',
                },
              }))
            },
          )
        })
      },
    },
  ],
})
