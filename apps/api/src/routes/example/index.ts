import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod/v4'

const EchoBody = z.object({
  text: z.string().min(1).max(200)
})

const EchoResponse = z.object({
  text: z.string(),
  length: z.number().int()
})

const example: FastifyPluginAsyncZod = async (fastify, opts): Promise<void> => {
  fastify.get('/', async function (request, reply) {
    return 'this is an example'
  })

  // Sample Zod route: the body is validated and typed, the response serialized by the schema
  fastify.post('/', {
    schema: {
      body: EchoBody,
      response: { 200: EchoResponse }
    }
  }, async function (request) {
    return { text: request.body.text, length: request.body.text.length }
  })
}

export default example
