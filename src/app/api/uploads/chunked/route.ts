import { z } from "zod";
import { ok, route } from "@/lib/api";
import { loadSubmissionFor, requirePrincipal, requireOrganization } from "@/lib/authz";
import { db } from "@/lib/db";
import { audit, AuditAction } from "@/lib/audit";
import { Errors } from "@/lib/errors";
import { getFolderId, createResumableUploadSession } from "@/lib/google/drive";
import { ACCEPTED_THUMBNAIL_MIME, ACCEPTED_VIDEO_MIME } from "@/lib/validation";
import { DriveFolderKind, MediaKind, SubmissionStatus, UploadState } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Chunk size: 512 KB to stay well under Vercel's 4.5 MB limit
// Base64 encoding increases size by ~33%, so 512 KB chunk becomes ~683 KB in JSON
const CHUNK_SIZE = 512 * 1024; // 512 KB

const createSessionSchema = z.object({
  submissionId: z.string(),
  kind: z.enum(["VIDEO", "THUMBNAIL", "SUPPORTING_IMAGE"]),
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  checksumSha256: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  durationSeconds: z.number().optional(),
});

const uploadChunkSchema = z.object({
  mediaFileId: z.string(),
  chunkIndex: z.number(),
  chunkData: z.string(), // Base64 encoded chunk
  totalChunks: z.number(),
});

export const POST = route(async (request) => {
  console.log(`[CHUNKED DEBUG] REQUEST RECEIVED`);
  console.log(`[CHUNKED DEBUG] Method: ${request.method}`);
  console.log(`[CHUNKED DEBUG] Content-Type: ${request.headers.get('content-type')}`);
  
  try {
    const principal = await requirePrincipal();
    console.log(`[CHUNKED DEBUG] Authenticated user: ${principal.id}`);
    
    const body = await request.json();
    console.log(`[CHUNKED DEBUG] Body keys:`, Object.keys(body));
    console.log(`[CHUNKED DEBUG] Body preview:`, JSON.stringify(body).slice(0, 500));
    
    // Check if this is a session creation or chunk upload
    const isSessionCreation = body.submissionId && !body.mediaFileId;
    console.log(`[CHUNKED DEBUG] Is session creation: ${isSessionCreation}`);
    
    if (isSessionCreation) {
      console.log(`[CHUNKED DEBUG] Calling handleSessionCreation`);
      return handleSessionCreation(principal, body);
    } else {
      console.log(`[CHUNKED DEBUG] Calling handleChunkUpload`);
      return handleChunkUpload(principal, body);
    }
  } catch (err) {
    console.error(`[CHUNKED ERROR] Top-level error caught`);
    console.error(`[CHUNKED ERROR] Error name:`, err instanceof Error ? err.name : 'unknown');
    console.error(`[CHUNKED ERROR] Error message:`, err instanceof Error ? err.message : String(err));
    console.error(`[CHUNKED ERROR] Error stack:`, err instanceof Error ? err.stack : 'no stack');
    throw err;
  }
});

