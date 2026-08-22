import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("streamdown", () => ({ Streamdown: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children) }));
import { RunnerStatusCard } from "./client/src/components/PalmWorkspace";

describe("PalmWorkspace Local Runner queue UI", () => {
  it("renders a truthful queued status and does not render a completion label before local claim", () => {
    const markup = renderToStaticMarkup(
      React.createElement(RunnerStatusCard, { run: null, isExecuting: false, waitingForLocalRunner: true, onCancel: vi.fn(), isCancelling: false })
    );
    expect(markup).toContain("Queued for your Local Runner");
    expect(markup).toContain("Palm will remain queued until the local-runner script on your machine claims this task.");
    expect(markup).not.toContain("completed the action");
  });
});
