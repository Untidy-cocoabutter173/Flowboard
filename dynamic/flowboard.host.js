return {
  inject: ['shell', 'timer'],
  apply(ctx) {
    const shell = ctx.get('shell')
    if (shell === undefined) throw new Error('Flowboard dynamic Host requires the shell service')
    const disposers = []
    const apiRoot = '${FLOWBOARD_API_BASE:-http://127.0.0.1:8787}'

    function quote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'" }
    async function run(command, stdin) {
      const result = await shell.run(shell.resolve({ command: command, stdin: stdin, stdoutMaxBytes: 24 * 1024 * 1024 }))
      const output = result.stdout && result.stdout.text ? result.stdout.text : ''
      if (result.exitCode !== 0) throw new Error((result.stderr && result.stderr.text) || output || 'Flowboard command failed')
      return output
    }
    async function api(method, path, body) {
      const command = 'curl -fsS -X ' + method + ' -H "Authorization: Bearer ${FLOWBOARD_TOKEN:?FLOWBOARD_TOKEN is required}" -H "Content-Type: application/json" ' + (body === undefined ? '' : '--data-binary @- ') + '"' + apiRoot + path + '"'
      const output = await run(command, body === undefined ? undefined : JSON.stringify(body))
      try { return JSON.parse(output) } catch (error) { throw new Error('Flowboard returned invalid JSON: ' + output.slice(0, 200)) }
    }
    function queryPath(args) {
      const pairs = []
      if (args && args.projectId) pairs.push('projectId=' + encodeURIComponent(String(args.projectId)))
      if (args && args.meetingId) pairs.push('meetingId=' + encodeURIComponent(String(args.meetingId)))
      return '/v1/snapshot' + (pairs.length ? '?' + pairs.join('&') : '')
    }
    function handle(name, fn) { disposers.push(harness.handle(name, fn)) }
    handle('summary', function () { return api('GET', '/v1/summary') })
    handle('snapshot', function (args) { return api('GET', queryPath(args || {})) })
    handle('command', function (args) { return api('POST', '/v1/commands', args || {}) })
    handle('transcribeSegment', async function (args) {
      const base64 = String(args && args.base64 || '')
      const meetingId = String(args && args.meetingId || '')
      const clientSegmentId = String(args && args.clientSegmentId || '')
      if (!base64 || !meetingId || !clientSegmentId) throw new Error('meetingId, clientSegmentId and base64 are required')
      const size = Math.max(1, Math.floor(base64.length * 3 / 4))
      const ticket = await api('POST', '/v1/uploads/tickets', { meetingId: meetingId, clientSegmentId: clientSegmentId, contentType: String(args.contentType || 'audio/webm'), size: size, startedAt: args.startedAt, endedAt: args.endedAt })
      const upload = await run('base64 -d | curl -fsS -X PUT -H ' + quote('content-type: ' + String(args.contentType || 'audio/webm')) + ' --data-binary @- ' + quote(ticket.uploadUrl), base64)
      const accepted = JSON.parse(upload)
      for (let attempt = 0; attempt < 80; attempt++) {
        const job = await api('GET', '/v1/transcriptions/' + encodeURIComponent(String(accepted.jobId)))
        if (job.state === 'completed') return job
        if (job.state === 'failed') throw new Error(job.error || 'transcription failed')
        await new Promise(function (resolve) { ctx.timer.timeout(resolve, 500) })
      }
      throw new Error('transcription timed out')
    })

    const output = { schema: { type: 'object', additionalProperties: true, properties: {} }, render: function (_args, value) { return [{ type: 'text', text: JSON.stringify(value) }] } }
    function tool(spec) { const value = harness.defineTool({ name: spec.name, description: spec.description, parameters: spec.parameters, output: output, execute: spec.execute }); disposers.push(harness.registerTool(ctx, value)) }
    function key(exec, operation) { return 'tool:' + String(exec.callId) + ':' + operation }
    tool({ name: 'flowboard_snapshot', description: '读取 Flowboard 摘要，指定项目或会议时读取完整详情。', parameters: { project_id: { type: 'string' }, meeting_id: { type: 'string' } }, execute: function (args) { return args.project_id || args.meeting_id ? api('GET', queryPath({ projectId: args.project_id, meetingId: args.meeting_id })) : api('GET', '/v1/summary') } })
    tool({ name: 'flowboard_create_task', description: '在项目中创建任务，并可关联当前会议。', parameters: { project_id: { type: 'string', required: true }, title: { type: 'string', required: true }, summary: { type: 'string' }, assignee_id: { type: 'string' }, due_at: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }, meeting_id: { type: 'string' } }, execute: async function (args, exec) { const payload = { projectId: args.project_id, title: args.title }; if (args.summary !== undefined) payload.summary = args.summary; if (args.assignee_id !== undefined) payload.assigneeId = args.assignee_id; if (args.due_at !== undefined) payload.dueAt = args.due_at; if (args.priority !== undefined) payload.priority = args.priority; if (args.meeting_id !== undefined) payload.meetingIds = [args.meeting_id]; const result = await api('POST', '/v1/commands', { idempotencyKey: key(exec, 'task.create'), type: 'task.create', payload: payload }); if (args.meeting_id) await api('POST', '/v1/commands', { idempotencyKey: key(exec, 'meeting.action:task'), type: 'meeting.action.append', payload: { id: args.meeting_id, callId: String(exec.callId), kind: 'task', summary: '创建任务：' + args.title, entityType: result.entityType, entityId: result.entityId } }); return result } })
    tool({ name: 'flowboard_create_document', description: '创建项目或会议资料。', parameters: { team_id: { type: 'string', required: true }, project_ids: { type: 'array', items: { type: 'string' }, required: true }, title: { type: 'string', required: true }, content: { type: 'string', required: true }, meeting_id: { type: 'string' } }, execute: async function (args, exec) { const payload = { teamId: args.team_id, projectIds: args.project_ids, type: 'doc', title: args.title, content: args.content }; if (args.meeting_id) payload.sourceMeetingId = args.meeting_id; return api('POST', '/v1/commands', { idempotencyKey: key(exec, 'library.create'), type: 'library.create', payload: payload }) } })
    tool({ name: 'flowboard_finalize_meeting', description: '结构化整理并结束会议，可同时创建行动项和资料。', parameters: { meeting_id: { type: 'string', required: true }, expected_version: { type: 'integer', required: true }, summary: { type: 'string', required: true }, decisions: { type: 'array', items: { type: 'string' } }, risks: { type: 'array', items: { type: 'string' } }, action_items: { type: 'array', items: { type: 'object', additionalProperties: true } }, documents: { type: 'array', items: { type: 'object', additionalProperties: true } } }, execute: function (args, exec) { return api('POST', '/v1/commands', { idempotencyKey: key(exec, 'meeting.finalize'), type: 'meeting.finalize', expectedVersion: args.expected_version, payload: { id: args.meeting_id, summary: args.summary, decisions: args.decisions || [], risks: args.risks || [], actionItems: args.action_items || [], documents: args.documents || [] } }) } })
    ctx.effect(function () { return function () { disposers.forEach(function (dispose) { try { dispose() } catch (error) {} }) } })
  },
}
