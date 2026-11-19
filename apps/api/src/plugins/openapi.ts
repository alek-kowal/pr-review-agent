import fp from 'fastify-plugin'
import swagger from '@fastify/swagger'
import { jsonSchemaTransform } from 'fastify-type-provider-zod'

/**
 * Builds the OpenAPI document from the Zod route schemas.
 * The document is served at `GET /docs/json` (see routes/docs).
 *
 * @see https://github.com/fastify/fastify-swagger
 */
export default fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'PR Review Agent API',
        version: '0.0.0'
      }
    },
    transform: jsonSchemaTransform
  })
}, { name: 'openapi' })