async function handleSessionCreation(principal: any, body: any) {
  console.log(`[CHUNKED SESSION] Starting session creation`);
  
  const parsed = createSessionSchema.parse(body);
  console.log(`[CHUNKED SESSION] Parsed data:`, {
    submissionId: parsed.submissionId,
    filename: parsed.filename,
    sizeBytes: parsed.sizeBytes,
    kind: parsed.kind,
    mimeType: parsed.mimeType,
  });

  console.log(`[CHUNKED SESSION] Loading submission`);
  const submission = await loadSubmissionFor(principal, parsed.submissionId);
  console.log(`[CHUNKED SESSION] Submission loaded: ${submission.id}`);
  
  const organization = await requireOrganization(principal);
  console.log(`[CHUNKED SESSION] Organization loaded: ${organization.id}`);

  const kindTyped = parsed.kind as MediaKind;
  if (kindTyped === MediaKind.VIDEO && !ACCEPTED_VIDEO_MIME.includes(parsed.mimeType as any)) {
    console.error(`[CHUNKED SESSION] Invalid video MIME type: ${parsed.mimeType}`);
    throw Errors.validation(`Invalid video MIME type: ${parsed.mimeType}`);
  }
  if (kindTyped === MediaKind.THUMBNAIL && !ACCEPTED_THUMBNAIL_MIME.includes(parsed.mimeType as any)) {
    console.error(`[CHUNKED SESSION] Invalid thumbnail MIME type: ${parsed.mimeType}`);
    throw Errors.validation(`Invalid thumbnail MIME type: ${parsed.mimeType}`);
  }

  console.log(`[CHUNKED SESSION] Getting Drive folder ID`);
  const folderId = await getFolderId(
    principal.organizationId,
    kindTyped === MediaKind.VIDEO ? DriveFolderKind.DRAFTS : DriveFolderKind.THUMBNAILS,
  );
  console.log(`[CHUNKED SESSION] Folder ID: ${folderId}`);

  console.log(`[CHUNKED SESSION] Creating Drive resumable session`);
  // Create resumable upload session with Google Drive
  const session = await createResumableUploadSession({
    organizationId: principal.organizationId,
    folderId,
    filename: `${submission.reference}-${kindTyped.toLowerCase()}-${parsed.filename}`,
    mimeType: parsed.mimeType,
    sizeBytes: parsed.sizeBytes,
    appProperties: {
      submissionId: submission.id,
      submissionRef: submission.reference,
      kind: kindTyped,
      uploadedBy: principal.id,
    },
  });

  console.log(`[CHUNKED SESSION] Drive session created: ${session.sessionUri.slice(0, 50)}...`);

  console.log(`[CHUNKED SESSION] Checking for existing MediaFile of same kind`);
  // Check if a media file of the same kind already exists for this submission
  const existingMedia = await db.mediaFile.findFirst({
    where: {
      submissionId: submission.id,
      kind: kindTyped,
    },
  });

  let media;
  if (existingMedia) {
    console.log(`[CHUNKED SESSION] Found existing MediaFile: ${existingMedia.id}, updating it`);
    // Update the existing media file instead of creating a new one
    media = await db.mediaFile.update({
      where: { id: existingMedia.id },
      data: {
        originalFilename: parsed.filename,
        mimeType: parsed.mimeType,
        sizeBytes: BigInt(parsed.sizeBytes),
        checksumSha256: parsed.checksumSha256 ?? null,
        width: parsed.width ?? null,
        height: parsed.height ?? null,
        durationSeconds: parsed.durationSeconds ?? null,
        driveFolderId: folderId,
        uploadState: UploadState.IN_PROGRESS,
        resumableSessionUri: session.sessionUri,
        resumableExpiresAt: session.expiresAt,
        bytesReceived: 0n,
        uploadedById: principal.id,
        driveFileId: null, // Clear old Drive file ID
        driveMd5: null,
        driveWebViewLink: null,
        completedAt: null,
      },
    });
  } else {
    console.log(`[CHUNKED SESSION] No existing MediaFile, creating new one`);
    // Create media file record with session info
    media = await db.mediaFile.create({
      data: {
        organizationId: principal.organizationId,
        submissionId: submission.id,
        kind: kindTyped,
        originalFilename: parsed.filename,
        mimeType: parsed.mimeType,
        sizeBytes: BigInt(parsed.sizeBytes),
        checksumSha256: parsed.checksumSha256 ?? null,
        width: parsed.width ?? null,
        height: parsed.height ?? null,
        durationSeconds: parsed.durationSeconds ?? null,
        driveFolderId: folderId,
        uploadState: UploadState.IN_PROGRESS,
        resumableSessionUri: session.sessionUri,
        resumableExpiresAt: session.expiresAt,
        bytesReceived: 0n,
        uploadedById: principal.id,
      },
    });
  }

  console.log(`[CHUNKED SESSION] Media file ready: ${media.id}`);

  // Set submission status to UPLOADING
  if (submission.status === SubmissionStatus.DRAFT) {
    console.log(`[CHUNKED SESSION] Updating submission status to UPLOADING`);
    await db.submission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.UPLOADING },
    });
  }

  const totalChunks = Math.ceil(parsed.sizeBytes / CHUNK_SIZE);
  console.log(`[CHUNKED SESSION] Total chunks: ${totalChunks}`);

  return ok({
    mediaFileId: media.id,
    sessionUri: session.sessionUri,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    status: "session_created",
  });
}

