"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Download, ExternalLink, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface PostPackImage {
  id: string;
  name: string;
}

/**
 * Everything needed to create the companion YouTube post by hand.
 *
 * The YouTube API has no endpoint for creating posts, so the app cannot post
 * for you. This card makes doing it yourself a 30-second job: copy the text,
 * download the images, open the channel, paste, attach, post.
 */
export function PostPack({
  submissionId,
  text,
  images,
  published,
  channelId,
  postedAt,
  postedBy,
  canMarkPosted,
}: {
  submissionId: string;
  text: string;
  images: PostPackImage[];
  published: boolean;
  channelId: string | null;
  postedAt: string | null;
  postedBy: string | null;
  canMarkPosted: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Post text copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  }

  function downloadAll() {
    // One anchor click per file; browsers may ask once to allow multiple downloads.
    images.forEach((img, i) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = `/api/uploads/${img.id}/file?download=1`;
        a.download = img.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, i * 400);
    });
  }

  async function markPosted(posted: boolean) {
    setBusy(true);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posted }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not update.");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="size-4 text-brand-600" aria-hidden="true" />
          Post pack
        </CardTitle>
        {postedAt && (
          <span className="text-xs font-medium text-success-700">
            Posted{postedBy ? ` by ${postedBy}` : ""}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!published && (
          <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-ink-soft">
            Ready once the video is published — the video link is added to the text then.
          </p>
        )}

        {text && (
          <div>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface-muted/50 px-3 py-2 font-sans text-[13px] leading-relaxed text-ink">
              {text}
            </pre>
            <Button size="sm" variant="secondary" className="mt-2" onClick={copy}>
              {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
              {copied ? "Copied" : "Copy text"}
            </Button>
          </div>
        )}

        {images.length > 0 && (
          <div>
            <div className="grid grid-cols-3 gap-2">
              {images.map((img) => (
                <a
                  key={img.id}
                  href={`/api/uploads/${img.id}/file?download=1`}
                  download={img.name}
                  className="group relative block aspect-square overflow-hidden rounded-lg border border-line bg-surface-muted"
                  title={`Download ${img.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/uploads/${img.id}/file`}
                    alt={img.name}
                    loading="lazy"
                    className="size-full object-cover transition-opacity group-hover:opacity-80"
                  />
                </a>
              ))}
            </div>
            <Button size="sm" variant="secondary" className="mt-2" onClick={downloadAll}>
              <Download className="size-3.5" aria-hidden="true" />
              Download {images.length === 1 ? "image" : `all ${images.length} images`}
            </Button>
          </div>
        )}

        {published && (
          <div className="space-y-2 border-t border-line pt-3">
            <ol className="list-decimal space-y-0.5 pl-4 text-xs text-ink-soft">
              <li>Copy the text and download the images.</li>
              <li>Open YouTube, then Create → Create post.</li>
              <li>Paste the text, add the images, and post.</li>
            </ol>
            {channelId && (
              <Button asChild size="sm" full>
                <a
                  href={`https://www.youtube.com/channel/${encodeURIComponent(channelId)}/posts`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Open the channel on YouTube
                </a>
              </Button>
            )}
            {canMarkPosted && (
              <Button
                size="sm"
                variant={postedAt ? "ghost" : "secondary"}
                full
                loading={busy}
                onClick={() => void markPosted(!postedAt)}
              >
                {postedAt ? "Undo “posted”" : "I’ve posted it"}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
