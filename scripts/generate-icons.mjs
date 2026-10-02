import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

// One geometry source for all platforms. Run: npm run icons
const source = readFileSync(new URL('../public/icons/cali-mark.svg', import.meta.url), 'utf8')
const mark = source
  .replace(/^<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .replace(/<title>.*?<\/title>/s, '')
  .trim()
const wrap = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n  <title>Cali</title>\n${body}\n</svg>\n`
const regular = wrap(`<rect width="512" height="512" rx="112" fill="#F6FCFF"/>\n${mark}`)
// Scaling about center keeps even the mark's bounding-box corners inside r=204.8.
const maskable = wrap(`<rect width="512" height="512" fill="#F6FCFF"/>\n<g transform="translate(256 256) scale(.88) translate(-256 -256)">${mark}</g>`)
const apple = wrap(`<rect width="512" height="512" fill="#F6FCFF"/>\n${mark}`)
// The wordmark cap is already optimized for small sizes; every platform shares it.
const smallMark = mark
const favicon = wrap(`<rect width="512" height="512" rx="104" fill="#F6FCFF"/>
<g transform="translate(256 256) scale(1.10) translate(-256 -256)">${smallMark}</g>`)
const capPath = source.match(/<path id="wordmark-cap-shape"[^>]*\/>/)?.[0]
if (!capPath) throw new Error('Cali cap silhouette was not found.')
// Android uses only the alpha mask for the small notification icon. Keep the
// canvas transparent and use one solid silhouette so it never becomes a box.
const notificationBadge = wrap(`<svg x="86" y="133" width="340" height="247" viewBox="525 30 200 145">
  ${capPath.replace(/fill="[^"]*"/, 'fill="#FFFFFF"')}
</svg>`)
const root = new URL('../', import.meta.url)
const save = (path, data) => writeFileSync(new URL(path, root), data)
const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
save('public/icons/cali-icon.svg', regular)
save('public/icons/cali-maskable.svg', maskable)
save('public/favicon.svg', favicon)
for (const size of [192, 512]) {
  save(`public/icons/cali-${size}.png`, png(regular, size))
  save(`public/icons/cali-maskable-${size}.png`, png(maskable, size))
}
save('public/icons/apple-touch-icon.png', png(apple, 180))
save('public/icons/favicon-32.png', png(favicon, 32))
save('public/icons/cali-notification-badge.png', png(notificationBadge, 96))

// Preview artifacts are deliberately outside the public bundle.
mkdirSync(new URL('dist/icon-preview/', root), { recursive: true })
save('dist/icon-preview/cali.png', png(regular, 512))
const cells = [16, 32, 48, 180, 192, 512].map((size, index) => {
  const x = 24 + index * 120
  const display = Math.min(size, 96)
  const svg = size <= 32 ? favicon : regular
  const raster = png(svg, size).toString('base64')
  return `<image x="${x}" y="32" width="${display}" height="${display}" href="data:image/png;base64,${raster}"/><text x="${x}" y="153" font-family="sans-serif" font-size="14" fill="#173247">${size}px</text>`
}).join('')
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="744" height="410" viewBox="0 0 744 410"><defs><clipPath id="circle"><circle cx="128" cy="128" r="128"/></clipPath><clipPath id="rounded"><rect width="256" height="256" rx="56"/></clipPath></defs><rect width="744" height="410" fill="#E3EBF1"/>${cells}<svg x="50" y="180" width="200" height="200" viewBox="0 0 256 256"><g clip-path="url(#circle)"><image width="256" height="256" href="data:image/png;base64,${png(maskable, 512).toString('base64')}"/></g></svg><svg x="300" y="180" width="200" height="200" viewBox="0 0 256 256"><g clip-path="url(#rounded)"><image width="256" height="256" href="data:image/png;base64,${png(maskable, 512).toString('base64')}"/></g></svg></svg>`
save('dist/icon-preview/sizes-and-masks.png', new Resvg(sheet).render().asPng())
console.log('Generated Cali favicon, Apple touch, PWA icons, and dist/icon-preview previews.')
