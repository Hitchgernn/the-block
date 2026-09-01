// Day 1 Slack smoke test per workflow.md Phase 0.
// Run: node --env-file=.env.local scripts/slack-smoke.mjs

import { WebClient } from '@slack/web-api'

const token = process.env.SLACK_BOT_TOKEN
const channel = process.env.SLACK_CHANNEL_ID

if (!token || !channel) {
  console.error('Missing SLACK_BOT_TOKEN or SLACK_CHANNEL_ID. See .env.example.')
  process.exit(1)
}

const slack = new WebClient(token)

const auth = await slack.auth.test()
console.log(`authed as ${auth.user} in workspace ${auth.team}`)

const posted = await slack.chat.postMessage({
  channel,
  text: 'Saturday 9am is short two people.',
})
console.log(`posted to ${posted.channel} at ts ${posted.ts}`)
