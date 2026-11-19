import {
  countActiveTeamMembers,
  getActiveTeamMember,
  isUniqueViolation,
  listTeamMembers,
} from '@pra/db';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod/v4';
import { ApiErrorCode, ApiErrorSchema, sendError } from '../../../plugins/errors.ts';
import {
  applySignedSettingsChange,
  NEW_ENTITY,
  type SignedSettingsChangeInput,
} from '../../../settings/signed-change.ts';
import {
  teamMemberSettings,
  teamStore,
  type TeamMemberSettings,
} from '../../../settings/team-store.ts';

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

const Name = z.string().trim().min(1).max(100);
/** A leading `@` is dropped, so "@kasia" and "kasia" are the same login. */
const GithubLogin = z
  .string()
  .trim()
  .transform((login) => login.replace(/^@/, ''))
  .pipe(z.string().regex(GITHUB_LOGIN));
/** An empty ClickUp user means none. */
const ClickupUserId = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((id) => (id ? id : null));
const SignedBy = z.string().trim().optional();

export const TeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  githubLogin: z.string(),
  clickupUserId: z.string().nullable(),
});
export const TeamResponse = z.object({ members: z.array(TeamMemberSchema) });
export const TeamMemberResponse = z.object({ member: TeamMemberSchema });

/** What the signer saw; when sent, a change made in between gives 409 `settings_stale`. */
const Before = z
  .object({ name: z.string(), githubLogin: z.string(), clickupUserId: z.string().nullish() })
  .optional();

const AddBody = z.object({
  name: Name,
  githubLogin: GithubLogin,
  clickupUserId: ClickupUserId,
  /** Required once Team has a member; the first member signs as themselves. */
  signedBy: SignedBy,
});
const EditBody = z.object({
  name: Name.optional(),
  githubLogin: GithubLogin.optional(),
  clickupUserId: ClickupUserId.optional(),
  signedBy: SignedBy,
  before: Before,
});
const RemoveBody = z.object({ signedBy: SignedBy, before: Before }).nullish();
const MemberParams = z.object({ id: z.string().min(1) });

const errors = { 400: ApiErrorSchema, 404: ApiErrorSchema, 409: ApiErrorSchema };

/**
 * Team (FR-076): the people who sign. Every change is signed by an active member and logged in
 * `settings_changes` with before and after. Removal is soft, so past signatures keep their name.
 */
const team: FastifyPluginAsyncZod = async (fastify): Promise<void> => {
  const { db } = fastify.deps;

  fastify.get('/', { schema: { response: { 200: TeamResponse } } }, async () => ({
    members: (await listTeamMembers(db)).map((member) => ({
      id: member.id,
      ...teamMemberSettings(member),
    })),
  }));

  fastify.post(
    '/',
    { schema: { body: AddBody, response: { 201: TeamMemberResponse, ...errors } } },
    async (request, reply) => {
      const { signedBy, ...fields } = request.body;
      const firstMember = (await countActiveTeamMembers(db)) === 0;
      return apply(reply, 201, {
        store: teamStore,
        entity: NEW_ENTITY,
        before: null,
        after: fields,
        signer: firstMember ? undefined : signedBy,
        signAsCreated: firstMember,
      });
    },
  );

  fastify.patch(
    '/:id',
    {
      schema: {
        params: MemberParams,
        body: EditBody,
        response: { 200: TeamMemberResponse, ...errors },
      },
    },
    async (request, reply) => {
      const { signedBy, before, ...patch } = request.body;
      const member = await getActiveTeamMember(db, request.params.id);
      if (!member) return notFound(reply, request.params.id);
      const current = teamMemberSettings(member);
      return apply(reply, 200, {
        store: teamStore,
        entity: member.id,
        before: before ? { ...before, clickupUserId: before.clickupUserId ?? null } : current,
        after: { ...current, ...definedFields(patch) },
        signer: signedBy,
      });
    },
  );

  fastify.delete(
    '/:id',
    {
      schema: {
        params: MemberParams,
        body: RemoveBody,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const member = await getActiveTeamMember(db, request.params.id);
      if (!member) return notFound(reply, request.params.id);
      const { signedBy, before } = request.body ?? {};
      return apply(reply, 204, {
        store: teamStore,
        entity: member.id,
        before: before
          ? { ...before, clickupUserId: before.clickupUserId ?? null }
          : teamMemberSettings(member),
        after: null,
        signer: signedBy,
      });
    },
  );

  /** Applies a signed Team change and answers with the member, or the error as a reason code. */
  async function apply(
    reply: FastifyReply,
    status: 200 | 201 | 204,
    input: SignedSettingsChangeInput<TeamMemberSettings>,
  ) {
    let result;
    try {
      result = await applySignedSettingsChange(db, input);
    } catch (error) {
      if (isUniqueViolation(error, 'team_members_github_login_active')) {
        return sendError(reply, 409, ApiErrorCode.GithubLoginTaken, {
          githubLogin: input.after?.githubLogin,
        });
      }
      throw error;
    }
    if (!result.ok) return sendError(reply, result.status, result.code, result.params);
    if (status === 204 || !result.value) return reply.code(204).send(null);
    return reply.code(status).send({ member: { id: result.entity, ...result.value } });
  }
};

const notFound = (reply: FastifyReply, id: string) =>
  sendError(reply, 404, ApiErrorCode.TeamMemberNotFound, { id });

/** The fields a PATCH sent; a field left out keeps its value. */
const definedFields = <T extends object>(patch: T): Partial<T> =>
  Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;

export default team;