async function handleChunkUpload(principal: any, body: any) {
  console.log(`[CHUNKED UPLOAD] Starting chunk upload`);
  
  const parsed = uploadChunkSchema.parse(body);
  console.log(`[CHUNKED UPLOAD] Parsed data:`, {
    mediaFileId: parsed.mediaFileId,
    chunkIndex: parsed.chunkIndex,
    totalChunks: parsed.totalChunks,
    chunkDataLength: parsed.chunkData?.length || 0,
  });

  console.log(`[CHUNKED UPLOAD] Loading MediaFile`);
  const mediaFile = await db.mediaFile.findUnique({
    where: { id: parsed.mediaFileId },
  });

  if (!mediaFile) {
    console.error(`[CHUNKED UPLOAD] Media file not found: ${parsed.mediaFileId}`);
    throw Errors.notFound("media file");
  }
  console.log(`[CHUNKED UPLOAD] Media file loaded: ${mediaFile.id}`);

  if (mediaFile.organizationId !== principal.organizationId) {
    console.error(`[CHUNKED UPLOAD] Organization mismatch: ${mediaFile.organizationId} vs ${principal.organizationId}`);
    throw Errors.forbidden("wrong organization");
  }

  // Decode base64 chunk
  let chunkBuffer: Buffer;
  try {
    chunkBuffer = Buffer.from(parsed.chunkData, "base64");
    console.log(`[CHUNKED UPLOAD] Chunk decoded, size: ${chunkBuffer.length} bytes`);
  } catch (err) {
    console.error(`[CHUNKED UPLOAD] Failed to decode base64 chunk:`, err);
    throw Errors.validation("Invalid base64 chunk data");
  }

  // Calculate offset for this chunk
  const offset = parsed.chunkIndex * CHUNK_SIZE;
  const end = Math.min(offset + chunkBuffer.length, Number(mediaFile.sizeBytes));

  console.log(`[CHUNKED UPLOAD] Chunk details:`, {
    chunkIndex: parsed.chunkIndex,
    offset,
    end,
    chunkSize: chunkBuffer.length,
    totalSize: Number(mediaFile.sizeBytes),
  });

  console.log(`[CHUNKED UPLOAD] Uploading chunk to Drive`);
  // Upload chunk to Google Drive using the session URI
  const response = await fetch(mediaFile.resumableSessionUri!, {
    method: "PUT",
    headers: {
      "Content-Range": `bytes ${offset}-${end - 1}/${mediaFile.sizeBytes}`,
      "Content-Length": String(chunkBuffer.length),
    },
    body: chunkBuffer as BodyInit,
  });

  console.log(`[CHUNKED UPLOAD] Drive response status: ${response.status}`);

  if (response.status === 308) {
    // Chunk accepted, more expected
    console.log(`[CHUNKED UPLOAD] Chunk accepted, continuing`);
    
    // Update bytes received
    await db.mediaFile.update({
      where: { id: mediaFile.id },
      data: {
        bytesReceived: mediaFile.bytesReceived + BigInt(chunkBuffer.length),
      },
    });

    return ok({
      status: "chunk_accepted",
      chunkIndex: parsed.chunkIndex,
      isFinal: false,
    });
  }

  if (response.status === 200 || response.status === 201) {
    // All chunks accepted, file complete
    console.log(`[CHUNKED UPLOAD] Upload complete`);
    
    const finalBody = await response.json().catch(() => null);
    console.log(`[CHUNKED UPLOAD] Final body:`, finalBody);
    
    // Update media file with Drive file info
    await db.mediaFile.update({
      where: { id: mediaFile.id },
      data: {
        uploadState: UploadState.COMPLETED,
        driveFileId: finalBody?.id,
        driveMd5: finalBody?.md5Checksum,
        driveWebViewLink: finalBody?.webViewLink,
        bytesReceived: mediaFile.sizeBytes,
        resumableSessionUri: null,
        resumableExpiresAt: null,
        completedAt: new Date(),
      },
    });

    // Update submission status to UPLOADED_TO_DRIVE
    await db.submission.update({
      where: { id: mediaFile.submissionId },
      data: { status: SubmissionStatus.UPLOADED_TO_DRIVE },
    });

    console.log(`[CHUNKED UPLOAD] Submission status updated to UPLOADED_TO_DRIVE`);

    return ok({
      status: "upload_complete",
      driveFileId: finalBody?.id,
      webViewLink: finalBody?.webViewLink,
    });
  }

  // Error
  const errorText = await response.text();
  console.error(`[CHUNKED UPLOAD] Drive error ${response.status}:`, errorText);
  throw Errors.validation(`Drive upload failed: ${response.status} - ${errorText.slice(0, 200)}`);
}
