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
  try {
    const principal = await requirePrincipal();
    const body = await request.json();
    
    console.log(`[Chunked upload] POST request received, body keys:`, Object.keys(body));
    
    // Check if this is a session creation or chunk upload
    const isSessionCreation = body.submissionId && !body.mediaFileId;
    
    if (isSessionCreation) {
      return handleSessionCreation(principal, body);
    } else {
      return handleChunkUpload(principal, body);
    }
  } catch (err) {
    console.error(`[Chunked upload] Unhandled error:`, err);
    console.error(`[Chunked upload] Error name:`, err instanceof Error ? err.name : 'unknown');
    console.error(`[Chunked upload] Error message:`, err instanceof Error ? err.message : String(err));
    throw err;
  }
});

async function handleSessionCreation(principal: any, body: any) {
  const parsed = createSessionSchema.parse(body);
  
  console.log(`[Chunked upload] Creating session for ${parsed.filename}, size ${parsed.sizeBytes}`);

  const submission = await loadSubmissionFor(principal, parsed.submissionId);
  const organization = await requireOrganization(principal);

  const kindTyped = parsed.kind as MediaKind;
  if (kindTyped === MediaKind.VIDEO && !ACCEPTED_VIDEO_MIME.includes(parsed.mimeType as any)) {
    throw Errors.validation(`Invalid video MIME type: ${parsed.mimeType}`);
  }
  if (kindTyped === MediaKind.THUMBNAIL && !ACCEPTED_THUMBNAIL_MIME.includes(parsed.mimeType as any)) {
    throw Errors.validation(`Invalid thumbnail MIME type: ${parsed.mimeType}`);
  }

  const folderId = await getFolderId(
    principal.organizationId,
    kindTyped === MediaKind.VIDEO ? DriveFolderKind.DRAFTS : DriveFolderKind.THUMBNAILS,
  );

  console.log(`[Chunked upload] Folder ID: ${folderId}`);

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

  console.log(`[Chunked upload] Drive session created: ${session.sessionUri.slice(0, 50)}...`);

  // Create media file record
  const media = await db.mediaFile.create({
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

  console.log(`[Chunked upload] Media file created: ${media.id}`);

  // Set submission status to UPLOADING
  if (submission.status === SubmissionStatus.DRAFT) {
    await db.submission.update({
      where: { id: submission.id },
      data: { status: SubmissionStatus.UPLOADING },
    });
  }

  const totalChunks = Math.ceil(parsed.sizeBytes / CHUNK_SIZE);

  return ok({
    mediaFileId: media.id,
    sessionUri: session.sessionUri,
    chunkSize: CHUNK_SIZE,
    totalChunks,
    status: "session_created",
  });
}

async function handleChunkUpload(principal: any, body: any) {
  const parsed = uploadChunkSchema.parse(body);
  
  console.log(`[Chunked upload] Chunk ${parsed.chunkIndex + 1}/${parsed.totalChunks} for media file ${parsed.mediaFileId}`);
  console.log(`[Chunked upload] Chunk data length: ${parsed.chunkData?.length || 0}`);

  const mediaFile = await db.mediaFile.findUnique({
    where: { id: parsed.mediaFileId },
  });

  if (!mediaFile) {
    console.error(`[Chunked upload] Media file not found: ${parsed.mediaFileId}`);
    throw Errors.notFound("media file");
  }

  if (mediaFile.organizationId !== principal.organizationId) {
    console.error(`[Chunked upload] Organization mismatch: ${mediaFile.organizationId} vs ${principal.organizationId}`);
    throw Errors.forbidden("wrong organization");
  }

  // Decode base64 chunk
  let chunkBuffer: Buffer;
  try {
    chunkBuffer = Buffer.from(parsed.chunkData, "base64");
    console.log(`[Chunked upload] Chunk decoded, size: ${chunkBuffer.length} bytes`);
  } catch (err) {
    console.error(`[Chunked upload] Failed to decode base64 chunk:`, err);
    throw Errors.validation("Invalid base64 chunk data");
  }

  // Calculate offset for this chunk
  const offset = parsed.chunkIndex * CHUNK_SIZE;
  const end = Math.min(offset + chunkBuffer.length, Number(mediaFile.sizeBytes));

  console.log(`[Chunked upload] Uploading chunk to Drive: offset ${offset}, end ${end}, total size ${mediaFile.sizeBytes}`);

  try {
    // Upload chunk to Google Drive using the session URI
    const response = await fetch(mediaFile.resumableSessionUri!, {
      method: "PUT",
      headers: {
        "Content-Range": `bytes ${offset}-${end - 1}/${mediaFile.sizeBytes}`,
        "Content-Length": String(chunkBuffer.length),
      },
      body: chunkBuffer as BodyInit,
    });

    console.log(`[Chunked upload] Drive response status: ${response.status}`);

    if (response.status === 308) {
      // Chunk accepted, more expected
      console.log(`[Chunked upload] Chunk accepted, continuing`);
      
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
      console.log(`[Chunked upload] Upload complete`);
      
      const finalBody = await response.json().catch(() => null);
      console.log(`[Chunked upload] Final body:`, finalBody);
      
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

      console.log(`[Chunked upload] Submission status updated to UPLOADED_TO_DRIVE`);

      return ok({
        status: "upload_complete",
        driveFileId: finalBody?.id,
        webViewLink: finalBody?.webViewLink,
      });
    }

    // Error
    const errorText = await response.text();
    console.error(`[Chunked upload] Drive error ${response.status}:`, errorText);
    throw Errors.validation(`Drive upload failed: ${response.status} - ${errorText.slice(0, 200)}`);
  } catch (err) {
    console.error(`[Chunked upload] Upload failed:`, err);
    throw err;
  }
}
