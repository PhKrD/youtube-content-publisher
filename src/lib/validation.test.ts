import { describe, expect, it } from "vitest";
import { formatBytes, validateSubmission, type ValidationInput } from "./validation";

/** A submission that passes everything, which each test then breaks. */
function validInput(over: Partial<ValidationInput> = {}): ValidationInput {
  return {
    video: {
      present: true,
      uploadComplete: true,
      mimeType: "video/mp4",
      sizeBytes: 50 * 1024 * 1024,
      filename: "session.mp4",
    },
    thumbnail: {
      present: true,
      uploadComplete: true,
      mimeType: "image/jpeg",
      sizeBytes: 300 * 1024,
      width: 1280,
      height: 720,
    },
    title: { text: "Gita Workshop | Who Am I? | XYZ", tooLong: false, length: 31, forbiddenChars: [] },
    description: {
      text: "Hare Krishna!",
      tooLong: false,
      length: 13,
      forbiddenChars: [],
      missingVariables: [],
      unknownPlaceholders: [],
    },
    tags: { tags: ["Gita"], totalChars: 5 },
    missingMandatoryHashtags: [],
    playlist: { selected: true, allowed: true, title: "Gita Sessions" },
    contentInfo: { program: "Gita Workshop", topic: "Who Am I?", speaker: "XYZ" },
    schedule: { mode: "NOW" },
    integration: { connected: true, channelConfirmed: true, scopesOk: true },
    permissions: { canPublish: true },
    duplicate: {},
    limits: { maxVideoBytes: 5 * 1024 ** 3, maxThumbnailBytes: 2 * 1024 * 1024 },
    publishingEnabled: true,
    ...over,
  };
}

const errorIds = (i: ValidationInput) => validateSubmission(i).errors.map((e) => e.id);

describe("validateSubmission — happy path", () => {
  it("is ready to publish and to submit", () => {
    const r = validateSubmission(validInput());
    expect(r.errors).toEqual([]);
    expect(r.readyToPublish).toBe(true);
    expect(r.readyToSubmit).toBe(true);
  });
});

describe("video checks", () => {
  it("blocks when no video is chosen", () => {
    const r = validateSubmission(validInput({ video: { present: false, uploadComplete: false } }));
    expect(r.readyToPublish).toBe(false);
    expect(r.errors.find((e) => e.id === "video.present")?.message).toMatch(/choose a video/i);
  });

  it("blocks while the upload is still in progress", () => {
    const ids = errorIds(
      validInput({ video: { present: true, uploadComplete: false, mimeType: "video/mp4" } }),
    );
    expect(ids).toContain("video.present");
  });

  it("rejects an unsupported container", () => {
    const ids = errorIds(
      validInput({
        video: { present: true, uploadComplete: true, mimeType: "video/x-unknown", sizeBytes: 1 },
      }),
    );
    expect(ids).toContain("video.format");
  });

  it("rejects a video over the configured limit", () => {
    const ids = errorIds(
      validInput({
        video: {
          present: true,
          uploadComplete: true,
          mimeType: "video/mp4",
          sizeBytes: 6 * 1024 ** 3,
        },
      }),
    );
    expect(ids).toContain("video.size");
  });

  it("points the user at the video field", () => {
    const r = validateSubmission(validInput({ video: { present: false, uploadComplete: false } }));
    expect(r.errors.find((e) => e.id === "video.present")?.field).toBe("video");
  });
});

