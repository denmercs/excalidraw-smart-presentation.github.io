import { vi } from "vitest";

import {
  ANIMATION_DURATION_MS,
  animate,
  isTransitioning,
  settleTransition,
} from "../presentation/animation";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const createElement = (
  overrides: Partial<ExcalidrawElement> & { id: string },
): ExcalidrawElement =>
  ({
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    opacity: 100,
    strokeWidth: 1,
    roughness: 1,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    ...overrides,
  } as unknown as ExcalidrawElement);

const elementMap = (...elements: ExcalidrawElement[]) =>
  new Map(elements.map((element) => [element.id, element]));

describe("Feature: Presentation, frame transitions", () => {
  let now: number;
  let rafCallbacks: Map<number, () => void>;
  let nextRafHandle: number;
  let updateScene: ReturnType<typeof vi.fn>;
  let excalidrawAPI: ExcalidrawImperativeAPI;

  /** Runs every animation frame currently queued. */
  const runQueuedFrames = () => {
    const pending = [...rafCallbacks.values()];
    rafCallbacks.clear();
    pending.forEach((callback) => callback());
  };

  /** Advances the wall clock and any timers, without running animation frames. */
  const advanceTime = (ms: number) => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  /** Elements handed to the most recent updateScene call. */
  const renderedElements = () =>
    updateScene.mock.lastCall?.[0].elements as ExcalidrawElement[];

  beforeEach(() => {
    vi.useFakeTimers();

    now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);

    // rAF is driven manually so tests can reproduce a stalled animation frame
    // loop, which is what browsers do while a tab is hidden or occluded.
    rafCallbacks = new Map();
    nextRafHandle = 1;
    vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
      const handle = nextRafHandle++;
      rafCallbacks.set(handle, callback);
      return handle;
    });
    vi.stubGlobal("cancelAnimationFrame", (handle: number) => {
      rafCallbacks.delete(handle);
    });

    updateScene = vi.fn();
    excalidrawAPI = { updateScene } as unknown as ExcalidrawImperativeAPI;
  });

  afterEach(() => {
    // leave no transition running across tests
    settleTransition();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("when animation frames stop firing mid-transition", () => {
    it("should still land on the target frame and allow further navigation", () => {
      // Arrange: a transition that moves an element from x=0 to x=200
      const from = elementMap(createElement({ id: "a", x: 0 }));
      const to = elementMap(createElement({ id: "a", x: 200 }));

      animate(excalidrawAPI, from, to);
      expect(isTransitioning()).toBe(true);

      // Act: the tab is hidden, so no queued animation frame ever runs while
      // the wall clock keeps moving well past the transition duration
      rafCallbacks.clear();
      advanceTime(ANIMATION_DURATION_MS + 2_000);

      // Assert: the watchdog settled the transition on the target frame
      expect(isTransitioning()).toBe(false);
      expect(renderedElements()).toEqual([
        expect.objectContaining({ id: "a", x: 200 }),
      ]);
    });
  });

  describe("when applying a frame throws", () => {
    it("should release the transition instead of blocking navigation", () => {
      // Arrange: updateScene fails, as it would for a malformed element
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      updateScene.mockImplementation(() => {
        throw new Error("bad element");
      });

      // Act
      animate(
        excalidrawAPI,
        elementMap(createElement({ id: "a" })),
        elementMap(createElement({ id: "b" })),
      );

      // Assert: no transition is left holding the presentation, and nothing is
      // queued that could resurrect it
      expect(isTransitioning()).toBe(false);
      expect(rafCallbacks.size).toBe(0);
      expect(consoleError).toHaveBeenCalled();
    });
  });

  describe("when a new transition starts while one is running", () => {
    it("should supersede it rather than run both loops at once", () => {
      // Arrange: start a transition and let it get partway through
      const frameOne = elementMap(createElement({ id: "a", x: 0 }));
      const frameTwo = elementMap(createElement({ id: "a", x: 100 }));
      const frameThree = elementMap(createElement({ id: "a", x: 300 }));

      animate(excalidrawAPI, frameOne, frameTwo);
      advanceTime(ANIMATION_DURATION_MS / 2);
      runQueuedFrames();

      // Act: navigate again before the first transition finished
      animate(excalidrawAPI, frameTwo, frameThree);

      // Assert: the superseded transition was settled on its own target first,
      // and only the new transition has a frame queued
      expect(rafCallbacks.size).toBe(1);

      advanceTime(ANIMATION_DURATION_MS);
      runQueuedFrames();

      expect(isTransitioning()).toBe(false);
      expect(renderedElements()).toEqual([
        expect.objectContaining({ id: "a", x: 300 }),
      ]);
    });
  });

  describe("settleTransition", () => {
    it("should jump an in-flight transition straight to its target frame", () => {
      // Arrange
      animate(
        excalidrawAPI,
        elementMap(createElement({ id: "a", x: 0 })),
        elementMap(createElement({ id: "a", x: 200 })),
      );
      advanceTime(ANIMATION_DURATION_MS / 3);
      runQueuedFrames();
      expect(renderedElements()[0].x).toBeLessThan(200);

      // Act: what the presentation does when the tab becomes visible again
      settleTransition();

      // Assert
      expect(isTransitioning()).toBe(false);
      expect(renderedElements()).toEqual([
        expect.objectContaining({ id: "a", x: 200 }),
      ]);
    });

    it("should be a no-op when nothing is animating", () => {
      // Arrange: no transition started

      // Act & Assert: does not throw, and does not touch the scene
      expect(() => settleTransition()).not.toThrow();
      expect(updateScene).not.toHaveBeenCalled();
    });
  });

  describe("instant jumps", () => {
    it("should render the target frame without queueing an animation", () => {
      // Arrange & Act: a zero-duration transition, used by go-to-slide
      animate(
        excalidrawAPI,
        elementMap(createElement({ id: "a", x: 0 })),
        elementMap(createElement({ id: "a", x: 500 })),
        { duration: 0 },
      );

      // Assert: fully applied in one shot, nothing left running
      expect(updateScene).toHaveBeenCalledTimes(1);
      expect(isTransitioning()).toBe(false);
      expect(rafCallbacks.size).toBe(0);
      expect(renderedElements()).toEqual([
        expect.objectContaining({ id: "a", x: 500 }),
      ]);
    });

    it("should drop elements that are absent from the target frame", () => {
      // Arrange & Act: element "b" only exists on the outgoing frame
      animate(
        excalidrawAPI,
        elementMap(createElement({ id: "a" }), createElement({ id: "b" })),
        elementMap(createElement({ id: "a" })),
        { duration: 0 },
      );

      // Assert
      expect(renderedElements()).toEqual([
        expect.objectContaining({ id: "a" }),
      ]);
    });
  });
});
