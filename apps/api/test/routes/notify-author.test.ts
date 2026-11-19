// S-08-T10: Notify author posts one ClickUp comment per signed review.
import {
  closeDb,
  createDb,
  timelineOf,
  upsertRepository,
  upsertTaskLink,
  type PullRequest,
  type Repository,
} from '@pra/db';
import { aRepositoryConfig, seedTeamMember, testDatabaseUrl } from '@pra/db/testing';
import { IntegrationError } from '@pra/integrations';
import { FakeClickUpGateway } from '@pra/integrations/testing';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { NotificationResponse } from '../../src/routes/api/notify-author/index.ts';
import { ReviewResponse } from '../../src/routes/api/reviews/index.ts';
import { build, SAME_ORIGIN } from '../helper.ts';
import { blocking, seedPr, seedRound } from '../seed.ts';

const db = createDb(testDatabaseUrl(), { max: 4 });
afterAll(() => closeDb(db));

let app: FastifyInstance;
let clickup: FakeClickUpGateway;
beforeEach(async () => {
  clickup = new FakeClickUpGateway();
  app = await build({ db, clickup });
});

let repository: Repository;
let tomek: { id: string; name: string };
beforeAll(async () => {
  repository = await upsertRepository(
    db,
    aRepositoryConfig({
      clickup: {
        workspaceId: '9012',
        spaceId: null,
        followUpListId: null,
        taskIdPattern: 'WB-\\d+',
      },
    }),
  );
  tomek = await seedTeamMember(db, { name: 'Tomek' });
});

let authors = 0;

/**
 * A PR by a new author (in Team as Kasia with `clickupUserId`, unless `inTeam` is false), linked
 * to WB-123 unless `linked` is false, with Tomek's review: 2 worth implementing, 1 not worth it.
 */
async function reviewedPr(
  options: { linked?: boolean; clickupUserId?: string | null; inTeam?: boolean } = {},
): Promise<{ pr: PullRequest; reviewId: number }> {
  const login = `kasia-${++authors}-${Date.now()}`;
  if (options.inTeam !== false) {
    await seedTeamMember(db, {
      name: 'Kasia',
      githubLogin: login,
      clickupUserId: options.clickupUserId === undefined ? '4242' : options.clickupUserId,
    });
  }
  const pr = await seedPr(db, repository.id, { authorLogin: login });
  const { findings } = await seedRound(db, pr, { findings: blocking(3) });
  if (options.linked !== false) {
    await upsertTaskLink(db, {
      pullRequestId: pr.id,
      taskId: 'WB-123',
      url: 'https://app.clickup.com/t/9012/WB-123',
      name: 'Inline edge labels',
      how: 'hand',
      linkedBy: 'hand',
      linkedByMemberId: null,
    });
  }
  const saved = await app.inject({
    method: 'POST',
    url: `/api/prs/${repository.slug}/${pr.number}/reviews`,
    headers: SAME_ORIGIN,
    payload: {
      signedBy: tomek.id,
      opinions: findings.map((f, i) => ({ findingId: f.id, value: i < 2 ? 'worth' : 'not_worth' })),
    },
  });
  expect(saved.statusCode).toBe(200);
  return { pr, reviewId: ReviewResponse.parse(saved.json()).review.id };
}

const preview = (pr: PullRequest, reviewId: number) =>
  app.inject({
    url: `/api/prs/${repository.slug}/${pr.number}/notify-author/preview?reviewId=${reviewId}`,
  });

const notify = (pr: PullRequest, reviewId: number) =>
  app.inject({
    method: 'POST',
    url: `/api/prs/${repository.slug}/${pr.number}/notify-author`,
    headers: SAME_ORIGIN,
    payload: { reviewId },
  });

describe('Notify author', () => {
  test('posts the previewed text once, mentioning the author, with a timeline entry', async () => {
    const { pr, reviewId } = await reviewedPr();

    const previewed = await preview(pr, reviewId);
    expect(previewed.statusCode).toBe(200);
    const { notification } = NotificationResponse.parse(previewed.json());
    expect(notification).toEqual({
      reviewId,
      taskId: 'WB-123',
      author: 'Kasia',
      text: `@Kasia: Tomek marked 2 findings as worth implementing and 1 finding as not worth it in PR #${pr.number}`,
      notifiedAt: null,
    });

    const posted = await notify(pr, reviewId);
    expect(posted.statusCode).toBe(200);
    const sent = NotificationResponse.parse(posted.json()).notification;
    expect(sent.notifiedAt).not.toBeNull();
    expect(clickup.callsOf('createComment')).toEqual([
      { method: 'createComment', taskId: 'WB-123', text: notification.text, mentionUserId: '4242' },
    ]);
    const entries = (await timelineOf(db, pr.id)).filter((e) => e.kind === 'author_notified');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actor: 'hand',
      params: { authorName: 'Kasia', taskId: 'WB-123', reviewId },
    });

    // A second POST for the same review posts nothing more.
    const again = await notify(pr, reviewId);
    expect(again.statusCode).toBe(200);
    expect(NotificationResponse.parse(again.json()).notification.notifiedAt).toBe(sent.notifiedAt);
    expect(clickup.callsOf('createComment')).toHaveLength(1);
    expect(NotificationResponse.parse((await preview(pr, reviewId)).json()).notification).toEqual(
      sent,
    );
  });

  test('two concurrent POSTs post one comment', async () => {
    const { pr, reviewId } = await reviewedPr();
    const responses = await Promise.all([notify(pr, reviewId), notify(pr, reviewId)]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
    expect(clickup.callsOf('createComment')).toHaveLength(1);
  });

  test('a PR without a linked task gives 409 no_linked_task without calling ClickUp', async () => {
    const { pr, reviewId } = await reviewedPr({ linked: false });
    for (const response of [await preview(pr, reviewId), await notify(pr, reviewId)]) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ error: { code: 'no_linked_task', params: {} } });
    }
    expect(clickup.calls).toHaveLength(0);
  });

  test('an author without a ClickUp user gives 409 without calling ClickUp', async () => {
    const noUser = await reviewedPr({ clickupUserId: null });
    const notInTeam = await reviewedPr({ inTeam: false });
    for (const { pr, reviewId } of [noUser, notInTeam]) {
      for (const response of [await preview(pr, reviewId), await notify(pr, reviewId)]) {
        expect(response.statusCode).toBe(409);
        expect(response.json()).toMatchObject({
          error: { code: 'author_has_no_clickup_user' },
        });
      }
    }
    expect(clickup.calls).toHaveLength(0);
  });

  test("another PR's review is not found", async () => {
    const { reviewId } = await reviewedPr();
    const { pr: other } = await reviewedPr();
    const response = await notify(other, reviewId);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: { code: 'review_not_found', params: { reviewId } } });
  });

  test('a failed post can be tried again', async () => {
    const { pr, reviewId } = await reviewedPr();
    clickup.failNext('createComment', new IntegrationError('clickup_error', { status: 500 }));
    expect((await notify(pr, reviewId)).statusCode).toBe(502);
    expect(
      NotificationResponse.parse((await preview(pr, reviewId)).json()).notification,
    ).toMatchObject({ notifiedAt: null });
    expect((await notify(pr, reviewId)).statusCode).toBe(200);
  });
});