describe("thumbnail checks", () => {
  it("treats a missing thumbnail as a warning, not a blocker", () => {
    const r = validateSubmission(
      validInput({ thumbnail: { present: false, uploadComplete: false } }),
    );
    expect(r.readyToPublish).toBe(true);
    expect(r.warnings.map((w) => w.id)).toContain("thumbnail.present");
  });

  it("rejects a non-JPEG/PNG thumbnail", () => {
    const ids = errorIds(
      validInput({
        thumbnail: { present: true, uploadComplete: true, mimeType: "image/webp", sizeBytes: 1000 },
      }),
    );
    expect(ids).toContain("thumbnail.format");
  });

  it("rejects a thumbnail over 2 MB", () => {
    const ids = errorIds(
      validInput({
        thumbnail: {
          present: true,
          uploadComplete: true,
          mimeType: "image/jpeg",
          sizeBytes: 3 * 1024 * 1024,
        },
      }),
    );
    expect(ids).toContain("thumbnail.size");
  });

  it("rejects a thumbnail narrower than 640px", () => {
    const ids = errorIds(
      validInput({
        thumbnail: {
          present: true,
          uploadComplete: true,
          mimeType: "image/jpeg",
          sizeBytes: 1000,
          width: 320,
          height: 180,
        },
      }),
    );
    expect(ids).toContain("thumbnail.dimensions");
  });

  it("warns (not blocks) on a non-16:9 thumbnail", () => {
    const r = validateSubmission(
      validInput({
        thumbnail: {
          present: true,
          uploadComplete: true,
          mimeType: "image/jpeg",
          sizeBytes: 1000,
          width: 1000,
          height: 1000,
        },
      }),
    );
    expect(r.warnings.map((w) => w.id)).toContain("thumbnail.aspect");
    expect(r.readyToPublish).toBe(true);
  });

  it("accepts 1920x1080 as 16:9", () => {
    const r = validateSubmission(
      validInput({
        thumbnail: {
          present: true,
          uploadComplete: true,
          mimeType: "image/jpeg",
          sizeBytes: 1000,
          width: 1920,
          height: 1080,
        },
      }),
    );
    expect(r.warnings.map((w) => w.id)).not.toContain("thumbnail.aspect");
  });
});

describe("metadata checks", () => {
  it("blocks an empty title", () => {
    const ids = errorIds(
      validInput({ title: { text: "  ", tooLong: false, length: 0, forbiddenChars: [] } }),
    );
    expect(ids).toContain("title.present");
  });

  it("blocks an over-long title", () => {
    const ids = errorIds(
      validInput({ title: { text: "x".repeat(120), tooLong: true, length: 120, forbiddenChars: [] } }),
    );
    expect(ids).toContain("title.length");
  });

  it("blocks characters YouTube rejects", () => {
    const ids = errorIds(
      validInput({
        title: { text: "a <b>", tooLong: false, length: 5, forbiddenChars: ["<", ">"] },
      }),
    );
    expect(ids).toContain("title.chars");
  });

  it("blocks and names missing template variables", () => {
    const r = validateSubmission(
      validInput({
        description: {
          text: "",
          tooLong: false,
          length: 0,
          forbiddenChars: [],
          missingVariables: [{ key: "TOPIC", label: "Topic" }],
          unknownPlaceholders: [],
        },
      }),
    );
    const check = r.errors.find((e) => e.id === "description.variables");
    expect(check?.message).toContain("Topic");
    // Focuses the specific variable input.
    expect(check?.field).toBe("var.TOPIC");
  });

  it("blocks an unresolved template placeholder and blames the template", () => {
    const r = validateSubmission(
      validInput({
        description: {
          text: "{{GHOST}}",
          tooLong: false,
          length: 9,
          forbiddenChars: [],
          missingVariables: [],
          unknownPlaceholders: ["GHOST"],
        },
      }),
    );
    const check = r.errors.find((e) => e.id === "description.placeholders");
    expect(check?.message).toMatch(/administrator/i);
  });

  it("blocks when a mandatory hashtag was removed", () => {
    const r = validateSubmission(validInput({ missingMandatoryHashtags: ["bhagavadgita"] }));
    expect(r.errors.map((e) => e.id)).toContain("hashtags.mandatory");
    expect(r.errors.find((e) => e.id === "hashtags.mandatory")?.message).toContain("#bhagavadgita");
  });
});

