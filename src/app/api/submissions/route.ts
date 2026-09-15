import { z } from "zod";
import { ok, parseJson, parseQuery, route } from "@/lib/api";
import { canReview, requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { nextReference } from "@/lib/submissions";
import { ContentType, SubmissionStatus, type Prisma } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().max(200).optional(),
  playlistId: z.string().optional(),
  mine: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

/** Content library listing and search (Sections 31, 32). */
export const GET = route(async (request) => {
  const principal = await requirePrincipal();
  const query = parseQuery(request, listQuery);

  // Contributors may only ever see their own work; the filter is applied
  // server-side rather than trusting a `mine` flag from the client.
  const ownershipFilter = canReview(principal)
    ? query.mine === "1"
      ? { createdById: principal.id }
      : {}
    : { createdById: principal.id };

  const statuses = query.status
    ?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is SubmissionStatus =>
      Object.values(SubmissionStatus).includes(s as SubmissionStatus),
    );

  const search = query.q?.trim();
  const searchFilter: Prisma.SubmissionWhereInput = search
    ? {
        OR: [
          { computedTitle: { contains: search, mode: "insensitive" } },
          { program: { contains: search, mode: "insensitive" } },
          { topic: { contains: search, mode: "insensitive" } },
          { speaker: { contains: search, mode: "insensitive" } },
          { reference: { contains: search, mode: "insensitive" } },
          { publication: { youtubeVideoId: { contains: search, mode: "insensitive" } } },
          { createdBy: { name: { contains: search, mode: "insensitive" } } },
        ],
      }
    : {};

  const where: Prisma.SubmissionWhereInput = {
    organizationId: principal.organizationId,
    ...ownershipFilter,
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...(query.playlistId ? { playlistId: query.playlistId } : {}),
    ...searchFilter,
  };

  const rows = await db.submission.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    include: {
      playlist: { select: { id: true, title: true } },
      createdBy: { select: { id: true, name: true, email: true, image: true } },
      publication: { select: { youtubeVideoId: true, youtubeUrl: true } },
      _count: { select: { mediaFiles: true } },
    },
  });

  const hasMore = rows.length > query.limit;
  const items = hasMore ? rows.slice(0, query.limit) : rows;

  return ok({
    items: items.map((s) => ({
      id: s.id,
      reference: s.reference,
      status: s.status,
      title: s.computedTitle,
      program: s.program,
      topic: s.topic,
      speaker: s.speaker,
      playlist: s.playlist,
      author: s.createdBy,
      youtubeVideoId: s.publication?.youtubeVideoId ?? null,
      youtubeUrl: s.publication?.youtubeUrl ?? null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      publishedAt: s.publishedAt,
    })),
    nextCursor: hasMore ? items[items.length - 1]?.id : null,
  });
});

const createSchema = z.object({
  contentType: z.enum(["VIDEO", "SHORT", "IMAGE", "COMMUNITY_POST"]).default("VIDEO"),
  program: z.string().max(200).optional(),
  topic: z.string().max(300).optional(),
  speaker: z.string().max(200).optional(),
});

/**
 * Creates a draft.
 *
 * Deliberately minimal: a contributor should reach the upload control in one
 * click, not fill a long form first. Defaults (templates, playlist, channel)
 * come from the organisation so the common case needs no decisions.
 */
export const POST = route(async (request) => {
  const principal = await requirePrincipal();
  const body = await parseJson(request, createSchema);

  const [titleTemplate, descriptionTemplate, defaultPlaylist, channel] = await Promise.all([
    db.titleTemplate.findFirst({
      where: { organizationId: principal.organizationId, isActive: true },
      orderBy: { isDefault: "desc" },
    }),
    db.descriptionTemplate.findFirst({
      where: { organizationId: principal.organizationId, isActive: true },
      orderBy: { isDefault: "desc" },
    }),
    db.playlist.findFirst({
      where: { organizationId: principal.organizationId, isAllowed: true },
      orderBy: { isDefault: "desc" },
    }),
    db.youTubeChannel.findFirst({
      where: { organizationId: principal.organizationId },
      orderBy: { isDefault: "desc" },
    }),
  ]);

  const submission = await db.submission.create({
    data: {
      organizationId: principal.organizationId,
      createdById: principal.id,
      reference: await nextReference(),
      contentType: body.contentType as ContentType,
      status: SubmissionStatus.DRAFT,
      program: body.program ?? null,
      topic: body.topic ?? null,
      speaker: body.speaker ?? null,
      titleTemplateId: titleTemplate?.id ?? null,
      descriptionTemplateId: descriptionTemplate?.id ?? null,
      playlistId: defaultPlaylist?.id ?? null,
      channelId: channel?.id ?? null,
      tags: [],
      templateValues: {},
    },
  });

  await db.submissionEvent.create({
    data: {
      submissionId: submission.id,
      actorId: principal.id,
      type: "CREATED",
      message: "Draft created.",
    },
  });

  await audit({
    organizationId: principal.organizationId,
    actorId: principal.id,
    action: AuditAction.SUBMISSION_CREATED,
    entityType: "Submission",
    entityId: submission.id,
    submissionId: submission.id,
    request,
  });

  return ok({ id: submission.id, reference: submission.reference }, { status: 201 });
});
