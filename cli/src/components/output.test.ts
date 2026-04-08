import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spinnerMock } = vi.hoisted(() => ({
  spinnerMock: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  spinner: spinnerMock,
}));

import { createSpinner, setOutputMode } from "./output.js";

describe("createSpinner", () => {
  const originalStderrIsTTY = process.stderr.isTTY;
  const originalTerm = process.env.TERM;
  const originalCI = process.env.CI;

  beforeEach(() => {
    spinnerMock.mockReset();
    setOutputMode({ json: false, verbose: false });
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: true,
    });
    process.env.TERM = "xterm-256color";
    delete process.env.CI;
  });

  afterEach(() => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: originalStderrIsTTY,
    });
    if (originalTerm === undefined) {
      delete process.env.TERM;
    } else {
      process.env.TERM = originalTerm;
    }
    if (originalCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCI;
    }
    vi.restoreAllMocks();
  });

  it("returns a no-op spinner in json mode", () => {
    setOutputMode({ json: true });

    const spinner = createSpinner();
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    spinner.start("Connecting...");
    spinner.message("Still working...");
    spinner.stop("Done");

    expect(spinnerMock).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("uses clack spinner in interactive tty mode", () => {
    const clackSpinner = {
      start: vi.fn(),
      message: vi.fn(),
      stop: vi.fn(),
      cancel: vi.fn(),
      error: vi.fn(),
      clear: vi.fn(),
      isCancelled: false,
    };
    spinnerMock.mockReturnValue(clackSpinner);

    const spinner = createSpinner();

    spinner.start("Connecting...");
    spinner.message("Building plan...");
    spinner.stop("Done");

    expect(spinnerMock).toHaveBeenCalledWith({ output: process.stderr });
    expect(clackSpinner.start).toHaveBeenCalledWith("Connecting...");
    expect(clackSpinner.message).toHaveBeenCalledWith("Building plan...");
    expect(clackSpinner.stop).toHaveBeenCalledWith("Done");
  });

  it("falls back to static stderr logging in non-interactive mode", () => {
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      value: false,
    });
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const spinner = createSpinner();
    spinner.start("Connecting...");
    spinner.message("Building plan...");
    spinner.message("Building plan...");
    spinner.stop("Done");

    expect(spinnerMock).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(3);
    expect(writeSpy).toHaveBeenNthCalledWith(1, "Connecting...\n");
    expect(writeSpy).toHaveBeenNthCalledWith(2, "Building plan...\n");
    expect(writeSpy).toHaveBeenNthCalledWith(3, "Done\n");
  });

  it("uses static stderr logging in verbose mode", () => {
    setOutputMode({ verbose: true });
    const writeSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const spinner = createSpinner();
    spinner.start("Connecting...");
    spinner.stop("Done");

    expect(spinnerMock).not.toHaveBeenCalled();
    expect(writeSpy).toHaveBeenNthCalledWith(1, "Connecting...\n");
    expect(writeSpy).toHaveBeenNthCalledWith(2, "Done\n");
  });
});