describe("playlist checks", () => {
  it("blocks when no playlist is selected", () => {
    expect(errorIds(validInput({ playlist: { selected: false, allowed: true } }))).toContain(
      "playlist.selected",
    );
  });

  it("blocks a playlist that has disappeared from YouTube", () => {
    expect(errorIds(validInput({ playlist: { selected: true, allowed: false } }))).toContain(
      "playlist.allowed",
    );
  });
});

describe("scheduling checks", () => {
  it("requires a time when scheduling", () => {
    expect(errorIds(validInput({ schedule: { mode: "SCHEDULED", at: null } }))).toContain(
      "schedule.time",
    );
  });

  it("rejects a time in the past", () => {
    expect(
      errorIds(validInput({ schedule: { mode: "SCHEDULED", at: new Date(Date.now() - 1000) } })),
    ).toContain("schedule.time");
  });

  it("accepts a future time", () => {
    expect(
      errorIds(validInput({ schedule: { mode: "SCHEDULED", at: new Date(Date.now() + 86400_000) } })),
    ).not.toContain("schedule.time");
  });
});

describe("integration, permission and safety gates", () => {
  it("blocks publishing when Google is not connected", () => {
    expect(
      errorIds(
        validInput({ integration: { connected: false, channelConfirmed: true, scopesOk: true } }),
      ),
    ).toContain("integration.connected");
  });

  it("blocks publishing when the channel is unconfirmed", () => {
    expect(
      errorIds(
        validInput({ integration: { connected: true, channelConfirmed: false, scopesOk: true } }),
      ),
    ).toContain("integration.channel");
  });

  it("blocks publishing on insufficient scopes", () => {
    expect(
      errorIds(
        validInput({ integration: { connected: true, channelConfirmed: true, scopesOk: false } }),
      ),
    ).toContain("integration.scopes");
  });

  it("blocks publishing without permission", () => {
    expect(errorIds(validInput({ permissions: { canPublish: false } }))).toContain(
      "permissions.publish",
    );
  });

  it("blocks publishing when production publishing is off", () => {
    expect(errorIds(validInput({ publishingEnabled: false }))).toContain("publishing.enabled");
  });
});

describe("readyToSubmit is laxer than readyToPublish", () => {
  /**
   * The distinction that keeps students unblocked: a contributor with no
   * publish rights, whose admin has not finished connecting YouTube, must
   * still be able to send work for review.
   */
  it("still allows submission when only publisher-side gates fail", () => {
    const r = validateSubmission(
      validInput({
        permissions: { canPublish: false },
        publishingEnabled: false,
        integration: { connected: false, channelConfirmed: false, scopesOk: false },
      }),
    );
    expect(r.readyToPublish).toBe(false);
    expect(r.readyToSubmit).toBe(true);
  });

  it("blocks submission when the content itself is incomplete", () => {
    const r = validateSubmission(validInput({ video: { present: false, uploadComplete: false } }));
    expect(r.readyToSubmit).toBe(false);
  });
});

describe("duplicate prevention", () => {
  it("blocks re-publishing something already on YouTube", () => {
    const r = validateSubmission(validInput({ duplicate: { alreadyPublishedVideoId: "abc123" } }));
    expect(r.errors.map((e) => e.id)).toContain("duplicate.published");
    expect(r.errors.find((e) => e.id === "duplicate.published")?.message).toContain("abc123");
  });

  it("only warns when the same file was uploaded elsewhere", () => {
    const r = validateSubmission(
      validInput({ duplicate: { sameChecksumSubmissionRef: "SUB-000007" } }),
    );
    expect(r.warnings.map((w) => w.id)).toContain("duplicate.checksum");
    expect(r.readyToPublish).toBe(true);
  });
});

describe("formatBytes", () => {
  it("formats common sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(50 * 1024 * 1024)).toBe("50 MB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  it("handles invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});
