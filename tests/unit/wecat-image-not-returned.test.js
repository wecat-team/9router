// WeCat: lỗi "did not return an image" của Codex phải giữ 502 + thông điệp (client cũ nhận diện
// theo chuỗi này), không có retry-after/"(reset after …)" và có x-error-code.
import { describe, it, expect } from "vitest";
import { isImageNotReturnedError, imageNotReturnedResponse } from "../../src/sse/handlers/imageGeneration.js";

const MSG = "[codex/gpt-image-2] [502]: Codex did not return an image. Account may not be entitled (paid ChatGPT plan required).";

describe("WeCat image_not_returned", () => {
  it("nhận diện đúng lỗi không trả ảnh", () => {
    expect(isImageNotReturnedError(MSG)).toBe(true);
    expect(isImageNotReturnedError("Codex did NOT return an image")).toBe(true);
    expect(isImageNotReturnedError("[502]: fetch failed (cause: ETIMEDOUT)")).toBe(false);
    expect(isImageNotReturnedError("The usage limit has been reached")).toBe(false);
    expect(isImageNotReturnedError(null)).toBe(false);
  });

  it("giữ 502 và thông điệp, bỏ retry-after, gắn x-error-code", async () => {
    const res = imageNotReturnedResponse(502, MSG);
    expect(res.status).toBe(502);
    expect(res.headers.get("x-error-code")).toBe("image_not_returned");
    expect(res.headers.get("retry-after")).toBeNull();
    const body = await res.json();
    expect(body.error.message).toBe(MSG);
    expect(body.error.message).toMatch(/did not return an image/);
    expect(body.error.message).not.toMatch(/reset after/);
  });

  it("mặc định 502 khi không có status", () => {
    expect(imageNotReturnedResponse(null, MSG).status).toBe(502);
  });
});
