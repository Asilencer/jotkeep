import { useEffect, useRef, useState } from 'react'

export type WeatherSceneKind =
  | 'clear-day'
  | 'clear-night'
  | 'partly-cloudy'
  | 'cloudy'
  | 'overcast'
  | 'rain'
  | 'storm'
  | 'snow'
  | 'fog'

type WeatherAtmosphereProps = {
  scene: WeatherSceneKind
  cloudCover: number
  precipitationIntensity: number
  windSpeed: number
  isDaylight: boolean
  paused: boolean
}

const vertexShaderSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const fragmentShaderSource = `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 out_color;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_scene;
uniform float u_cloud;
uniform float u_precipitation;
uniform float u_daylight;
uniform float u_wind;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32);
  return fract(point.x * point.y);
}

float value_noise(vec2 point) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  local = local * local * (3.0 - 2.0 * local);
  float a = hash21(cell);
  float b = hash21(cell + vec2(1.0, 0.0));
  float c = hash21(cell + vec2(0.0, 1.0));
  float d = hash21(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, local.x), mix(c, d, local.x), local.y);
}

float fbm(vec2 point) {
  float value = 0.0;
  float amplitude = 0.54;
  mat2 rotation = mat2(0.80, 0.60, -0.60, 0.80);
  for (int octave = 0; octave < 5; octave++) {
    value += amplitude * value_noise(point);
    point = rotation * point * 2.03 + 13.7;
    amplitude *= 0.48;
  }
  return value;
}

float cloud_field(vec2 uv, float scale, float offset) {
  float wind = 0.008 + min(u_wind, 45.0) * 0.00034;
  vec2 drift = vec2(u_time * wind * offset, u_time * 0.0016);
  vec2 point = uv * vec2(scale, scale * 1.34) + drift;
  float body = fbm(point);
  float detail = fbm(point * 2.18 - vec2(u_time * wind * 0.32, 8.4));
  float vertical = smoothstep(0.18, 0.48, uv.y) * smoothstep(1.08, 0.72, uv.y);
  float threshold = mix(0.72, 0.43, clamp(u_cloud, 0.0, 1.0));
  return smoothstep(threshold, threshold + 0.18, body * 0.76 + detail * 0.24) * vertical;
}

float rain_layer(vec2 uv, float scale, float speed, float offset) {
  float aspect_ratio = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 point = uv * vec2(scale * aspect_ratio, scale * 0.62);
  point.x += point.y * 0.28;
  vec2 cell = floor(point);
  float seed = hash21(cell + offset);
  vec2 local = fract(point) - 0.5;
  local.y = fract(local.y + u_time * speed + seed) - 0.5;
  float x = local.x - (seed - 0.5) * 0.72;
  float line = 1.0 - smoothstep(0.012, 0.055, abs(x));
  float tail = 1.0 - smoothstep(0.10, 0.48, abs(local.y));
  return line * tail * step(0.30, seed);
}

float snow_layer(vec2 uv, float scale, float speed, float offset) {
  float aspect_ratio = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 point = uv * vec2(scale * aspect_ratio, scale);
  vec2 cell = floor(point);
  float seed = hash21(cell + offset);
  vec2 local = fract(point) - 0.5;
  local.y = fract(local.y + u_time * speed + seed) - 0.5;
  local.x += sin(u_time * 0.7 + seed * 18.0 + point.y) * 0.18;
  float radius = mix(0.045, 0.15, seed);
  return (1.0 - smoothstep(radius * 0.55, radius, length(local))) * step(0.23, seed);
}

vec3 sky_palette(float y) {
  vec3 bottom;
  vec3 top;
  if (u_daylight < 0.5) {
    bottom = vec3(0.105, 0.155, 0.265);
    top = vec3(0.018, 0.035, 0.092);
  } else if (u_scene > 6.5 && u_scene < 7.5) {
    bottom = vec3(0.68, 0.74, 0.77);
    top = vec3(0.35, 0.45, 0.52);
  } else if (u_scene > 5.5 && u_scene < 6.5) {
    bottom = vec3(0.28, 0.36, 0.42);
    top = vec3(0.085, 0.13, 0.18);
  } else if (u_scene > 3.5) {
    bottom = vec3(0.37, 0.47, 0.53);
    top = vec3(0.17, 0.25, 0.31);
  } else if (u_scene > 2.5) {
    bottom = vec3(0.54, 0.67, 0.75);
    top = vec3(0.22, 0.38, 0.49);
  } else {
    bottom = vec3(0.62, 0.80, 0.94);
    top = vec3(0.16, 0.48, 0.79);
  }
  return mix(bottom, top, smoothstep(0.0, 1.0, y));
}

void main() {
  vec2 uv = v_uv;
  vec3 color = sky_palette(uv.y);
  float night = 1.0 - step(0.5, u_daylight);
  vec2 light_position = vec2(0.78, 0.78);
  float aspect_ratio = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 light_space = (uv - light_position) * vec2(aspect_ratio, 1.0);
  float light_distance = length(light_space);

  if (night > 0.5) {
    vec2 star_grid = uv * vec2(96.0, 28.0);
    vec2 star_cell = floor(star_grid);
    vec2 star_local = fract(star_grid) - 0.5;
    float star_seed = hash21(star_cell);
    vec2 star_offset = vec2(
      hash21(star_cell + vec2(11.7, 3.1)),
      hash21(star_cell + vec2(5.3, 17.9))
    ) - 0.5;
    float star_radius = mix(0.055, 0.14, hash21(star_cell + 7.4));
    float star_distance = length(star_local - star_offset * 0.72);
    float star_edge = max(fwidth(star_distance) * 1.2, 0.015);
    float star_core = 1.0 - smoothstep(
      star_radius - star_edge,
      star_radius + star_edge,
      star_distance
    );
    float star_halo = 1.0 - smoothstep(star_radius, star_radius * 3.2, star_distance);
    float star_presence = step(0.962, star_seed);
    float twinkle = 0.78 + 0.22 * sin(u_time * (0.36 + star_seed * 0.28) + star_seed * 24.0);
    float star_visibility = star_presence * twinkle * smoothstep(0.28, 0.90, uv.y);
    vec3 star_color = mix(vec3(0.64, 0.74, 0.94), vec3(0.96, 0.94, 0.84), star_seed);
    color += star_color * (star_core + star_halo * 0.16) * star_visibility;

    color += vec3(0.22, 0.30, 0.48) * exp(-light_distance * 3.2) * 0.16;
  } else {
    float direct_light = 1.0 - smoothstep(3.2, 4.2, u_scene);
    float daylight_glow = exp(-light_distance * 2.4);
    color += vec3(1.0, 0.78, 0.44) * daylight_glow * 0.16 * direct_light;
  }

  float first_cloud = cloud_field(uv + vec2(0.04, 0.04), 2.42, 0.72);
  float second_cloud = cloud_field(uv * 1.08 - vec2(0.31, 0.02), 3.18, 1.0);
  float cloud = clamp(first_cloud * 0.72 + second_cloud * 0.76, 0.0, 1.0);
  float cloud_light = cloud_field(uv + vec2(0.018, 0.016), 2.42, 0.72);
  float cloud_depth = clamp(cloud - cloud_light * 0.42, 0.0, 1.0);
  vec3 bright_cloud = u_daylight > 0.5
    ? vec3(0.88, 0.91, 0.92)
    : vec3(0.23, 0.29, 0.40);
  vec3 dark_cloud = u_scene > 4.5
    ? vec3(0.16, 0.23, 0.28)
    : vec3(0.49, 0.57, 0.62);
  vec3 cloud_color = mix(bright_cloud, dark_cloud, clamp(cloud_depth * 2.5, 0.0, 1.0));
  float cloud_opacity = mix(0.52, 0.96, clamp(u_cloud, 0.0, 1.0));
  color = mix(color, cloud_color, cloud * cloud_opacity);

  float rain_scene = step(4.5, u_scene) * (1.0 - step(6.5, u_scene));
  float rain_amount = rain_scene * max(0.45, clamp(u_precipitation / 7.0, 0.0, 1.0));
  float rain = rain_layer(uv, 19.0, 1.34, 1.2);
  rain += rain_layer(uv + 0.19, 29.0, 1.72, 7.8) * 0.62;
  rain += rain_layer(uv - 0.13, 42.0, 2.06, 15.4) * 0.36;
  color = mix(color, vec3(0.72, 0.86, 0.93), clamp(rain * rain_amount, 0.0, 0.68));

  float snow_scene = step(6.5, u_scene) * (1.0 - step(7.5, u_scene));
  float snow = snow_layer(uv, 14.0, 0.10, 2.8);
  snow += snow_layer(uv + 0.17, 21.0, 0.16, 11.7) * 0.72;
  color = mix(color, vec3(0.95, 0.97, 0.98), clamp(snow * snow_scene, 0.0, 0.92));

  float fog_scene = step(7.5, u_scene);
  float fog = fbm(vec2(uv.x * 2.8 + u_time * 0.008, uv.y * 5.2));
  fog = smoothstep(0.24, 0.92, fog) * smoothstep(0.05, 0.72, 1.0 - uv.y);
  color = mix(color, vec3(0.72, 0.76, 0.76), fog * fog_scene * 0.76);

  float wet_ground = rain_amount * smoothstep(0.22, 0.0, uv.y);
  float ground_noise = fbm(vec2(uv.x * 7.0, uv.y * 19.0 - u_time * 0.05));
  vec3 reflected = mix(vec3(0.08, 0.15, 0.20), color, ground_noise * 0.36);
  color = mix(color, reflected, wet_ground * 0.58);

  if (u_scene > 5.5 && u_scene < 6.5) {
    float cycle = floor(u_time * 0.17);
    float phase = fract(u_time * 0.17);
    float trigger = step(0.84, hash21(vec2(cycle, 18.4)));
    float flash = 1.0 - smoothstep(0.0, 0.035, abs(phase - 0.92));
    color += vec3(0.63, 0.71, 0.91) * flash * trigger * 0.75;
  }

  float vignette = 1.0 - smoothstep(0.34, 0.84, length((uv - 0.5) * vec2(0.78, 1.0)));
  color *= mix(0.76, 1.0, vignette);
  float grain = hash21(gl_FragCoord.xy + fract(u_time) * 100.0) - 0.5;
  color += grain / 255.0 * 1.8;
  color = pow(max(color, 0.0), vec3(0.94));
  out_color = vec4(color, 1.0);
}
`

