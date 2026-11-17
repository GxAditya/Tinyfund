import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RunProgress } from "./RunProgress";

const base = {
  companies: ["Acme", "Zolo"],
  verified: 4,
  target: 10,
  cutoff: "2025-05-17",
  startedAt: new Date().toISOString(),
};

describe("RunProgress", () => {
  it("tells the user what is happening in each phase", () => {
    const { rerender } = render(<RunProgress {...base} phase="populating" />);
    expect(screen.getByText(/TinySet is searching funding news/)).toBeInTheDocument();
    expect(screen.getByLabelText("Companies found so far")).toHaveTextContent("Acme");
    rerender(<RunProgress {...base} phase="discovering" />);
    expect(screen.getByText(/4 of 10 rounds verified/)).toBeInTheDocument();
    expect(screen.getByText("+ searching for more")).toBeInTheDocument();
    rerender(<RunProgress {...base} phase="ranking" />);
    expect(screen.getByText(/Finding each investor's website/)).toBeInTheDocument();
  });

  it("asks for confirmation before cancelling", () => {
    const onCancel = vi.fn();
    render(<RunProgress {...base} phase="populating" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /Cancel run/ }));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Confirm cancel/ }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows no cancel button once the run has stopped", () => {
    render(<RunProgress {...base} phase="cancelled" stoppedAt={2} onCancel={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
