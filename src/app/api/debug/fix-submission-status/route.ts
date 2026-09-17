import { ok, route } from "@/lib/api";
import { requirePrincipal } from "@/lib/authz";
import { db } from "@/lib/db";
import { SubmissionStatus } from "@/generated/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route(async (request) => {
  const principal = await requirePrincipal();
  const url = new URL(request.url);
  const submissionId = url.searchParams.get("id");
  const newStatus = url.searchParams.get("status") as SubmissionStatus | null;
  
  if (!submissionId || !newStatus) {
    return ok({ error: "Missing id or status parameter" });
  }
  
  const submission = await db.submission.findUnique({
    where: { id: submissionId },
    select: { id: true, organizationId: true, createdById: true, status: true },
  });
  
  if (!submission) {
    return ok({ error: "Submission not found" });
  }
  
  if (submission.organizationId !== principal.organizationId) {
    return ok({ error: "Wrong organization" });
  }
  
  const updated = await db.submission.update({
    where: { id: submissionId },
    data: { status: newStatus },
  });
  
  return ok({ 
    success: true, 
    submissionId, 
    oldStatus: submission.status, 
    newStatus: updated.status 
  });
});
