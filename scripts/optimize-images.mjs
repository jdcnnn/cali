import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const input = fileURLToPath(new URL('../src/assets/carlo.png', import.meta.url))
const output = fileURLToPath(new URL('../src/assets/carlo.webp', import.meta.url))

await sharp(input)
  .rotate()
  .webp({ quality: 82, effort: 6, smartSubsample: true })
  .toFile(output)

const metadata = await sharp(output).metadata()
console.log(`Optimized carlo.webp (${metadata.width}x${metadata.height}, WebP quality 82).`)
