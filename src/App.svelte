<script>
import { onMount } from 'svelte'

//音
const FREQ = 440
const SR = 48000

const volumes = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0]

const SAMPLES = [
  {
    label: 'バイオリン',
    volumes: [1, 0.45, 0.12, 0.32, 0.19, 0.19, 0.67, 0.22, 0, 0],
  }, {
    label: 'クラリネット',
    volumes: [0.5, 0, 1, 0.3, 0, 0.07, 0, 0, 0, 0],
  }, {
    label: 'サイン波',
    volumes: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
]

const audioContext = new AudioContext()
const buffer = audioContext.createBuffer(2, SR, SR)
const bufferL = buffer.getChannelData(0)
const bufferR = buffer.getChannelData(1)

let sound = null

const generateWave = () => {
  if (sound !== null) {
    sound.stop()
  }

  const amp = 1.0 / volumes.reduce((a, b) => a + b, 0)
  for (let i = 0; i < SR; i += 1) {
    let value = volumes.reduce((sum, volume, j) => {
      return sum + Math.sin(i / SR * (FREQ * (j + 1) * 2 * Math.PI)) * volume * amp
    }, 0)
    bufferL[i] = value
    bufferR[i] = value
  }

  draw()
}

//波形の図
const WIDTH = 480
const HEIGHT = 120

let canvas
let canvasCtx = null

const draw = () => {
  if (canvasCtx === null) return

  canvasCtx.clearRect(0, 0, WIDTH, HEIGHT)
  canvasCtx.fillStyle = '#040720'
  canvasCtx.fillRect(0, 0, canvas.width, canvas.height)

  canvasCtx.fillStyle = '#00ffff'
  for (let i = 0; i < WIDTH; i += 1) {
    canvasCtx.fillRect(i, bufferL[i] * HEIGHT / 4 + HEIGHT / 2, 1, 1)
  }
}

onMount(() => {
  canvasCtx = canvas.getContext('2d')

  generateWave()
  draw()
})


const play = () => {
  sound = audioContext.createBufferSource()
  sound.buffer = buffer
  sound.loop = true
  sound.connect(audioContext.destination)

  sound.start()
}

const stop = () => {
  if (sound === null) return
  sound.stop()
}

const reset = () => {
  if (sound !== null) {
    sound.stop()
  }

  volumes[0] = 1
  for (let i = 1; i < 10; i += 1) {
    volumes[i] = 0
  }
  generateWave()
}

const applyPreset = (value) => {
  value.forEach((v, i) => {
    volumes[i] = v
  })
  generateWave()
}
</script>

<div class="w-[480px] m-20 text-gray-900 text-center">

  <div>
    <button class="inline-block mx-3 px-5 py-1 border-2 border-lime-700 rounded-md hover:bg-lime-100" type="button" on:click={play}>Play</button>
    <button class="inline-block mx-3 px-5 py-1 border-2 border-rose-700 rounded-md hover:bg-rose-100" type="button" on:click={stop}>Stop</button>
    <button class="inline-block mx-3 px-5 py-1 border-2 border-gray-500 rounded-md hover:bg-gray-100" type="button" on:click={reset}>Reset</button>
  </div>

  <ul class="list-none mt-10 mb-3">
    {#each volumes as volume, i}
      <li class="flex my-1">
        <div class="w-4/12 pr-3 text-gray-700 text-sm text-right border-box">
          {i === 0 ? '基音' : `第${i + 1}倍音`}
        </div>
        <div class="w-8/12 text-left">
          <input class="w-48" type="range" min="0" max="1" step="0.01" bind:value={volume} on:change={generateWave} />
          <span class="inline-block ml-1">{volume}</span>
        </div>
      </li>
    {/each}
  </ul>

  <div class="mt-10">
    <canvas bind:this={canvas} width={WIDTH} height={HEIGHT}></canvas>
  </div>

  <div class="mt-10 text-sm text-left">
    <span>サンプルデータ</span>
    <div class="flex flex-wrap gap-1 mt-1">
      {#each SAMPLES as sample}
        <button
          type="button"
          class="px-2 py-1 rounded-sm bg-gray-200 text-xs font-bold hover:bg-gray-300"
          on:click={() => applyPreset(sample.volumes)}
        >
          {sample.label}
        </button>
      {/each}
    </div>
  </div>
</div>
