import fp from 'fastify-plugin'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'

/**
 * Makes Zod the schema language for every route: request validation
 * and response serialization both go through fastify-type-provider-zod.
 * Type routes with `FastifyPluginAsyncZod` to get typed requests and replies.
 *
 * @see https://github.com/turkerdev/fastify-type-provider-zod
 */
export default fp(async (fastify) => {
  fastify.setValidatorCompiler(validatorCompiler)
  fastify.setSerializerCompiler(serializerCompiler)
}, { name: 'zod' })
