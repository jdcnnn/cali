import { buildOpenRouterReviewerBody, parseGeneratedReviewerResponse } from '../server/reviewerGeneration.ts'

const models = ['nvidia/nemotron-3-super-120b-a12b:free', 'dots-studio/dots-3-note-preview:free']
const key = process.env.OPENROUTER_API_KEY
if (!key) throw new Error('OPENROUTER_API_KEY is required')

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Cali Study AI verification' }
const catalogResponse = await fetch('https://openrouter.ai/api/v1/models', { headers })
if (!catalogResponse.ok) throw new Error(`OpenRouter catalog returned ${catalogResponse.status}`)
const catalog = await catalogResponse.json()
for (const slug of models) {
  const model = catalog.data?.find(candidate => candidate.id === slug)
  if (!model) throw new Error(`${slug} is missing from OpenRouter's live catalog`)
  if (Number(model.pricing?.prompt) !== 0 || Number(model.pricing?.completion) !== 0) throw new Error(`${slug} is no longer free`)
  const parameters = model.supported_parameters ?? []
  if (!parameters.includes('response_format') && !parameters.includes('structured_outputs')) throw new Error(`${slug} does not advertise structured-output support`)
}

const verificationResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST', headers,
  body: JSON.stringify(buildOpenRouterReviewerBody(
    'Photosynthesis lets plants convert light energy into chemical energy. It occurs in chloroplasts. The light-dependent reactions produce ATP and NADPH. The Calvin cycle uses them to build sugars from carbon dioxide.',
    'concise',
  )),
})
if (!verificationResponse.ok) throw new Error(`Structured-output check returned ${verificationResponse.status}: ${await verificationResponse.text()}`)
const verification = await verificationResponse.json()
const parsed = parseGeneratedReviewerResponse(verification.choices?.[0]?.message?.parsed ?? verification.choices?.[0]?.message?.content)
if (!parsed) throw new Error(`Structured-output check returned an invalid reviewer (${verification.choices?.[0]?.finish_reason ?? 'unknown finish reason'})`)
console.log(`Study AI verified with ${verification.model ?? 'OpenRouter fallback'}. Both configured models remain free and structured-output capable.`)
