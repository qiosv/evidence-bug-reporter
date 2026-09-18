import { requireEnv, logEnvDiagnostics } from './env'
import { createApp } from './app'

const env = requireEnv()
const app = createApp(env)

app.listen(env.port, () => {
  console.log(`Evidence Replay API on http://localhost:${env.port}`)
  logEnvDiagnostics(env)
})
