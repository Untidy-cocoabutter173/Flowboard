import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const files = ['dynamic/flowboard.host.js', 'dynamic/flowboard.client.js']
const forbidden = [
  [/\bimport\s*(?:\(|[{'"*])/, 'import'],
  [/\brequire\s*\(/, 'require'],
  [/\binterface\s+[A-Za-z_$]/, 'TypeScript interface'],
  [/\b(?:process|Buffer)\b/, 'Node global'],
]

for (const file of files) {
  const source = await readFile(resolve(file), 'utf8')
  Function(source)
  for (const [pattern, label] of forbidden) {
    if (pattern.test(source)) throw new Error(`${file}: forbidden ${label}`)
  }
  if (file.endsWith('.client.js') && /\bfetch\s*\(/.test(source)) throw new Error(`${file}: client fetch is forbidden`)
  if (!/^return\s+\{/m.test(source)) throw new Error(`${file}: must be a function body returning a plugin`)
  if (file.endsWith('.client.js')) {
    for (const marker of ['Jira 面板', '任务列表', '项目成员', 'field.create', 'project.member.remove', '保存 Markdown']) {
      if (!source.includes(marker)) throw new Error(`${file}: missing dynamic workspace capability ${marker}`)
    }
    for (const marker of ['meeting.agent.bind', 'meetingAgentBindings', 'meetingIntents']) {
      if (!source.includes(marker)) throw new Error(`${file}: missing dynamic meeting Supervisor capability ${marker}`)
    }
    if (source.includes('inputActions.submit') || source.includes('inputActions.setDraft')) {
      throw new Error(`${file}: meeting transcription must not drive the Composer`)
    }
  } else {
    for (const marker of ['flowboard_upsert_meeting_intent', 'flowboard_commit_meeting_intent', 'agent/turn-stopping']) {
      if (!source.includes(marker)) throw new Error(`${file}: missing dynamic meeting Supervisor capability ${marker}`)
    }
  }
}

console.log('dynamic Flowboard Host/Client sources are valid')
