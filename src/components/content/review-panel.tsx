"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageSquare, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";

type Decision = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

/**
 * Reviewer actions (Section 28).
 *
 * A comment is required for anything other than an approval — telling a
 * student "changes required" with no explanation wastes everyone's time. The
 * server enforces this too.
 */
export function ReviewPanel({
  submissionId,
  status,
  title,
}: {
  submissionId: string;
  status: string;
  title: string;
}) {
  const router = useRouter();
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: Decision) {
    if (decision !== "APPROVED" && !comment.trim()) {
      setError("Please explain what needs to change.");
      return;
    }
    setError(null);
    setPending(decision);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: comment.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not record the decision.");

      toast.success(
        decision === "APPROVED"
          ? "Approved"
          : decision === "CHANGES_REQUESTED"
            ? "Changes requested"
            : "Rejected",
      );
      setComment("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not record the decision.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card className="border-brand-200 bg-brand-50/40">
      <CardHeader>
        <CardTitle>Your review</CardTitle>
        <p className="mt-1 text-xs text-ink-soft">
          Check the video, thumbnail, title and description below before deciding.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Field
          label="Comments"
          description="Required unless you are approving. The contributor will see this."
          error={error}
          htmlFor="review-comment"
        >
          <Textarea
            id="review-comment"
            rows={3}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. Please replace the thumbnail — the text is unreadable at small sizes."
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => decide("APPROVED")}
            loading={pending === "APPROVED"}
            disabled={pending !== null}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            Approve
          </Button>
          <Button
            variant="secondary"
            onClick={() => decide("CHANGES_REQUESTED")}
            loading={pending === "CHANGES_REQUESTED"}
            disabled={pending !== null}
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            Request changes
          </Button>
          <Button
            variant="ghost"
            onClick={() => decide("REJECTED")}
            loading={pending === "REJECTED"}
            disabled={pending !== null}
          >
            <XCircle className="size-4" aria-hidden="true" />
            Reject
          </Button>
        </div>
        <p className="text-xs text-ink-faint">
          Reviewing “{title}” — currently {status.toLowerCase().replace(/_/g, " ")}.
        </p>
      </CardContent>
    </Card>
  );
}