const sceneCodes: Record<WeatherSceneKind, number> = {
  'clear-day': 0,
  'clear-night': 1,
  'partly-cloudy': 2,
  cloudy: 3,
  overcast: 4,
  rain: 5,
  storm: 6,
  snow: 7,
  fog: 8,
}

const motionIsReduced = () => {
  const setting = document.documentElement.dataset.reduceMotion
  return (
    setting === 'on' ||
    (setting !== 'off' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  )
}

function useReducedMotion() {
  const [reduced, setReduced] = useState(motionIsReduced)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(motionIsReduced())
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reduce-motion'],
    })
    media.addEventListener('change', sync)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', sync)
    }
  }, [])

  return reduced
}

const compileShader = (gl: WebGL2RenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to create the weather shader.')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unable to compile the weather shader.'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

const createProgram = (gl: WebGL2RenderingContext) => {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource)
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource)
  const program = gl.createProgram()
  if (!program) throw new Error('Unable to create the weather renderer.')
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unable to link the weather renderer.'
    gl.deleteProgram(program)
    throw new Error(message)
  }
  return program
}

export default function WeatherAtmosphere({
  scene,
  cloudCover,
  precipitationIntensity,
  windSpeed,
  isDaylight,
  paused,
}: WeatherAtmosphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    if (!gl) {
      canvas.dataset.renderer = 'fallback'
      return
    }

    let program: WebGLProgram
    try {
      program = createProgram(gl)
    } catch (error) {
      canvas.dataset.renderer = 'fallback'
      console.error(error)
      return
    }

    const position = gl.getAttribLocation(program, 'a_position')
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    )
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    gl.useProgram(program)

    const uniforms = {
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      time: gl.getUniformLocation(program, 'u_time'),
      scene: gl.getUniformLocation(program, 'u_scene'),
      cloud: gl.getUniformLocation(program, 'u_cloud'),
      precipitation: gl.getUniformLocation(program, 'u_precipitation'),
      daylight: gl.getUniformLocation(program, 'u_daylight'),
      wind: gl.getUniformLocation(program, 'u_wind'),
    }

    const resize = () => {
      const bounds = canvas.getBoundingClientRect()
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(bounds.width * pixelRatio))
      const height = Math.max(1, Math.round(bounds.height * pixelRatio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)
      gl.uniform2f(uniforms.resolution, width, height)
    }

    const startedAt = performance.now()
    let animationFrame = 0
    let previousFrame = 0

    const draw = (timestamp: number) => {
      if (timestamp - previousFrame < 1000 / 60) {
        animationFrame = requestAnimationFrame(draw)
        return
      }
      previousFrame = timestamp
      resize()
      gl.uniform1f(uniforms.time, (timestamp - startedAt) / 1000)
      gl.uniform1f(uniforms.scene, sceneCodes[scene])
      gl.uniform1f(uniforms.cloud, Math.min(1, Math.max(0, cloudCover)))
      gl.uniform1f(uniforms.precipitation, Math.max(0, precipitationIntensity))
      gl.uniform1f(uniforms.daylight, isDaylight ? 1 : 0)
      gl.uniform1f(uniforms.wind, Math.max(0, windSpeed))
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (!paused && !reduceMotion) animationFrame = requestAnimationFrame(draw)
    }

    const resizeObserver = new ResizeObserver(() => {
      if (paused || reduceMotion) draw(performance.now())
    })
    resizeObserver.observe(canvas)
    draw(performance.now())

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [cloudCover, isDaylight, paused, precipitationIntensity, reduceMotion, scene, windSpeed])

  return (
    <canvas
      className={`weather-atmosphere is-${scene}`}
      ref={canvasRef}
      aria-hidden="true"
    />
  )
}
