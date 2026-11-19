import Fastify from 'fastify'
import { expect, test } from 'vitest'
import Errors from '../../src/plugins/errors.ts'
import { build } from '../helper.ts'

test('an invalid body returns 400 invalid_request with the failing paths', async () => {
  const app = await build()

  const res = await app.inject({ method: 'POST', url: '/example', payload: { text: '' } })

  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({
    error: {
      code: 'invalid_request',
      params: { part: 'body', issues: [{ path: '/text', code: 'too_small' }] }
    }
  })
})

test('a malformed JSON body returns 400 invalid_request', async () => {
  const app = await build()

  const res = await app.inject({
    method: 'POST',
    url: '/example',
    headers: { 'content-type': 'application/json' },
    payload: '{"text":'
  })

  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: { code: 'invalid_request', params: {} } })
})

test('a valid body passes validation', async () => {
  const app = await build()

  const res = await app.inject({ method: 'POST', url: '/example', payload: { text: 'hello' } })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ text: 'hello', length: 5 })
})

test('an unexpected error returns 500 internal_error without details', async () => {
  const fastify = Fastify()
  await fastify.register(Errors)
  fastify.get('/boom', async () => {
    throw new Error('secret detail')
  })
  await fastify.ready()

  const res = await fastify.inject({ url: '/boom' })

  expect(res.statusCode).toBe(500)
  expect(res.json()).toEqual({ error: { code: 'internal_error', params: {} } })
  expect(res.payload).not.toContain('secret detail')
  await fastify.close()
})
